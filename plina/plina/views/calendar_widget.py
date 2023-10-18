from lona_picocss.html import Div
from lona.html import Node, CLICK
from lona.static_files import StyleSheet, StaticFile


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

        self.nodes = [
            Div("Foo"),
        ]

    def set_tasks(self, task_list):
        self.widget_data['tasks'] = task_list
