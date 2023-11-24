from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona.view_runtime import ViewRuntime
from lona_picocss.html import H1, H3, Div
from widgets.calendar_widget import CalendarWidget
from tasks.models import Task
from tasks.planner import gather_time_buckets
from datetime import datetime, timedelta
from django.utils import timezone
WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


class CalendarView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.calendar_days = [
            {"name": WEEKDAYS[i], "widget": CalendarWidget()}
            for i in range(4)
        ]
        self.query_tasks()

    def query_tasks(self):
        now = timezone.now()
        for i in range(len(self.calendar_days)):
            day_start = datetime(year=now.year, month=now.month, day=now.day, hour=0, minute=0,
                                 tzinfo=now.tzinfo) + timedelta(days=i)
            day_end = day_start + timedelta(days=1)
            self.calendar_days[i]["name"] = WEEKDAYS[day_start.weekday()]
            self.calendar_days[i]["widget"].set_tasks_and_time_buckets(list(
                Task.objects.filter(start_date__gte=day_start).filter(start_date__lt=day_end).order_by("start_date")
            ), gather_time_buckets(day_start, day_end))

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
                _class=["whole-calendar"],
                _style={"display": "table"}
            )
        )
