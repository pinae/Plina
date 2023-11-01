from lona.html import Node, CLICK
from lona.static_files import StyleSheet
from lona_picocss.html import Span, Icon, Button
from widgets.helpers import minutely_str
from widgets.tag_widget import TagWidget


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
        self.edit_function = task_info['edit_function']
        self.header = Span(task_info["header"], _class=["header"])
        self.tag_list = Span([TagWidget(x) for x in task_info["tags"]])
        self.time_spent = Span(minutely_str(task_info["time_spent"]))
        self.duration = Span(minutely_str(task_info["duration"]))
        self.time_info = Span([self.time_spent, "/", self.duration])
        nodes = [Icon("move", stroke_width=2, color="#337d8d"), "&nbsp;"]
        if self.edit_function is not None:
            nodes += [
                Button(Icon("edit", stroke_width=2, color="#337d8d"),
                       _style={
                           'border': 0,
                           'display': 'inline-block',
                           'width': 'auto',
                           'background': 'none',
                           'margin': 0,
                           'padding': 0,
                       },
                       handle_click=lambda i: self.edit_function(str(self.id_list))), "&nbsp;"]
        nodes += [self.header, "&nbsp;", self.tag_list, "&nbsp;", self.time_info]
        self.nodes = nodes
