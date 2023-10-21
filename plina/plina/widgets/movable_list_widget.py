from lona.html import Node, CLICK
from lona.static_files import StyleSheet
from lona_picocss.html import Div


class MovableListWidget(Node):
    TAG_NAME = 'movable-list-widget'

    STATIC_FILES = [
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['movable-list']
    EVENTS = [CLICK]

    def __init__(self, list_nodes, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.nodes = list_nodes
