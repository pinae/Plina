from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona.view_runtime import ViewRuntime
from lona_picocss.html import H1, H3, Div
from widgets.calendar_widget import CalendarWidget
from tasks.models import Task
from datetime import datetime
from django.utils import timezone
WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


class CalendarView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.calendar_days = [
            {"name": WEEKDAYS[i], "widget": CalendarWidget()}
            for i in range(7)
        ]
        self.query_tasks()

    def query_tasks(self):
        now = timezone.now()
        for i in range(len(self.calendar_days)):
            self.calendar_days[i]["name"] = WEEKDAYS[datetime(
                year=now.year, month=now.month, day=now.day+i, hour=0, minute=0, tzinfo=now.tzinfo).weekday()]
            self.calendar_days[i]["widget"].set_tasks(list(
                Task.objects.filter(
                    start_date__gte=datetime(year=now.year, month=now.month, day=now.day+i, hour=0, minute=0,
                                             tzinfo=now.tzinfo)
                ).filter(
                    start_date__lt=datetime(year=now.year, month=now.month, day=now.day+i+1, hour=0, minute=0,
                                            tzinfo=now.tzinfo)
                ).order_by("start_date")
            ))

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
