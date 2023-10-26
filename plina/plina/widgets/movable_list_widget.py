from lona.html import Node, CHANGE
from lona.static_files import StyleSheet, Script
from lona_picocss.html import Div


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

    def __init__(self, list_nodes, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.nodes = list_nodes
