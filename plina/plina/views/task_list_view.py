from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona_picocss.html import H1, Modal, InlineButton, TextInput, TextArea
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from widgets.task_widget import TaskWidget
from tasks.models import Task
from tasks.sorters import set_priority_by_order
from uuid import UUID


class TaskListView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.movable_list = None
        self.current_task = None
        self.edit_task_modal = None
        self.task_header_input = None
        self.task_description_input = None

    def make_edit_task_modal(self):
        self.edit_task_modal = Modal()
        self.task_header_input = TextInput()
        self.task_description_input = TextArea()
        self.edit_task_modal.get_body().nodes = [
            self.task_header_input,
            self.task_description_input,
        ]
        self.edit_task_modal.get_footer().nodes = [
            InlineButton(
                'Abbrechen',
                secondary=True,
                handle_click=lambda i: self.edit_task_modal.close(),
            ),
            InlineButton(
                'Speichern',
                handle_click=self.save_task,
            ),
        ]

    def edit_task(self, task_uuid):
        self.current_task = Task.objects.get(id=UUID(task_uuid))
        self.task_header_input.value = self.current_task.header
        self.task_description_input.value = self.current_task.description
        self.edit_task_modal.open()

    def save_task(self, input_event):
        self.current_task.header = self.task_header_input.value
        self.current_task.description = self.task_description_input.value
        self.current_task.save()
        ordered_tasks = Task.objects.order_by('-priority').all()
        self.movable_list.create_nodes(ordered_tasks)
        self.edit_task_modal.close()

    def handle_request(self, request):
        ordered_tasks = Task.objects.order_by('-priority').all()
        self.make_edit_task_modal()
        self.movable_list = MovableListWidget(TaskWidget, ordered_tasks,
                                              ordering_class=Task,
                                              ordering_function=set_priority_by_order,
                                              edit_function=self.edit_task)
        return HTML(
            H1('Tasks'),
            self.movable_list,
            self.edit_task_modal,
        )
