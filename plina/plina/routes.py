from lona.routing import Route, MATCH_ALL
from aiohttp_wsgi import WSGIHandler
from plina.wsgi import application

wsgi_handler = WSGIHandler(application)

routes = [
    Route('/projects', 'views/projects.py::ProjectsView', name='projects'),
    Route('/task_list', 'views/task_list.py::TaskListView', name='task_list'),
    Route('/', 'views/calendar.py::CalendarView', name='calendar'),
    Route(MATCH_ALL, wsgi_handler, http_pass_through=True),
]
