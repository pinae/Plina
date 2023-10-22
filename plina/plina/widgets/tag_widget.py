from lona.html import Node, CLICK
from lona.static_files import StyleSheet
from tasks.models import Tag


class TagWidget(Node):
    TAG_NAME = 'tag-widget'

    STATIC_FILES = [
        StyleSheet(
            name='base-widgets',
            path='../static/base-widgets.css',
        ),
    ]

    CLASS_LIST = ['hashtag']
    EVENTS = [CLICK]

    def __init__(self, tag: Tag, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.nodes = "#{}".format(tag.name)
