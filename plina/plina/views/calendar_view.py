from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona.view_runtime import ViewRuntime
from lona_picocss.html import H1, Div
from calendar_widget import CalendarWidget


class CalendarView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.calendar_days = [
            CalendarWidget(),
        ]

    def handle_request(self, request: Request):
        return HTML(
            H1('Calendar'),
            Div(self.calendar_days),
        )
