from __future__ import annotations
from typing import Type
from lona.html import Node
from widgets.abstract_list_item import AbstractListItem
from widgets.task_widget import TaskWidget
from widgets.tag_widget import TagWidget


class AbstractList(Node):
    def set_nodes(self, items: list):
        nodes = []
        for item in items:
            item_found = False
            for node in self.nodes:
                if str(node.id_list) == str(item.pk):
                    item_found = True
                    node.set_header(item.header if 'header' in dir(item) else "")
                    node.set_tags(list(item.tags.all()) if 'tags' in dir(item) else [])
                    if type(node) is TaskWidget:
                        node.set_duration(item.duration if 'duration' in dir(item) else "")
                        node.set_time_spent(item.time_spent if 'time_spent' in dir(item) else "")
                    nodes.append(node)
            if not item_found:
                nodes.append(self.widget_class({
                    'name': item.name if 'name' in dir(item) else "",
                    'header': item.header if 'header' in dir(item) else "",
                    'tags': list(item.tags.all()) if 'tags' in dir(item) else [],
                    'duration': item.duration if 'duration' in dir(item) else "",
                    'time_spent': item.time_spent if 'time_spent' in dir(item) else "",
                    'order': item.project_item.order if 'has_project' in dir(item) and item.has_project() else 0,
                    'expandable': self.load_children is not None,
                    'load_children_function': self.load_children,
                    'expanded': False,
                    'edit_function': self.edit_function,
                }, _id=str(item.pk)))
        self.nodes = nodes
        self.widget_data = {'items': [{
            'id': str(item.pk),
            'order': item.project_item.order if 'has_project' in dir(item) and item.has_project() else 0}
            for item in items]}

    def __init__(self, widget_class: Type[AbstractListItem],
                 items=None, load_children=None, edit_function=None, **kwargs):
        super().__init__()
        self.widget_class = widget_class
        self.load_children = load_children
        self.edit_function = edit_function
        self.set_nodes(items if items is not None else [])
