from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from .models import Task, Tag, TimeBucket, TimeBucketType, TaskDependency
from .services.estimates import (clear_completion_snapshot, record_estimate_change,
                                 write_completion_snapshot)
from .services.graph import would_create_cycle
from .services.tree import TreeIndex, earliest_ancestor_deadline, next_sibling_order, reparent_cycle

HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


class HexColorMixin(serializers.Serializer):
    """Read/write the model's rgb BinaryField as a '#rrggbb' string."""
    hex_color = serializers.RegexField(
        HEX_COLOR_PATTERN, required=False,
        error_messages={"invalid": "Colors must look like #3357ff."},
    )

    def _pop_color(self, validated_data):
        hex_color = validated_data.pop("hex_color", None)
        return bytes.fromhex(hex_color.lstrip("#")) if hex_color else None

    def create(self, validated_data):
        color = self._pop_color(validated_data)
        instance = super().create(validated_data)
        if color is not None:
            instance.color = color
            instance.save(update_fields=["color"])
        return instance

    def update(self, instance, validated_data):
        color = self._pop_color(validated_data)
        instance = super().update(instance, validated_data)
        if color is not None:
            instance.color = color
            instance.save(update_fields=["color"])
        return instance


class TagSerializer(HexColorMixin, serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name", "hex_color"]

class TaskSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source='tags', many=True, write_only=True, required=False
    )
    hex_color = serializers.CharField(read_only=True)
    is_done = serializers.BooleanField(read_only=True)
    active_tracking_start = serializers.SerializerMethodField()
    parent_id = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.all(), source='parent', required=False, allow_null=True,
    )
    # Compatibility until UI-8: the old "project" is the top-level ancestor.
    # Writing it moves the task under that task, unless it already is inside.
    project_id = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.all(), source='compat_project',
        write_only=True, required=False, allow_null=True,
    )

    _UNSET = object()

    def _tree(self) -> TreeIndex:
        # Shared by all items of a list response (one query per request).
        if '_tree_index' not in self.context:
            self.context['_tree_index'] = TreeIndex.load()
        return self.context['_tree_index']

    def to_representation(self, task):
        data = super().to_representation(task)
        tree = self._tree()
        if task.id not in tree.nodes:  # created after the index was loaded
            self.context['_tree_index'] = tree = TreeIndex.load()
        data['project_id'] = tree.root_id(task.id)
        data['children_ids'] = tree.children_ids(task.id)
        data['ancestor_ids'] = tree.ancestor_ids(task.id)
        deadline = tree.effective_deadline(task.id)
        data['effective_deadline'] = serializers.DateTimeField().to_representation(deadline) \
            if deadline is not None else None
        data['is_estimated'] = task.duration is not None
        duration_field = serializers.DurationField()
        parts, rest = tree.parts_total(task.id), tree.rest(task.id)
        data['parts_total'] = duration_field.to_representation(parts) if parts is not None else None
        data['rest'] = duration_field.to_representation(rest) if rest is not None else None
        data['over_budget'] = tree.over_budget(task.id)
        return data

    def get_active_tracking_start(self, task):
        session = task.tracking_sessions.filter(end=None).first()
        return session.start if session is not None else None

    def _resolve_parent(self, attrs):
        """Fold the compat ``project_id`` into ``parent``; returns the target
        parent or ``_UNSET`` when the parent is not being changed."""
        compat = attrs.pop('compat_project', self._UNSET)
        if 'parent' in attrs:
            return attrs['parent']
        if compat is self._UNSET:
            return self._UNSET
        instance = self.instance
        if instance is not None and compat is not None:
            ancestors = TreeIndex.load().ancestor_ids(instance.id)
            if compat.id in ancestors:
                return self._UNSET  # already inside that project: keep the position
        attrs['parent'] = compat
        return compat

    def validate(self, attrs):
        instance = self.instance
        new_parent = self._resolve_parent(attrs)
        if instance is not None and new_parent is not self._UNSET:
            path = reparent_cycle(instance.id, new_parent.id if new_parent else None)
            if path is not None:
                if len(path) == 1:
                    message = 'A task cannot be its own parent.'
                else:
                    message = (f'“{instance.header}” cannot be moved into “{new_parent.header}” '
                               f'because “{new_parent.header}” is part of “{instance.header}”.')
                raise serializers.ValidationError({
                    'parent_id': [message], 'path': [str(node) for node in path],
                })
        deadline = attrs.get('latest_finish_date')
        if deadline is not None:
            parent = new_parent if new_parent is not self._UNSET else (
                instance.parent if instance is not None else None)
            limit = earliest_ancestor_deadline(parent)
            if limit is not None and deadline > limit.latest_finish_date:
                shown = timezone.localtime(limit.latest_finish_date).strftime('%d.%m.%Y %H:%M')
                raise serializers.ValidationError({'latest_finish_date': [
                    f'The deadline is later than the deadline of “{limit.header}” ({shown}). '
                    'Choose a date on or before it.'
                ]})
        if instance is None:
            return attrs
        placing = 'start_date' in attrs or 'is_fixed' in attrs
        start = attrs.get('start_date', instance.start_date)
        fixed = attrs.get('is_fixed', instance.is_fixed)
        if placing and start is not None and fixed:
            from .services.plan_store import find_placement_conflict
            conflict = find_placement_conflict(instance, start)
            if conflict is not None:
                predecessor, available_from = conflict
                raise serializers.ValidationError({
                    'detail': (
                        f'“{instance.header}” cannot start before its '
                        f'predecessor “{predecessor.header}” is done.'
                    ),
                    'predecessor': {
                        'id': str(predecessor.id),
                        'header': predecessor.header,
                    },
                    'available_from': available_from.isoformat(),
                })
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        if 'order' not in validated_data:
            parent = validated_data.get('parent')
            validated_data['order'] = next_sibling_order(parent.id if parent else None)
        task = super().create(validated_data)
        record_estimate_change(task, None, task.duration, 'created')
        if task.completed_at is not None:
            write_completion_snapshot(task)
        return task

    @transaction.atomic
    def update(self, instance, validated_data):
        old_duration = instance.duration
        was_done = instance.completed_at is not None
        if 'parent' in validated_data and 'order' not in validated_data \
                and validated_data['parent'] != instance.parent:
            parent = validated_data['parent']
            validated_data['order'] = next_sibling_order(parent.id if parent else None)
        task = super().update(instance, validated_data)
        record_estimate_change(task, old_duration, task.duration, 'edited')
        if task.completed_at is not None and not was_done:
            write_completion_snapshot(task)
        elif task.completed_at is None and was_done:
            clear_completion_snapshot(task)
        return task

    class Meta:
        model = Task
        fields = [
            'id', 'header', 'description', 'start_date', 'duration',
            'latest_finish_date', 'time_spent', 'priority', 'tags', 'tag_ids', 'hex_color', 'is_fixed',
            'is_appointment', 'completed_at', 'is_done', 'active_tracking_start', 'project_id',
            'parent_id', 'order',
            'completion_estimate', 'completion_first_estimate', 'completion_time_spent',
            'completion_subtree_time_spent', 'completion_dropped_rest',
        ]
        read_only_fields = [
            'completion_estimate', 'completion_first_estimate', 'completion_time_spent',
            'completion_subtree_time_spent', 'completion_dropped_rest',
        ]


class ProjectSerializer(serializers.ModelSerializer):
    """Compatibility view (until UI-8): a project is a top-level task, shown
    in the shape of the old Project model."""
    name = serializers.CharField(source='header', max_length=1024)
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source='tags', many=True,
        write_only=True, required=False,
    )
    hex_color = serializers.CharField(read_only=True)
    task_ids = serializers.SerializerMethodField()

    def get_task_ids(self, task):
        if '_tree_index' not in self.context:
            self.context['_tree_index'] = TreeIndex.load()
        tree = self.context['_tree_index']
        if task.id not in tree.nodes:
            self.context['_tree_index'] = tree = TreeIndex.load()
        return tree.descendant_ids(task.id)

    @transaction.atomic
    def create(self, validated_data):
        validated_data.setdefault('order', next_sibling_order(None))
        task = super().create(validated_data)
        record_estimate_change(task, None, task.duration, 'created')
        return task

    class Meta:
        model = Task
        fields = ['id', 'name', 'description', 'tags', 'tag_ids', 'priority', 'order', 'task_ids', 'hex_color']

class TimeBucketTypeSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source='tags', many=True,
        write_only=True, required=False,
    )
    hex_color = serializers.CharField(read_only=True)

    class Meta:
        model = TimeBucketType
        fields = '__all__'

class TimeBucketSerializer(serializers.ModelSerializer):
    type = TimeBucketTypeSerializer(read_only=True)
    type_id = serializers.PrimaryKeyRelatedField(
        queryset=TimeBucketType.objects.all(), source='type', write_only=True)
    # Explicit id so a generated bucket can be materialized under its
    # pre-assigned UUID (A8) by POSTing it back.
    id = serializers.UUIDField(required=False)

    class Meta:
        model = TimeBucket
        fields = ['id', 'start_date', 'duration', 'type', 'type_id', 'origin_date']


class TaskDependencySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskDependency
        fields = ['id', 'predecessor', 'successor']
        validators = []  # duplicate/self checks are handled in validate() for clean errors

    def validate(self, attrs):
        predecessor = attrs['predecessor']
        successor = attrs['successor']

        if predecessor == successor:
            raise serializers.ValidationError(
                {"detail": "A task cannot depend on itself."}
            )
        if TaskDependency.objects.filter(predecessor=predecessor, successor=successor).exists():
            raise serializers.ValidationError(
                {"detail": "This dependency already exists."}
            )

        edges = TaskDependency.objects.values_list("predecessor_id", "successor_id")
        cycle = would_create_cycle(edges, (predecessor.id, successor.id))
        # UUIDs are serialized as strings in the JSON error payload.
        cycle = [str(node) for node in cycle] if cycle is not None else None
        if cycle is not None:
            raise serializers.ValidationError({
                "detail": "This dependency would create a cycle.",
                "cycle": cycle,
            })
        return attrs
