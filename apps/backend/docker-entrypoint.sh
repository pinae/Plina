#!/bin/sh
# The backend container's start (README: Deployment with Docker):
#  1. as root: hand the static/media volumes (host directories, too) to the
#     plina user, then continue as plina;
#  2. bring the database up to date (PLINA_MIGRATE=0 skips it) and collect
#     the admin's static files for nginx (PLINA_COLLECTSTATIC=0 skips it);
#  3. run the command (gunicorn, or e.g. manage.py createsuperuser).
set -e
if [ "$(id -u)" = "0" ]; then
    for dir in /app/static /app/media; do
        mkdir -p "$dir"
        [ "$(stat -c %u "$dir")" = "$(id -u plina)" ] || chown -R plina:plina "$dir"
    done
    export HOME=/home/plina  # gunicorn's control socket lives there
    exec setpriv --reuid=plina --regid=plina --init-groups "$0" "$@"
fi
if [ "${PLINA_MIGRATE:-1}" != "0" ]; then
    python manage.py migrate --noinput
fi
if [ "${PLINA_COLLECTSTATIC:-1}" != "0" ]; then
    python manage.py collectstatic --noinput --verbosity 0
fi
exec "$@"
