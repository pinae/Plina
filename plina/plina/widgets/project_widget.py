from lona import RedirectResponse
from lona.html import Node, CLICK
from lona.static_files import StyleSheet
from lona_picocss.html import Span, Icon, Button
from widgets.tag_widget import TagWidget
from widgets.movable_list_widget import MovableListWidget
from widgets.task_widget import TaskWidget
from tasks.models import Task
from tasks.sorters import set_priority_by_order


class ProjectWidget(Node):
    TAG_NAME = 'project-widget'

    STATIC_FILES = [
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['block-widget']
    EVENTS = [CLICK]

    def expand_toggle(self, input_event):
        if self.expand_icon.name == "chevron-down":
            tasks = self.load_children_function(str(self.id_list))
            self.nodes.append(
                MovableListWidget(TaskWidget, tasks,
                                  ordering_class=Task,
                                  ordering_function=set_priority_by_order,
                                  _style={
                                      'border': '1px solid #000000',
                                      'border-radius': '5px',
                                      'margin-top': '5px'
                                  })
            )
            self.style['padding-bottom'] = "5px"
            self.expand_icon.name = "chevron-up"
        else:
            self.nodes.pop(-1)
            self.style['padding-bottom'] = 0
            self.expand_icon.name = "chevron-down"

    def handle_input_event(self, input_event):
        if (input_event.type == CLICK._symbol and
                input_event.target_node is not None and
                input_event.target_node.tag_name in ['span', 'tag-widget', 'project-widget']):
            project_widget = input_event.node
            while len(str(project_widget.id_list)) != 36 and project_widget.parent is not None:
                project_widget = project_widget.parent
            if len(str(project_widget.id_list)) == 36:
                return RedirectResponse(f'/project/{project_widget.id_list}')

    def __init__(self, task_info: dict, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.load_children_function = task_info['load_children_function']
        self.edit_function = task_info['edit_function']
        self.header = Span(task_info["name"], _class=["header"])
        self.expand_icon = Icon("chevron-down" if not task_info['expanded'] else "chevron-up",
                                stroke_width=2, color="#337d8d")
        self.tag_list = Span([TagWidget(x) for x in task_info["tags"]])
        nodes = [Icon("move", stroke_width=2, color="#337d8d"), "&nbsp;"]
        if task_info['expandable'] and task_info['load_children_function'] is not None:
            nodes += [
                Button(self.expand_icon,
                       _style={
                           'border': 0,
                           'display': 'inline-block',
                           'width': 'auto',
                           'background': 'none',
                           'margin': 0,
                           'padding': 0,
                       },
                       handle_click=self.expand_toggle), "&nbsp;"]
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
        nodes += [
            self.header, "&nbsp;",
            self.tag_list]
        self.nodes = nodes
