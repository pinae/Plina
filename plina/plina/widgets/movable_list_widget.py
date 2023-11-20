from lona.html import CHANGE
from lona.static_files import StyleSheet, Script
from widgets.abstract_list import AbstractList


class MovableListWidget(AbstractList):
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

    def handle_input_event(self, input_event):
        if input_event.name == "list_order":
            ordered_ids = input_event.data.split(',')
            ordered_items = self.ordering_function(self.ordering_class, ordered_ids)
            self.set_nodes(ordered_items)

    def __init__(self, widget_class, items, ordering_class, ordering_function, load_children=None, edit_function=None,
                 *args, **kwargs):
        self.ordering_class = ordering_class
        self.ordering_function = ordering_function
        super().__init__(widget_class=widget_class, items=items, load_children=load_children,
                         edit_function=edit_function, *args, **kwargs)
