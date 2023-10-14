from lona.view import LonaView
from lona.html import HTML, H1, Li, Ul
from tasks.models import Task


class TaskListView(LonaView):
    def handle_request(self, request):
        project_lis = [Li(str(t)) for t in Task.objects.all()]
        return HTML(
            H1('Tasks'),
            Ul(project_lis)
        )
