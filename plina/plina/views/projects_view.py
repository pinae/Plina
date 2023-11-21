from __future__ import annotations
from typing import List
from lona import AbstractNode
from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona_picocss.html import H1, H3, P, A
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from widgets.gantt_order_widget import GanttOrderWidget
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
        self.movable_list = MovableListWidget(widget_class=ProjectWidget,
                                              items=ordered_projects,
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
        self.gantt_list = GanttOrderWidget(widget_class=TaskWidget,
                                           items=None,
                                           order_change=self.change_task_order,
                                           edit_function=self.edit_task)
        self.movable_list = self.gantt_list

    def compress_task_order(self) -> List[Task]:
        task_list = list(self.load_tasks())
        rising_order = 0
        current_order = task_list[0].project_item.order
        for task in task_list:
            if task.project_item.order == current_order:
                task.project_item.order = rising_order
            elif task.project_item.order > current_order:
                current_order = task.project_item.order
                rising_order += 1
                task.project_item.order = rising_order
            task.project_item.save()
        return task_list

    def change_task_order(self, change_info: dict):
        if change_info['y'] == 0:
            try:
                task = Task.objects.get(pk=change_info['id'])
                task.project_item.order = max(task.project_item.order + change_info['x'], 0)
                task.project_item.save()
            except Task.DoesNotExist:
                print(f"Unable to reorder: There is no Task with ID {change_info['id']}.")
        else:
            task_list = list(self.load_tasks())
            moving_task = None
            moving_task_index = -1
            for i, task in enumerate(task_list):
                if str(task.pk) == change_info['id']:
                    moving_task = task
                    moving_task_index = i
                    break
            target_order = task_list[max(min(moving_task_index + change_info['y'], len(task_list)-1), 0)].project_item.order
            for i in range(len(task_list)-1, moving_task_index + change_info['y']-1, -1):
                task_list[i].project_item.order = task_list[i].project_item.order + 1 \
                    if change_info['y'] < 0 else max(task_list[i].project_item.order - 1, 0)
                task_list[i].project_item.save()
            moving_task.project_item.order = target_order
            moving_task.project_item.save()
        self.gantt_list.set_nodes(self.compress_task_order())

    def load_tasks(self):
        return self.project.tasks

    def base_query(self):
        return Task.objects.filter(project_item__project__id=self.project.pk)

    def search_order(self, query):
        return query.order_by('project_item__order', '-priority')

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
        self.gantt_list.set_nodes(ordered_tasks)
        return HTML(
            H1(f'Projekt: {self.project.name}'),
            self.search_slot,
            H3('Tasks', _style={'margin': '1em 0 .5em 0'}),
            self.gantt_list,
            self.edit_task_modal,
        )
