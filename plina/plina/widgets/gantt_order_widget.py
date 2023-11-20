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
