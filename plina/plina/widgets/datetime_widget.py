from lona.html import Node, HTML, CLICK, CHANGE
#from lona_picocss.html import Switch
from lona.html import CheckBox as Switch
from lona.static_files import StyleSheet, Script
from datetime import datetime, timedelta
from django.utils import timezone
from math import ceil
import typing


class DatetimeWidget(Node):
    TAG_NAME = 'datetime-widget'

    WIDGET = 'DatetimeWidget'

    STATIC_FILES = [
        StyleSheet(
            name='datetime-widget-styles',
            path='../static/datetime-widget.css',
        ),
        Script(
            name='datetime-widget-script',
            path='../static/datetime-widget.js',
        ),
    ]

    CLASS_LIST = ['datetime-widget']
    EVENTS = [CLICK, CHANGE]

    def set_formatted_data(self, dt):
        self.widget_data = {
            'is_set': self.switch.value,
            'date_str': "{:04d}-{:02d}-{:02d}".format(dt.year, dt.month, dt.day),
            'time_str': "{:02d}:{:02d}".format(dt.hour, dt.minute),
        }

    def handle_input_event(self, input_event):
        if input_event.name == "change":
            self._value = datetime(
                year=input_event.data['year'],
                month=input_event.data['month'],
                day=input_event.data['day'],
                hour=input_event.data['hour'],
                minute=input_event.data['minute'],
                tzinfo=self.tzinfo)
            self.set_formatted_data(self._value)
            return None
        if input_event.name == "click" and input_event.target_node == self.switch:
            self.toggle_switch(input_event)
        else:
            return input_event

    def set_value_by_rounding_now(self):
        now = timezone.now()
        self.tzinfo = now.tzinfo
        self._value = now + timedelta(minutes=int(ceil(now.minute / 15) * 15) - now.minute,
                                      seconds=-now.second, microseconds=-now.microsecond)

    def toggle_switch(self, input_event):
        self.switch.value = not self.switch.value
        if self.switch.value:
            self._value = self.initial_value
            if self.value is None:
                self.set_value_by_rounding_now()
            self.set_formatted_data(self._value)
        else:
            self.value = None

    def get_value(self):
        return self._value

    def set_value(self, value: typing.Optional[datetime]):
        if value is None:
            self.switch.value = False
            self.set_value_by_rounding_now()
        else:
            self.switch.value = True
            self.tzinfo = value.tzinfo
            self._value = value
        self.set_formatted_data(self._value)

    value = property(get_value, set_value)

    def __init__(self, value: typing.Optional[datetime] = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.switch = Switch(True)
        self.initial_value = value
        self.value = value
        self.nodes = [self.switch, HTML(
            '<input type="date" value="{:04d}-{:02d}-{:02d}">'.format(
                self._value.year, self._value.month, self._value.day) +
            '<input type="time" value="{:02d}:{:02d}" style="margin-left: 1em;">'.format(
                self._value.hour, self._value.minute))]
