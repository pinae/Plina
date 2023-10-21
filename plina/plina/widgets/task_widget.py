from lona.html import Node, CLICK
from lona.static_files import StyleSheet
from lona_picocss.html import Span, Icon
from widgets.helpers import minutely_str


class TaskWidget(Node):
    TAG_NAME = 'task-widget'

    STATIC_FILES = [
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['block-widget']
    EVENTS = [CLICK]

    def __init__(self, task_info: dict, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.header = Span(task_info["header"], _class=["header"])
        self.tag_list = Span([Span(x) for x in task_info["tags"]])
        self.time_spent = Span(minutely_str(task_info["time_spent"]))
        self.duration = Span(minutely_str(task_info["duration"]))
        self.time_info = Span([self.time_spent, "/", self.duration])
        self.nodes = [Icon("move", stroke_width=2, color="#337d8d"), "&nbsp;",
                      self.header, "&nbsp;",
                      self.tag_list, "&nbsp;",
                      self.time_info]
