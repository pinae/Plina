# ------------- #
# Lona Settings #
# ------------- #

MAX_WORKER_THREADS = 4
MAX_STATIC_THREADS = 4
MAX_RUNTIME_THREADS = 6

ROUTING_TABLE = 'routes.py::routes'

STATIC_DIRS = [
    'static',
]

TEMPLATE_DIRS = [
    'templates',
]

# lona-picocss
# remove this whole section to get a vanilla HTML style
import lona_picocss

MIDDLEWARES = [
    'lona_picocss.middlewares.LonaPicocssMiddleware',
    'lona_picocss.middlewares.DjangoCollectStaticMiddleware',
    'lona_django.middlewares.DjangoSessionMiddleware',
]

TEMPLATE_DIRS.append(lona_picocss.settings.TEMPLATE_DIR)
STATIC_DIRS.append(lona_picocss.settings.STATIC_DIR)
FRONTEND_TEMPLATE = lona_picocss.settings.FRONTEND_TEMPLATE
ERROR_403_VIEW = lona_picocss.Error403View
ERROR_404_VIEW = lona_picocss.Error404View
ERROR_500_VIEW = lona_picocss.Error500View

PICOCSS_BRAND = 'Plina'
PICOCSS_LOGO = 'plina_logo.svg'

def get_navigation(server, request):
    return [
        lona_picocss.NavItem(
            title='Calendar',
            url=server.reverse('calendar'),
        ),
        lona_picocss.NavItem(
            title='Projects',
            url=server.reverse('projects'),
        ),
        lona_picocss.NavItem(
            title='Tasks',
            url=server.reverse('task_list'),
        ),
    ]


PICOCSS_NAVIGATION = get_navigation
# end lona-picocss
