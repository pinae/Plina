from lona.html import Node, CLICK
from lona.static_files import StyleSheet, Script
from widgets.abstract_list import AbstractList


class GanttOrderWidget(AbstractList):
    TAG_NAME = 'gantt-order-widget'

    WIDGET = 'GanttOrder'

    STATIC_FILES = [
        Script(
            name='gantt-order',
            path='../static/gantt-order.js',
        ),
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['gantt-order']
    EVENTS = [CLICK]

    def handle_input_event(self, input_event):
        if input_event.name == "drag_position":
            self.order_change(input_event.data)
        elif input_event.name == "drag_start":
            self.order_change({'x': 0, 'y': 0, 'id': input_event.data})

    def __init__(self, widget_class, items, order_change, load_children=None, edit_function=None,
                 **kwargs):
        self.order_change = order_change
        super().__init__(widget_class=widget_class, items=items, load_children=load_children,
                         edit_function=edit_function, **kwargs)
