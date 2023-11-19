from lona.html import Node
from lona_picocss.html import TextInput, InlineButton, Icon, Span
from widgets.task_widget import TaskWidget
from datetime import timedelta
from widgets.helpers import str_to_timedelta
import re


class TaskSearchAndInputWidget(Node):
    TAG_NAME = 'task-search-and-input-widget'

    def handle_text_change(self, input_event):
        def s(x):
            if x is None:
                return ""
            return x

        def second_time_block_is_more_complete(ts1, tp1, ts2, tp2):
            if ts2 is not None and tp2 is not None and (ts1 is None or tp1 is None):
                return True
            return len(s(ts2) + s(tp2)) >= len(s(ts1) + s(tp1))

        matches = self.regex.match(input_event.data)
        if matches:
            mg = matches.groupdict()
            if second_time_block_is_more_complete(mg['time_spent1'], mg['time_planned1'],
                                                  mg['time_spent2'], mg['time_planned2']):
                duration = str_to_timedelta(mg['time_planned2']) if (
                        type(mg['time_planned2']) is str and len(mg['time_planned2']) >= 2) else \
                    timedelta(hours=0)
                time_spent = str_to_timedelta(mg['time_spent2']) if (
                        type(mg['time_spent2']) is str and len(mg['time_spent2']) >= 2) else \
                    timedelta(minutes=0)
            else:
                duration = str_to_timedelta(mg['time_planned1']) if (
                        type(mg['time_planned1']) is str and len(mg['time_planned1']) >= 2) else \
                    timedelta(hours=0)
                time_spent = str_to_timedelta(mg['time_spent1']) if (
                        type(mg['time_spent1']) is str and len(mg['time_spent1']) >= 2) else \
                    timedelta(minutes=0)
            tag_str = mg['tags1'] if type(mg['tags1']) is str else "" + mg['tags2'] if type(mg['tags2']) is str else ""
            tags = [tag_candidate.strip() for tag_candidate in tag_str.split('#') if len(tag_candidate.strip()) > 0]
            self.task_preview.set_task_info({
                'header': mg['header'],
                'tags': tags,
                'duration': duration,
                'time_spent': time_spent,
                'expandable': False,
                'load_children_function': None,
                'expanded': False,
                'edit_function': self.edit_function,
                'immovable': True,
                'preview': True,
            })
        else:
            print("No Match:", input_event.data)

    def handle_plus(self, input_event):
        self.save_function(self.task_preview.task_info)
        self.search_slot.value = ""

    def handle_search(self, input_event):
        self.search_function(self.task_preview.task_info)

    def __init__(self, edit_function=None, save_function=None, search_function=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.edit_function = edit_function
        self.save_function = save_function
        self.search_function = search_function
        self.regex = re.compile(
            r"^(\s*((?P<time_spent1>\d+(,\d+)?[mhd])\/)?(?P<time_planned1>\d+(,\d+)?[mhd])\s*)?" +
            r"(?P<tags1>((#\S+)\s)*(#\S+))?(?P<header>.+?)?(?P<tags2>\s((#\S+)\s)*(#\S+))?" +
            r"(\s((?P<time_spent2>\d+(,\d+)?[mhd])\/)?(?P<time_planned2>\d+(,\d+)?[mhd])\s*)?\s*$")
        self.search_slot = TextInput(handle_change=self.handle_text_change, _style={
            'width': 'calc(100% - 120px)',
            'height': '3.2em',
            'vertical-align': 'top'})
        self.add_button = InlineButton(Icon("plus"), handle_click=self.handle_plus, _style={
            'width': '56px'})
        self.search_button = InlineButton(Icon("search"), handle_click=self.handle_search, _style={
            'width': '56px'})
        self.task_preview = TaskWidget({
            'header': "",
            'tags': [],
            'duration': timedelta(hours=0),
            'time_spent': timedelta(minutes=0),
            'expandable': False,
            'load_children_function': None,
            'expanded': False,
            'edit_function': self.edit_function,
            'immovable': True,
            'preview': True,
        }, _style={'width': "calc(100% - 6em)", 'margin-left': "6em"})
        self.nodes = [self.search_slot, '&nbsp;', self.add_button, '&nbsp;', self.search_button,
                      Span("Vorschau:", _style={'float': "left"}), self.task_preview]
