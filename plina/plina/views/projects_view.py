from __future__ import annotations
from lona import AbstractNode
from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona_picocss.html import H1, H3, P, A
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from tasks.models import Project, Task
from widgets.project_widget import ProjectWidget
from tasks.sorters import set_priority_by_order
from widgets.task_widget import TaskWidget
from task_list_view import TaskListView
from uuid import UUID


def load_project_tasks(project_uuid_str):
    return Task.objects.filter(project_item__project__id=UUID(project_uuid_str)).order_by('-priority').all()


class ProjectsView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.movable_list = None

    def handle_request(self, request: Request) -> None | str | AbstractNode | dict:
        ordered_projects = Project.objects.order_by('-priority').all()
        self.movable_list = MovableListWidget(ProjectWidget, ordered_projects,
                                              ordering_class=Project,
                                              ordering_function=set_priority_by_order,
                                              load_children=load_project_tasks)
        return HTML(
            H1('Projekte'),
            self.movable_list,
        )


class SigleProjectView(TaskListView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.project = None

    def load_tasks(self):
        return self.project.tasks

    def base_query(self):
        return Task.objects.filter(project_item__project__id=self.project.pk)

    def save_additions_after_id_is_set(self):
        self.project.add(self.current_task)
        super().save_additions_after_id_is_set()

    def handle_request(self, request: Request) -> None | str | AbstractNode | dict:
        project_id = request.match_info['project_id']
        try:
            self.project = Project.objects.get(pk=UUID(project_id))
        except (Project.DoesNotExist, ValueError):
            return HTML(
                H1(f'Es gibt kein Projekt mit der ID {project_id}.'),
                P("Unter ", A("Projekte ", href='/projects'), "findest du die Liste aller Projekte."),
            )
        ordered_tasks = self.load_tasks()
        self.make_edit_task_modal()
        self.movable_list = MovableListWidget(TaskWidget, ordered_tasks,
                                              ordering_class=Task,
                                              ordering_function=set_priority_by_order,
                                              edit_function=self.edit_task)
        return HTML(
            H1(f'Projekt: {self.project.name}'),
            self.search_slot,
            H3('Tasks', _style={'margin': '1em 0 .5em 0'}),
            self.movable_list,
            self.edit_task_modal,
        )
