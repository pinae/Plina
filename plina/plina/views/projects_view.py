from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML, H1
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from tasks.models import Project, Task
from widgets.project_widget import ProjectWidget
from tasks.sorters import set_priority_by_order
from uuid import UUID


class ProjectsView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.movable_list = None

    @staticmethod
    def load_project_tasks(project_uuid_str):
        return Task.objects.filter(project_item__project__id=UUID(project_uuid_str)).order_by('-priority').all()

    def handle_request(self, request):
        ordered_projects = Project.objects.order_by('-priority').all()
        self.movable_list = MovableListWidget(ProjectWidget, ordered_projects,
                                              ordering_class=Project,
                                              ordering_function=set_priority_by_order,
                                              load_children=self.load_project_tasks)
        return HTML(
            H1('Projekte'),
            self.movable_list,
        )
