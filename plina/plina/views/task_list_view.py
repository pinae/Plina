from __future__ import annotations
from lona.request import Request
from lona.server import Server
from lona.view import LonaView
from lona.html import HTML
from lona_picocss.html import H1, Modal, InlineButton, TextInput, TextArea
from lona.view_runtime import ViewRuntime
from widgets.movable_list_widget import MovableListWidget
from widgets.task_widget import TaskWidget
from widgets.datetime_widget import DatetimeWidget
from widgets.task_search_and_input_widget import TaskSearchAndInputWidget
from tasks.models import Task, Tag
from tasks.sorters import set_priority_by_order
from django.db.models import Q
from uuid import UUID
from datetime import timedelta


class TaskListView(LonaView):
    def __init__(self, server: Server, view_runtime: ViewRuntime, request: Request):
        super().__init__(server, view_runtime, request)
        self.movable_list = None
        self.current_task = None
        self.edit_task_modal = None
        self.task_header_input = None
        self.task_description_input = None
        self.task_start_datetime = None
        self.task_tag_list = None
        self.search_slot = TaskSearchAndInputWidget(edit_function=self.edit_task,
                                                    save_function=self.immediate_save,
                                                    search_function=self.search)

    def make_edit_task_modal(self):
        self.edit_task_modal = Modal()
        self.task_header_input = TextInput()
        self.task_description_input = TextArea()
        self.task_start_datetime = DatetimeWidget()
        self.task_tag_list = TextInput()
        self.edit_task_modal.get_body().nodes = [
            self.task_header_input,
            self.task_description_input,
            self.task_start_datetime,
            self.task_tag_list,
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

    def set_modal_inputs(self):
        self.task_header_input.value = self.current_task.header
        self.task_description_input.value = self.current_task.description
        self.task_start_datetime.initial_value = self.current_task.start_date
        self.task_start_datetime.value = self.current_task.start_date

    @staticmethod
    def create_task_from_info_dict(task_info: dict):
        tags = []
        for t in task_info['tags']:
            if type(t) is Tag:
                tags.append(t.name)
            elif type(t) is str:
                tags.append(t)
        new_task = Task(
            header=task_info['header'],
            time_spent=task_info['time_spent'],
            duration=task_info['duration'],
        )
        return new_task, tags

    def edit_task(self, task_uuid_or_info: str | dict):
        if type(task_uuid_or_info) is dict:
            self.current_task, tags = self.create_task_from_info_dict(task_uuid_or_info)
            self.task_tag_list.value = ", ".join(['#' + tag for tag in tags])
        elif type(task_uuid_or_info) is str:
            self.current_task = Task.objects.get(id=UUID(task_uuid_or_info))
            self.task_tag_list.value = ", ".join(['#' + tag.name for tag in self.current_task.tags.all()])
        else:
            print(task_uuid_or_info)
            raise ValueError("Please supply a valid task_uuid.")
        self.set_modal_inputs()
        self.edit_task_modal.open()

    def save_task(self, input_event):
        self.current_task.header = self.task_header_input.value
        self.current_task.description = self.task_description_input.value
        self.current_task.start_date = self.task_start_datetime.value
        self.current_task.save()
        for tag in self.current_task.tags.all():
            self.current_task.tags.remove(tag)
        for tag_chunk in self.task_tag_list.value.split(','):
            for raw_tag in tag_chunk.split('#'):
                if len(raw_tag.strip()) < 1:
                    continue
                try:
                    self.current_task.tags.add(Tag.objects.get(name=raw_tag.strip()))
                except Tag.DoesNotExist:
                    new_tag = Tag(name=raw_tag.strip())
                    new_tag.save()
                    self.current_task.tags.add(new_tag)
        self.current_task.save()
        ordered_tasks = Task.objects.order_by('-priority').all()
        self.movable_list.create_nodes(ordered_tasks)
        self.edit_task_modal.close()

    def immediate_save(self, task_info):
        self.current_task, tags = self.create_task_from_info_dict(task_info)
        self.task_tag_list.value = ", ".join(['#' + tag for tag in tags])
        self.set_modal_inputs()
        self.save_task(input_event=None)

    def search(self, task_info):
        print(task_info)
        query = Task.objects
        if type(task_info['header']) is str and len(task_info['header']) > 0:
            query = query.filter(Q(header__icontains=task_info['header']) | Q(description__icontains=task_info['header']))
        if task_info['duration'] > timedelta(minutes=0):
            query = query.filter(duration=task_info['duration'])
        if task_info['time_spent'] > timedelta(minutes=0):
            query = query.filter(time_spent__gte=task_info['time_spent'] - timedelta(seconds=30),
                                 time_spent__lt=task_info['time_spent'] + timedelta(seconds=30))
        for tag_name in task_info['tags']:
            query = query.filter(tags__name=tag_name)
        filtered_tasks = query.order_by('-priority').all()
        self.movable_list.create_nodes(filtered_tasks)

    def handle_request(self, request):
        ordered_tasks = Task.objects.order_by('-priority').all()
        self.make_edit_task_modal()
        self.movable_list = MovableListWidget(TaskWidget, ordered_tasks,
                                              ordering_class=Task,
                                              ordering_function=set_priority_by_order,
                                              edit_function=self.edit_task)
        return HTML(
            self.search_slot,
            H1('Tasks', _style={'margin': '1em 0 .5em 0'}),
            self.movable_list,
            self.edit_task_modal,
        )
