from lona.html import Node, CHANGE
from lona.static_files import StyleSheet, Script


class MovableListWidget(Node):
    TAG_NAME = 'movable-list-widget'

    WIDGET = 'MovableList'

    STATIC_FILES = [
        Script(
            name='movable-list',
            path='../static/movable-list.js',
        ),
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['movable-list']
    EVENTS = [CHANGE]

    def create_nodes(self, items):
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

    def handle_input_event(self, input_event):
        if input_event.name == "list_order":
            ordered_ids = input_event.data.split(',')
            ordered_items = self.ordering_function(self.ordering_class, ordered_ids)
            self.create_nodes(ordered_items)

    def __init__(self, widget_class, items, ordering_class, ordering_function, load_children=None, edit_function=None,
                 *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ordering_class = ordering_class
        self.ordering_function = ordering_function
        self.widget_class = widget_class
        self.load_children = load_children
        self.edit_function = edit_function
        self.create_nodes(items)
