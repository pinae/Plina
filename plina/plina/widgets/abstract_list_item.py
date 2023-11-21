from lona.html import Node
from lona_picocss.html import Span
from typing import List
from tasks.models import Tag
from widgets.tag_widget import TagWidget


class AbstractListItem(Node):
    def set_header(self, new_header: str):
        self.header.nodes = [new_header]

    def set_tags(self, new_tag_list: List[Tag]):
        self.tag_list.nodes = [TagWidget(tag) for tag in new_tag_list]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.header = Span("", _class=["header"])
        self.tag_list = Span()
