# Single-container "web app" image: builds the frontend, then serves the
# built static assets straight from the FastAPI backend on one port. This is
# the containerized alternative to the two-process dev setup in
# docker-compose.yml — one image, `docker run`, open a browser.
#
# @srl-labs/clab-ui is a private GitHub Packages dependency, so the frontend
# build stage needs a token with `read:packages` passed as a BuildKit secret
# (never baked into a layer as a build ARG):
#
#   DOCKER_BUILDKIT=1 docker build --secret id=github_token,env=GITHUB_TOKEN -t netlab-ui .

# ---- frontend build stage ----
FROM node:24-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/.npmrc ./
RUN --mount=type=secret,id=github_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/github_token)" npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend runtime stage ----
FROM python:3.11-slim
RUN apt-get update && apt-get install -y git docker.io curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/services ./services
RUN pip install --no-cache-dir .

# netlab and Ansible intentionally are not installed in this UI image. Point
# Settings → Environment at an existing/mounted netlab executable, or set
# NETLAB_BIN. The backend probes that executable's Python environment for
# netsim metadata, so it does not need a second netlab installation of its own.

# containerlab — netlab's default provider — so `netlab up`, status and shell
# actions work out of the box. libvirt-based providers are still not included.
RUN bash -c "$(curl -sL https://get.containerlab.dev)"

COPY --from=frontend-build /app/dist ./frontend_dist
ENV FRONTEND_DIST_DIR=/app/frontend_dist

# NOTE: containerlab drives the host's Docker daemon to create lab nodes, so
# the container must be run with access to a Docker daemon — mount the socket
# (`-v /var/run/docker.sock:/var/run/docker.sock`) or run with `--privileged`.

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
