# The Plina nginx container: the built frontend, the API proxied to the
# backend container, the admin's static files and the media from their
# volumes (README: Deployment with Docker). Build context: the repository
# root (yarn workspace). Works with the classic builder too (Ansible).
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json yarn.lock ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN yarn install --frozen-lockfile --non-interactive
COPY apps/frontend apps/frontend
# Where the browser finds the API: "/" = the page's own origin (nginx
# proxies /api/), or e.g. https://plina.example.com.
ARG VITE_BACKEND_URL=/
RUN VITE_BACKEND_URL="$VITE_BACKEND_URL" yarn workspace @plina/frontend build

FROM nginx:1.29-alpine
# apps/frontend/nginx/nginx.conf: the default below, or Ansible's template.
COPY apps/frontend/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/frontend/dist /usr/share/nginx/html
RUN mkdir -p /app/static /app/media
# Healthy when nginx answers at all (also while the backend restarts).
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -S -O /dev/null http://127.0.0.1/healthz 2>&1 | grep -q 'HTTP/' || exit 1
