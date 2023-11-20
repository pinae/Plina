from __future__ import annotations
from lona.html import Node


class AbstractList(Node):
    def set_nodes(self, items: list):
        nodes = [self.widget_class({
            'name': item.name if 'name' in dir(item) else "",
            'header': item.header if 'header' in dir(item) else "",
            'tags': list(item.tags.all()) if 'tags' in dir(item) else [],
            'duration': item.duration if 'duration' in dir(item) else "",
            'time_spent': item.time_spent if 'time_spent' in dir(item) else "",
            'expandable': self.load_children is not None,
            'load_children_function': self.load_children,
            'expanded': False,
            'edit_function': self.edit_function,
        }, _id=str(item.pk)) for item in items]
        self.widget_data = {'ids': [str(item.pk) for item in items]}
        self.nodes = nodes

    def __init__(self, widget_class, items=None, load_children=None, edit_function=None, **kwargs):
        super().__init__()
        self.widget_class = widget_class
        self.load_children = load_children
        self.edit_function = edit_function
        self.set_nodes(items if items is not None else [])
