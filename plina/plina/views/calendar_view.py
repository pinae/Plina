from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona.view_runtime import ViewRuntime
from lona_picocss.html import H1, H3, Div
from calendar_widget import CalendarWidget


class CalendarView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.calendar_days = [
            {"name": "Mo", "widget": CalendarWidget()},
            {"name": "Di", "widget": CalendarWidget()},
            {"name": "Mi", "widget": CalendarWidget()},
            {"name": "Do", "widget": CalendarWidget()},
            {"name": "Fr", "widget": CalendarWidget()},
            {"name": "Sa", "widget": CalendarWidget()},
            {"name": "So", "widget": CalendarWidget()},
        ]

    def handle_request(self, request: Request):
        return HTML(
            H1('Calendar'),
            Div(
                Div(
                    [
                        Div(
                            H3(x["name"], _style={
                                "font-size": "12px",
                                "margin": "0 auto",
                                "font-weight": "bold",
                                "text-align": "center"
                            }),
                            x["widget"],
                            _style={"display": "table-cell"})
                        for x in self.calendar_days],
                    _style={"display": "table-row"}),
                _style={"display": "table"}
            )
        )
