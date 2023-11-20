from lona.html import CLICK
from lona.static_files import StyleSheet
from lona_picocss.html import Span, Icon, Button
from widgets.helpers import minutely_str, str_to_timedelta
from widgets.tag_widget import TagWidget
from widgets.abstract_list_item import AbstractListItem


class TaskWidget(AbstractListItem):
    TAG_NAME = 'task-widget'

    STATIC_FILES = [
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['block-widget']
    EVENTS = [CLICK]

    def set_task_info(self, task_info: dict):
        self.task_info = task_info
        if 'edit_function' in task_info:
            self.edit_function = task_info['edit_function']
        self.header.set_text(task_info["header"])
        self.tag_list.nodes = [TagWidget(x) for x in task_info["tags"]]
        self.time_spent.set_text(minutely_str(task_info["time_spent"]))
        self.duration.set_text(minutely_str(task_info["duration"]))

    def handle_edit_click(self, input_event):
        if self.preview_mode:
            self.edit_function({
                'header': self.task_info["header"],
                'tags': self.task_info["tags"],
                'time_spent': self.task_info["time_spent"],
                'duration': self.task_info["duration"],
            })
        else:
            self.edit_function(str(self.id_list))

    def __init__(self, task_info: dict, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.task_info = task_info
        self.edit_function = task_info['edit_function']
        self.header = Span(task_info["header"], _class=["header"])
        self.tag_list = Span([TagWidget(x) for x in task_info["tags"]])
        self.time_spent = Span(minutely_str(task_info["time_spent"]))
        self.duration = Span(minutely_str(task_info["duration"]))
        self.time_info = Span([self.time_spent, "/", self.duration])
        self.preview_mode = "preview" in task_info and task_info["preview"]
        nodes = [Icon("move", stroke_width=2, color="#337d8d"), "&nbsp;"]
        if "immovable" in task_info and task_info["immovable"]:
            nodes = []
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
                       handle_click=self.handle_edit_click), "&nbsp;"]
        nodes += [self.header, "&nbsp;", self.tag_list, "&nbsp;", self.time_info]
        self.nodes = nodes
