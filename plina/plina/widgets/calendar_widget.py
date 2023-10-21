from lona_picocss.html import Div
from lona.html import Node, CLICK
from lona.static_files import StyleSheet, StaticFile
from datetime import datetime, timedelta


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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # setting up widget data
        # will be available as `this.data` in the widget
        self.widget_data = {
            'tasks': [],
        }

        self.nodes = []

    def set_tasks(self, task_list):
        self.nodes = []
        for task in task_list:
            self.nodes.append(
                Div(
                    Div(task.header, _class=["task-header"]),
                    Div(task.description),
                    _style={
                        "margin-top": "{:d}px".format(round(
                            (task.start_date-datetime(year=task.start_date.year, month=task.start_date.month,
                                                      day=task.start_date.day, tzinfo=task.start_date.tzinfo))
                            / timedelta(hours=1) * 60)
                        ),
                        "height": "{:d}px".format(round(task.duration / timedelta(hours=1) * 60))
                    }
                )
            )
