from lona.view import LonaView
from lona.html import HTML, H1


class CalendarView(LonaView):
    def handle_request(self, request):
        return HTML(
            H1('Calendar'),
        )
