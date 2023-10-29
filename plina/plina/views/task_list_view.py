from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML, H1
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from widgets.task_widget import TaskWidget
from tasks.models import Task
from tasks.sorters import set_priority_by_order


class TaskListView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.movable_list = None

    def handle_request(self, request):
        ordered_tasks = Task.objects.order_by('-priority').all()
        self.movable_list = MovableListWidget(TaskWidget, ordered_tasks,
                                              ordering_class=Task,
                                              ordering_function=set_priority_by_order)
        return HTML(
            H1('Tasks'),
            self.movable_list,
        )
