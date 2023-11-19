from lona.routing import Route, MATCH_ALL
from aiohttp_wsgi import WSGIHandler
from plina.wsgi import application

wsgi_handler = WSGIHandler(application)

routes = [
    Route('/projects', 'views/projects_view.py::ProjectsView', name='projects'),
    Route('/project/<project_id>', 'views/projects_view.py::SigleProjectView', name='project'),
    Route('/task_list', 'views/task_list_view.py::TaskListView', name='task_list'),
    Route('/', 'views/calendar_view.py::CalendarView', name='calendar'),
    Route(MATCH_ALL, wsgi_handler, http_pass_through=True),
]
