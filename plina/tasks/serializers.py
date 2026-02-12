from rest_framework import serializers
from .models import Task, Project, Tag, TimeBucket, TimeBucketType

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

    class Meta:
        model = Task
        fields = [
            'id', 'header', 'description', 'start_date', 'duration',
            'latest_finish_date', 'time_spent', 'priority', 'tags', 'tag_ids', 'hex_color', 'is_fixed'
        ]

class ProjectSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    hex_color = serializers.CharField(read_only=True)

    class Meta:
        model = Project
        fields = ['id', 'name', 'description', 'tags', 'priority', 'order', 'hex_color']

class TimeBucketTypeSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    hex_color = serializers.CharField(read_only=True)

    class Meta:
        model = TimeBucketType
        fields = '__all__'

class TimeBucketSerializer(serializers.ModelSerializer):
    type = TimeBucketTypeSerializer(read_only=True)
    
    class Meta:
        model = TimeBucket
        fields = '__all__'
