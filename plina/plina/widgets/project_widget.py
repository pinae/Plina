from lona.html import Node, CLICK
from lona.static_files import StyleSheet


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
