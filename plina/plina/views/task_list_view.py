from lona.view import LonaView
from lona.html import HTML, H1
from widgets.movable_list_widget import MovableListWidget
from widgets.task_widget import TaskWidget
from tasks.models import Task


class TaskListView(LonaView):
    def handle_request(self, request):
        tasks = [TaskWidget({
            "header": t.header,
            "tags": list(t.tags.all()),
            "duration": t.duration,
            "time_spent": t.time_spent
        }) for t in Task.objects.all()]
        return HTML(
            H1('Tasks'),
            MovableListWidget(tasks)
        )
