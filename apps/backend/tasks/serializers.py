from rest_framework import serializers
from .models import Task, Project, Tag, TimeBucket, TimeBucketType, TaskDependency
from .services.graph import would_create_cycle

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
    project_id = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.all(), source='project',
        write_only=True, required=False, allow_null=True,
    )

    def to_representation(self, task):
        data = super().to_representation(task)
        project = task.project
        data['project_id'] = project.id if project is not None else None
        return data

    _UNSET = object()

    def _assign_project(self, task, project):
        current = task.project
        if current == project:
            return
        if current is not None:
            current.remove(task)
        if project is not None:
            project.add(task)

    def create(self, validated_data):
        project = validated_data.pop('project', self._UNSET)
        task = super().create(validated_data)
        if project is not self._UNSET:
            self._assign_project(task, project)
        return task

    def update(self, instance, validated_data):
        project = validated_data.pop('project', self._UNSET)
        task = super().update(instance, validated_data)
        if project is not self._UNSET:
            self._assign_project(task, project)
        return task

    def get_active_tracking_start(self, task):
        session = task.tracking_sessions.filter(end=None).first()
        return session.start if session is not None else None

    def validate(self, attrs):
        instance = self.instance
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

    class Meta:
        model = Task
        fields = [
            'id', 'header', 'description', 'start_date', 'duration',
            'latest_finish_date', 'time_spent', 'priority', 'tags', 'tag_ids', 'hex_color', 'is_fixed',
            'is_appointment', 'completed_at', 'is_done', 'active_tracking_start', 'project_id'
        ]

class ProjectSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source='tags', many=True,
        write_only=True, required=False,
    )
    hex_color = serializers.CharField(read_only=True)
    task_ids = serializers.SerializerMethodField()

    def get_task_ids(self, project):
        return [task.id for task in project.tasks]

    class Meta:
        model = Project
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
