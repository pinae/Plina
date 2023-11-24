from __future__ import annotations
from typing import List
from lona_picocss.html import Div, Span
from lona.html import Node, CLICK
from lona.static_files import StyleSheet, StaticFile
from datetime import datetime, timedelta
from tasks.models import Task, TimeBucket


class CalendarWidget(Node):
    TAG_NAME = 'calendar-widget'

    STATIC_FILES = [
        StyleSheet(
            name='calendar-widget',
            path='../static/calendar-widget.css',
        ),
        StaticFile(
            name='calendar-background.svg',
            path='../static/calendar-background.svg',
        ),
    ]

    CLASS_LIST = ['calendar-widget']
    EVENTS = [CLICK]
    STYLE = {"position": "relative"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # setting up widget data
        # will be available as `this.data` in the widget
        self.widget_data = {
            'tasks': [],
        }

        self.nodes = []

    def set_tasks_and_time_buckets(self, task_list: List[Task], time_buckets: List[TimeBucket] | None = None):
        def top_offset(start: datetime) -> str:
            return "{:d}px".format(round(
                            (start-datetime(year=start.year, month=start.month, day=start.day, tzinfo=start.tzinfo))
                            / timedelta(hours=1) * 60))

        def height_from_duration(duration: timedelta) -> str:
            return "{:d}px".format(round(duration / timedelta(hours=1) * 60))

        self.nodes = []
        if type(time_buckets) is list:
            for time_bucket in time_buckets:
                self.nodes.append(
                    Div(
                        Span(time_bucket.type.name,
                             _style={"width": height_from_duration(time_bucket.duration)}),
                        _class=["time-bucket"],
                        _style={
                            "top": top_offset(time_bucket.start_date),
                            "height": height_from_duration(time_bucket.duration),
                        }
                    )
                )
        for task in task_list:
            self.nodes.append(
                Div(
                    Div(task.header, _class=["task-header"]),
                    Div(task.description),
                    _class=["task"],
                    _style={
                        "top": top_offset(task.start_date),
                        "height": height_from_duration(task.duration),
                    }
                )
            )
