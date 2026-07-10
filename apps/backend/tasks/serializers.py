from rest_framework import serializers
from .models import Task, Project, Tag, TimeBucket, TimeBucketType, TaskDependency
from .services.graph import would_create_cycle

class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = '__all__'

class TaskSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source='tags', many=True, write_only=True, required=False
    )
    hex_color = serializers.CharField(read_only=True)
    is_done = serializers.BooleanField(read_only=True)
    active_tracking_start = serializers.SerializerMethodField()

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
            'is_appointment', 'completed_at', 'is_done', 'active_tracking_start'
        ]

class ProjectSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    hex_color = serializers.CharField(read_only=True)
    task_ids = serializers.SerializerMethodField()

    def get_task_ids(self, project):
        return [task.id for task in project.tasks]

    class Meta:
        model = Project
        fields = ['id', 'name', 'description', 'tags', 'priority', 'order', 'task_ids', 'hex_color']

class TimeBucketTypeSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
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
        fields = ['id', 'start_date', 'duration', 'type', 'type_id']


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
