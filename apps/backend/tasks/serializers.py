from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from datetime import timedelta

from .models import (CalendarSubscription, Marker, Task, Tag, TimeBucket, TimeBucketType, TaskDependency,
                     TrackingSession, UserSettings)
from .services.colors import ensure_auto_colors, ensure_bucket_type_colors, from_hex, to_hex
from .services.estimates import (clear_completion_snapshot, record_estimate_change,
                                 write_completion_snapshot)
from .services.tree import (TreeIndex, dependency_cycle, earliest_ancestor_deadline,
                            next_sibling_order, parent_change_error, related_in_tree)

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
    #: The chosen color (§4.4); null = inherit (a top-level task: automatic).
    #: Read back with ``hex_color`` (shown) and ``inherited_hex_color``.
    own_hex_color = serializers.RegexField(
        HEX_COLOR_PATTERN, required=False, allow_null=True, write_only=True,
        error_messages={"invalid": "Colors must look like #3357ff."},
    )
    is_done = serializers.BooleanField(read_only=True)
    active_tracking_start = serializers.SerializerMethodField()
    parent_id = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.all(), source='parent', required=False, allow_null=True,
    )
    #: Why the estimate changes (history, §4.6); plain edits are "edited".
    estimate_reason = serializers.ChoiceField(
        choices=['edited', 'set_to_sum', 'raised_from_warning'], write_only=True, required=False,
    )
    #: Repeats (README: Recurring tasks): the rule as typed, e.g. "every
    #: tuesday at 20:00"; "" stops the repetition after this occurrence.
    #: Read back with ``recurrence_description``, ``occurrence`` & co.
    recurrence = serializers.CharField(required=False, allow_blank=True, max_length=256, write_only=True,
                                       trim_whitespace=True)
    #: A recurring task's edit applies to this occurrence only, or to the
    #: following open ones too.
    scope = serializers.ChoiceField(choices=['this', 'following'], write_only=True, required=False)
    #: A named deadline (README: Calendar): the deadline is the marker's
    #: start and moves with it; read back as ``deadline_marker``.
    deadline_marker_id = serializers.PrimaryKeyRelatedField(
        queryset=Marker.objects.all(), source='deadline_marker', required=False, allow_null=True, write_only=True,
    )
    #: Compared with the calendar: its changes Plina kept back are settled.
    calendar_resolved = serializers.BooleanField(write_only=True, required=False)

    #: What “this and the following” passes on to the following occurrences.
    FOLLOWING_FIELDS = ('header', 'description', 'duration', 'priority', 'color', 'tags', 'latest_finish_date',
                        'start_date', 'is_appointment', 'parent')

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
        data['own_hex_color'] = to_hex(task.color)
        data['hex_color'] = tree.effective_color(task.id)
        data['inherited_hex_color'] = tree.inherited_color(task.id)
        data.update(self._recurrence(task))
        marker = task.deadline_marker
        data['deadline_marker'] = {
            'id': marker.id, 'title': marker.title,
            'start': serializers.DateTimeField().to_representation(marker.start),
        } if marker is not None else None
        data['calendar'] = self._calendar(task)
        return data

    def _calendar(self, task):
        """The calendar event the task follows (README: Calendar), with the
        event as last read — for "Compare with the calendar"."""
        link = next(iter(task.calendar_links.all()), None)
        if link is None:
            return None
        return {'id': link.subscription_id, 'name': link.subscription.name, 'event': link.data,
                'pending': link.pending}

    def _recurrence(self, task) -> dict:
        """The series a task is an occurrence of (README: Recurring tasks)."""
        if task.series_id is None:
            return {'recurrence': None, 'recurrence_description': None, 'series_id': None,
                    'occurrence': None, 'next_occurrence': None, 'occurrence_count': 0}
        from .services.recurrence import RecurrenceError, describe, parse_rule
        from .services.series import next_after, occurrence_counts
        series = task.series
        counts = self.context.setdefault('_occurrence_counts', {})
        if series.id not in counts:  # one query for a whole list
            counts.update(occurrence_counts(
                [item.series_id for item in (self.parent.instance if self.parent is not None else [task])]
                + [series.id]))
        try:
            description = describe(parse_rule(series.recurrence))
        except RecurrenceError:
            description = series.recurrence
        moment = serializers.DateTimeField()
        following = next_after(series, task.occurrence)
        return {'recurrence': series.recurrence, 'recurrence_description': description,
                'series_id': series.id, 'occurrence': moment.to_representation(task.occurrence),
                'next_occurrence': moment.to_representation(following) if following else None,
                'occurrence_count': counts.get(series.id, 0)}

    def _pop_color(self, validated_data):
        """``own_hex_color`` -> the model's rgb bytes (only when given)."""
        own = validated_data.pop('own_hex_color', self._UNSET)
        if own is not self._UNSET:
            validated_data['color'] = from_hex(own) if own else None

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
            error = parent_change_error(instance, new_parent)
            if error is not None:
                raise serializers.ValidationError(error)
        if instance is None and new_parent not in (self._UNSET, None) and new_parent.series_id is not None:
            from .services.series import subtasks_refused
            raise serializers.ValidationError({'parent_id': [subtasks_refused(new_parent)]})
        marker = attrs.get('deadline_marker')
        if marker is not None:
            attrs['latest_finish_date'] = marker.start  # due at the marker
        elif ('latest_finish_date' in attrs and 'deadline_marker' not in attrs and instance is not None
              and instance.deadline_marker is not None
              and attrs['latest_finish_date'] != instance.deadline_marker.start):
            attrs['deadline_marker'] = None  # a date of its own now
        if attrs.get('recurrence'):
            from .services.recurrence import RecurrenceError, parse_rule
            try:
                parse_rule(attrs['recurrence'])
            except RecurrenceError as error:
                raise serializers.ValidationError({'recurrence': [str(error)]})
            if instance is not None and instance.children.exists():
                raise serializers.ValidationError({'recurrence': [
                    f'“{instance.header}” has subtasks: a task with subtasks cannot repeat. '
                    'Repeat its subtasks instead.']})
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

    def _repeat(self, task, text):
        from .services.recurrence import RecurrenceError
        from .services.series import make_recurring
        from .services.settings import ensure_active_is_project
        try:
            make_recurring(task, text)
        except RecurrenceError as error:
            raise serializers.ValidationError({'recurrence': [str(error)]})
        ensure_active_is_project()  # a recurring task holds no tasks

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop('estimate_reason', None)
        validated_data.pop('scope', None)
        validated_data.pop('calendar_resolved', None)
        recurrence = validated_data.pop('recurrence', '')
        self._pop_color(validated_data)
        if 'order' not in validated_data:
            parent = validated_data.get('parent')
            validated_data['order'] = next_sibling_order(parent.id if parent else None)
        task = super().create(validated_data)
        record_estimate_change(task, None, task.duration, 'created')
        if task.completed_at is not None:
            write_completion_snapshot(task)
        ensure_auto_colors()  # a new project
        if recurrence:
            self._repeat(task, recurrence)
        return task

    @transaction.atomic
    def update(self, instance, validated_data):
        reason = validated_data.pop('estimate_reason', 'edited')
        recurrence = validated_data.pop('recurrence', None)
        scope = validated_data.pop('scope', 'this')
        if validated_data.pop('calendar_resolved', False):
            instance.calendar_links.update(pending=[])
        self._pop_color(validated_data)
        following = {field: value for field, value in validated_data.items() if field in self.FOLLOWING_FIELDS}
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
        if recurrence is not None:
            self._repeat(task, recurrence)
        if scope == 'following' and following:
            from .services.series import apply_to_following
            apply_to_following(task, following)
        ensure_auto_colors()  # moved to the top level
        return task

    class Meta:
        model = Task
        fields = [
            'id', 'header', 'description', 'place', 'start_date', 'duration',
            'latest_finish_date', 'deadline_marker_id', 'calendar_resolved', 'time_spent', 'priority', 'tags',
            'tag_ids', 'own_hex_color', 'is_fixed',
            'is_appointment', 'completed_at', 'is_done', 'active_tracking_start',
            'parent_id', 'order', 'estimate_reason', 'recurrence', 'scope',
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

    def validate_time_zone(self, value):
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        if value:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise serializers.ValidationError(
                    f'“{value}” is not a known time zone. Use a name like “Europe/Berlin”.')
        return value

    def validate(self, attrs):
        """The Week view's time frame must not be empty (one end may come
        alone; it is checked against the stored other one)."""
        start = attrs.get('week_view_start', self.instance.week_view_start if self.instance else None)
        end = attrs.get('week_view_end', self.instance.week_view_end if self.instance else None)
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError({'week_view_end': [
                f'The end must be after the start ({start:%H:%M}), e.g. 08:00 to 16:45.'
            ]})
        return attrs

    def validate_active_task_id(self, task):
        from .services.settings import is_project
        if task is None:
            return task
        if task.is_done:
            raise serializers.ValidationError(
                f'“{task.header}” is completed. Choose an open project.')
        if task.series_id is not None:
            raise serializers.ValidationError(
                f'“{task.header}” repeats: it cannot hold tasks. Choose a project.')
        if not is_project(task):
            raise serializers.ValidationError(
                f'“{task.header}” is a single step inside “{task.parent.header}”. Choose a '
                'project (a top-level task) or a task with subtasks.')
        return task

    class Meta:
        model = UserSettings
        fields = ['default_duration', 'active_task_id', 'active_task_path', 'time_zone',
                  'week_view_start', 'week_view_end']


class MoveSerializer(serializers.Serializer):
    """Body of POST tasks/{id}/move/ (T-1): the new parent (null = top level)
    and the position among its subtasks."""
    parent_id = serializers.PrimaryKeyRelatedField(queryset=Task.objects.all(), allow_null=True)
    index = serializers.IntegerField(min_value=0)


class TimeBucketTypeSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source='tags', many=True,
        write_only=True, required=False,
    )
    #: The color its buckets show: the chosen one, else the automatic one.
    hex_color = serializers.CharField(read_only=True)
    #: The chosen color (§4.4); null = automatic (``auto_hex_color``).
    own_hex_color = serializers.RegexField(
        HEX_COLOR_PATTERN, required=False, allow_null=True, write_only=True,
        error_messages={"invalid": "Colors must look like #3357ff."},
    )

    def to_representation(self, bucket_type):
        data = super().to_representation(bucket_type)
        data['own_hex_color'] = to_hex(bucket_type.color)
        data['auto_hex_color'] = to_hex(bucket_type.auto_color)
        return data

    def _pop_color(self, validated_data):
        if 'own_hex_color' in validated_data:
            own = validated_data.pop('own_hex_color')
            validated_data['color'] = from_hex(own) if own else None

    def create(self, validated_data):
        self._pop_color(validated_data)
        bucket_type = super().create(validated_data)
        ensure_bucket_type_colors()
        bucket_type.refresh_from_db(fields=['auto_color'])
        return bucket_type

    def validate(self, attrs):
        """A special bucket (README: Calendar) has both ends of its frame."""
        instance = self.instance
        start = attrs.get('special_start', instance.special_start if instance else None)
        end = attrs.get('special_end', instance.special_end if instance else None)
        if (start is None) != (end is None):
            raise serializers.ValidationError({'special_end': ['A special bucket needs a start and an end.']})
        if start is not None and end <= start:
            raise serializers.ValidationError({'special_end': ['The end must be after the start.']})
        return attrs

    def update(self, instance, validated_data):
        self._pop_color(validated_data)
        if validated_data.get('start_times', instance.start_times) != instance.start_times:
            # A new rule counts from now ("every other week", "10 times").
            validated_data['anchor'] = timezone.now()
        return super().update(instance, validated_data)

    class Meta:
        model = TimeBucketType
        # Explicit: '__all__' leaked the raw rgb bytes as base64.
        fields = ['id', 'name', 'start_times', 'duration', 'tags', 'tag_ids',
                  'hex_color', 'own_hex_color', 'special_start', 'special_end', 'is_special', 'calendar']
        # Empty: buckets placed by hand — or, special, the whole frame.
        extra_kwargs = {'start_times': {'allow_blank': True}}

    is_special = serializers.BooleanField(read_only=True)
    calendar = serializers.SerializerMethodField()

    def get_calendar(self, bucket_type):
        link = bucket_type.calendar_links.select_related('subscription').first()
        return {'id': link.subscription_id, 'name': link.subscription.name} if link is not None else None

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


class MarkerSerializer(serializers.ModelSerializer):
    """A marker (README: Calendar): a conference, a holiday, a deadline."""
    end = serializers.DateTimeField(read_only=True)
    all_day = serializers.SerializerMethodField()
    calendar = serializers.SerializerMethodField()
    #: How many tasks have it as their deadline.
    deadline_task_count = serializers.SerializerMethodField()

    def get_all_day(self, marker):
        from .services.markers import is_all_day
        return is_all_day(marker)

    def get_calendar(self, marker):
        link = marker.calendar_links.select_related('subscription').first()
        return {'id': link.subscription_id, 'name': link.subscription.name} if link is not None else None

    def get_deadline_task_count(self, marker):
        return marker.deadline_tasks.count()

    def validate_duration(self, value):
        if value < timedelta(0):
            raise serializers.ValidationError('The duration cannot be negative.')
        return value

    class Meta:
        model = Marker
        fields = ['id', 'title', 'description', 'place', 'start', 'duration', 'end', 'all_day', 'calendar',
                  'deadline_task_count']


class CalendarSubscriptionSerializer(serializers.ModelSerializer):
    """A calendar Plina reads (README: Calendar). The address is secret: it
    is written, never read back — ``url_hint`` names its host."""
    url = serializers.CharField(write_only=True, max_length=2048)
    url_hint = serializers.SerializerMethodField()
    hex_color = serializers.RegexField(HEX_COLOR_PATTERN, required=False,
                                       error_messages={"invalid": "Colors must look like #3357ff."})

    def get_url_hint(self, subscription):
        from urllib.parse import urlsplit
        host = urlsplit(subscription.url).hostname or ''
        return f'{host} …' if host else ''

    def validate_url(self, value):
        from .services.calendar_sync import CalendarError, normalize_url
        try:
            return normalize_url(value)
        except CalendarError as error:
            raise serializers.ValidationError(str(error))

    class Meta:
        model = CalendarSubscription
        fields = ['id', 'name', 'url', 'url_hint', 'email', 'hex_color', 'last_synced_at', 'last_error']
        read_only_fields = ['last_synced_at', 'last_error']


class TrackingSessionSerializer(serializers.ModelSerializer):
    """Tracked time (README: Time sheet): when, on which task; ``running``
    while it is being tracked, ``seconds`` until its end or now."""
    task_id = serializers.PrimaryKeyRelatedField(queryset=Task.objects.all(), source='task')
    task_header = serializers.CharField(source='task.header', read_only=True)
    task_tags = TagSerializer(source='task.tags', many=True, read_only=True)
    running = serializers.SerializerMethodField()
    seconds = serializers.SerializerMethodField()

    class Meta:
        model = TrackingSession
        fields = ['id', 'task_id', 'task_header', 'task_tags', 'start', 'end', 'running', 'seconds']

    def get_running(self, session) -> bool:
        return session.end is None

    def get_seconds(self, session) -> int:
        from django.utils import timezone
        return max(0, round(((session.end or timezone.now()) - session.start).total_seconds()))
