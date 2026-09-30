from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from datetime import timedelta

from .models import Task, Tag, TimeBucket, TimeBucketType, TaskDependency, UserSettings
from .services.estimates import (clear_completion_snapshot, record_estimate_change,
                                 write_completion_snapshot)
from .services.tree import (TreeIndex, dependency_cycle, earliest_ancestor_deadline,
                            move_creates_dependency_cycle, next_sibling_order, related_in_tree,
                            reparent_cycle)

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
    #: Why the estimate changes (history, §4.6); plain edits are "edited".
    estimate_reason = serializers.ChoiceField(
        choices=['edited', 'set_to_sum', 'raised_from_warning'], write_only=True, required=False,
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
        """The target parent, or ``_UNSET`` when the parent is not changed."""
        return attrs['parent'] if 'parent' in attrs else self._UNSET

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
            cycle = move_creates_dependency_cycle(instance.id, new_parent.id if new_parent else None)
            if cycle is not None:
                target = f'“{new_parent.header}”' if new_parent else 'the top level'
                raise serializers.ValidationError({
                    'parent_id': [f'Moving “{instance.header}” into {target} would create a '
                                  'dependency cycle, because a parent’s dependencies apply to '
                                  'all of its subtasks.'],
                    'cycle': [str(node) for node in cycle],
                })
        if instance is not None and attrs.get('completed_at') is not None and not instance.is_done:
            from .services.completion import CompletionError, ensure_completable
            try:
                ensure_completable(instance)
            except CompletionError as error:
                raise serializers.ValidationError({'completed_at': [str(error)]})
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
        validated_data.pop('estimate_reason', None)
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
        reason = validated_data.pop('estimate_reason', 'edited')
        old_duration = instance.duration
        was_done = instance.completed_at is not None
        if 'parent' in validated_data and 'order' not in validated_data \
                and validated_data['parent'] != instance.parent:
            parent = validated_data['parent']
            validated_data['order'] = next_sibling_order(parent.id if parent else None)
        task = super().update(instance, validated_data)
        record_estimate_change(task, old_duration, task.duration, reason)
        from .services.completion import complete_finished_ancestors, reopen
        if task.completed_at is not None and not was_done:
            write_completion_snapshot(task)
            complete_finished_ancestors(task, task.completed_at)
            from .services.settings import ensure_active_project_open
            ensure_active_project_open()
        elif task.completed_at is None and was_done:
            clear_completion_snapshot(task)
            if task.parent is not None and task.parent.is_done:
                reopen(task.parent)  # an open task cannot live in a completed one
        return task

    class Meta:
        model = Task
        fields = [
            'id', 'header', 'description', 'start_date', 'duration',
            'latest_finish_date', 'time_spent', 'priority', 'tags', 'tag_ids', 'hex_color', 'is_fixed',
            'is_appointment', 'completed_at', 'is_done', 'active_tracking_start',
            'parent_id', 'order', 'estimate_reason',
            'completion_estimate', 'completion_first_estimate', 'completion_time_spent',
            'completion_subtree_time_spent', 'completion_dropped_rest',
        ]
        read_only_fields = [
            'completion_estimate', 'completion_first_estimate', 'completion_time_spent',
            'completion_subtree_time_spent', 'completion_dropped_rest',
        ]


class SplitRowSerializer(serializers.Serializer):
    """One row of the split editor; ``children`` splits the row itself."""
    id = serializers.UUIDField(required=False)
    header = serializers.CharField(max_length=1024, error_messages={
        'blank': 'The header is empty. Give the part a short name, e.g. “CAD”.',
    })
    duration = serializers.DurationField(required=False, allow_null=True)
    priority = serializers.FloatField(required=False, min_value=0, max_value=10)
    latest_finish_date = serializers.DateTimeField(required=False, allow_null=True)
    tag_ids = serializers.PrimaryKeyRelatedField(queryset=Tag.objects.all(), many=True,
                                                 required=False)
    children = serializers.ListField(required=False, allow_null=True)

    def validate_duration(self, value):
        if value is not None and value <= timedelta(0):
            raise serializers.ValidationError(
                'A part must take longer than 0 minutes. Leave it empty to use your default.')
        return value

    def validate_children(self, value):
        if value is None:
            return None
        rows = SplitRowSerializer(data=value, many=True)
        if not rows.is_valid():
            raise serializers.ValidationError(rows.errors)
        return rows.validated_data


class SplitSerializer(serializers.Serializer):
    """Body of POST /api/tasks/{id}/split/ (UI-3)."""
    children = SplitRowSerializer(many=True)
    estimate = serializers.DurationField(required=False, allow_null=True)
    estimate_reason = serializers.ChoiceField(
        choices=['split', 'set_to_sum', 'raised_from_warning'], default='split')
    sequential = serializers.BooleanField(default=True)
    inherit_tags = serializers.BooleanField(default=True)
    inherit_priority = serializers.BooleanField(default=True)


class UserSettingsSerializer(serializers.ModelSerializer):
    """UI-3 settings: default duration and the server-synced active project."""
    active_task_id = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.all(), source='active_task', allow_null=True, required=False,
    )
    #: Breadcrumb of the active project, root first.
    active_task_path = serializers.SerializerMethodField()

    MAX_DEFAULT = timedelta(hours=1000)

    def get_active_task_path(self, settings):
        path, task, seen = [], settings.active_task, set()
        while task is not None and task.id not in seen:
            seen.add(task.id)
            path.append({'id': task.id, 'header': task.header})
            task = task.parent
        return list(reversed(path))

    def validate_default_duration(self, value):
        if value <= timedelta(0):
            raise serializers.ValidationError(
                'The default duration must be longer than 0 minutes, e.g. 1h or 30m.')
        if value > self.MAX_DEFAULT:
            raise serializers.ValidationError('The default duration can be at most 1000 hours.')
        return value

    def validate_active_task_id(self, task):
        from .services.settings import is_project
        if task is None:
            return task
        if task.is_done:
            raise serializers.ValidationError(
                f'“{task.header}” is completed. Choose an open project.')
        if not is_project(task):
            raise serializers.ValidationError(
                f'“{task.header}” is a single step inside “{task.parent.header}”. Choose a '
                'project (a top-level task) or a task with subtasks.')
        return task

    class Meta:
        model = UserSettings
        fields = ['default_duration', 'active_task_id', 'active_task_path']


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

        related = related_in_tree(predecessor.id, successor.id)
        if related is not None:
            inner, outer = (predecessor, successor) if related[0] == predecessor.id \
                else (successor, predecessor)
            raise serializers.ValidationError({"detail": (
                f"“{inner.header}” is part of “{outer.header}”. A task cannot depend on "
                "its own parent or subtask."
            )})

        # Counts the tree: a parent's dependencies apply to all its subtasks.
        cycle = dependency_cycle(predecessor.id, successor.id)
        # UUIDs are serialized as strings in the JSON error payload.
        cycle = [str(node) for node in cycle] if cycle is not None else None
        if cycle is not None:
            raise serializers.ValidationError({
                "detail": "This dependency would create a cycle.",
                "cycle": cycle,
            })
        return attrs
