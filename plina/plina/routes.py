from lona.routing import Route, MATCH_ALL
from aiohttp_wsgi import WSGIHandler
from plina.wsgi import application

wsgi_handler = WSGIHandler(application)

routes = [
    Route(MATCH_ALL, wsgi_handler, http_pass_through=True),
]
