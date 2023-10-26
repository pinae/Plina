from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML, H1, TextInput
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from widgets.task_widget import TaskWidget
from tasks.models import Task


class TaskListView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.movable_list = None

    def handle_input_event(self, input_event):
        if input_event.name == "list_order":
            ordered_ids = input_event.data.split(',')
            all_tasks = Task.objects.order_by('-priority').all()
            ordered_tasks = []
            for id_no, ordered_id in enumerate(ordered_ids):
                for task in all_tasks:
                    if str(task.pk) == ordered_id:
                        task.priority = len(all_tasks) - id_no * 2
                        task.save()
                        ordered_tasks.append(task)
            if len(ordered_ids) != len(ordered_tasks):
                ordered_tasks = Task.objects.order_by('-priority').all()
            tasks = [TaskWidget({
                "header": t.header,
                "tags": list(t.tags.all()),
                "duration": t.duration,
                "time_spent": t.time_spent
            }, _id=str(t.pk)) for t in ordered_tasks]
            self.movable_list.nodes = tasks
            self.movable_list.widget_data = {'ids': [str(t.pk) for t in ordered_tasks]}

    def handle_request(self, request):
        ordered_tasks = Task.objects.order_by('-priority').all()
        tasks = [TaskWidget({
            "header": t.header,
            "tags": list(t.tags.all()),
            "duration": t.duration,
            "time_spent": t.time_spent
        }, _id=str(t.pk)) for t in ordered_tasks]
        self.movable_list = MovableListWidget(tasks)
        self.movable_list.widget_data = {'ids': [str(t.pk) for t in ordered_tasks]}
        return HTML(
            H1('Tasks'),
            self.movable_list,
        )
