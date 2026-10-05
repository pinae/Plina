"""``GET /healthz``: "ok" when the database answers, 503 otherwise — for
Docker's health checks and the reverse proxy (README: Deployment with
Docker). First in the middleware, so the probe needs no allowed host
(containers probe 127.0.0.1) and skips the per-request settings lookup."""
from django.db import DatabaseError, connection
from django.http import HttpResponse


class HealthCheckMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path != "/healthz":
            return self.get_response(request)
        try:
            connection.ensure_connection()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except DatabaseError:
            return HttpResponse("database unavailable", status=503, content_type="text/plain")
        return HttpResponse("ok", content_type="text/plain")
