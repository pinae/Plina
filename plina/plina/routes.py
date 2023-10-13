from lona.routing import Route, MATCH_ALL
from aiohttp_wsgi import WSGIHandler
from plina.wsgi import application

wsgi_handler = WSGIHandler(application)

routes = [
    Route('/projects', 'views/home.py::ProjectsView', name='projects'),
    Route('/task_list', 'views/task_list.py::TaskListView', name='task_list'),
    Route('/', 'views/home.py::ProjectsView', name='home'),
    Route(MATCH_ALL, wsgi_handler, http_pass_through=True),
]
