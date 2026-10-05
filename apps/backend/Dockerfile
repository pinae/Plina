# The Plina backend: Django behind gunicorn on port 5000 (README: Deployment
# with Docker). Build context: the repository root. Works with the classic
# builder too (Ansible's community.docker.docker_image).
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH

RUN pip install --no-cache-dir uv==0.8.17

WORKDIR /app
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/backend/ ./
RUN chmod 755 docker-entrypoint.sh \
    && useradd --system --uid 10001 --create-home --home-dir /home/plina plina \
    && mkdir -p /app/static /app/media \
    && chown plina:plina /app/static /app/media

# Production unless told otherwise (the settings: README).
ENV DEBUG=False \
    WEB_CONCURRENCY=3
EXPOSE 5000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/healthz', timeout=4)"]
# Starts as root to hand the volumes to the plina user, then runs as plina:
# migrations, collectstatic, then the command.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
# WEB_CONCURRENCY workers; planning a long horizon may take a while.
CMD ["gunicorn", "plina.wsgi:application", "--bind", "0.0.0.0:5000", "--timeout", "120", "--access-logfile", "-"]
