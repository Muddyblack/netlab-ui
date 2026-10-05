# Single-container "web app" image: builds the frontend, then serves the built
# static assets straight from the FastAPI backend on one port — one image,
# `docker compose up` (docker-compose.yml) or `docker run`, open a browser.
#
# Scope of the default image: the *UI*, not a netlab distribution. netlab, Ansible and
# containerlab all stay on the host, where whoever runs this already has them.
# The container talks to that host install through NETLAB_BIN / Settings →
# Environment and the mounted Docker socket. Keeping the toolchain out means
# no version skew against the netlab the user actually runs, and it is what
# lets this ship as a netlab *tool* rather than a parallel install of one.

# ---- frontend build stage ----
# Pinned to the *build* platform: the frontend output is arch-independent, so
# building it under QEMU for the arm64 variant would cost minutes for nothing.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# patches/ must land before `npm ci`: the postinstall hook runs patch-package,
# and with no patches directory it silently no-ops — shipping an unpatched
# clab-ui (wrong palette tab order) instead of failing the build.
COPY frontend/patches ./patches
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend runtime base (shared by both images) ----
FROM python:3.11-slim AS runtime
# git — lab file history/diffs (app/lab/files.py) and the version string in
# app/main.py. docker-cli — the backend (and netlab) talk to the host's Docker
# daemon through the mounted socket. Debian's docker.io is only the daemon
# since trixie; the CLI is its own package (a mere Recommends of docker.io).
# curl is gone with the containerlab installer that was its only user.
RUN apt-get update && apt-get install -y --no-install-recommends git docker-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/services ./services
# The netlab monitoring plugin (Settings / lab "Monitoring"): the UI links it into
# ~/.netlab when a lab turns monitoring on.
COPY monitoring/plugin/monitoring ./monitoring_plugin
ENV NETLAB_APP_MONITORING_PLUGIN=/app/monitoring_plugin
# The base install includes the MCP server that the user's own AI agent
# (Claude Code, Codex, Copilot, Cursor, Kiro, …) connects to; it is served on the
# same port under /mcp, token-protected. NETLAB_APP_ASSISTANT=off disables it.
#
# setuptools-scm has no .git here; the version comes from the build arg below.
ARG NETLAB_GUI_VERSION=0.0+container
ENV SETUPTOOLS_SCM_PRETEND_VERSION=${NETLAB_GUI_VERSION}
RUN pip install --no-cache-dir .

COPY --from=frontend-build /app/dist ./frontend_dist
ENV FRONTEND_DIST_DIR=/app/frontend_dist
# Shown in the About dialog; release builds pass the tag.
ENV NETLAB_GUI_VERSION=${NETLAB_GUI_VERSION}
# Enables the container self-checks (Settings → Environment → Container
# Setup) even where /.dockerenv is missing (podman, some runtimes).
ENV NETLAB_GUI_IN_CONTAINER=1
# The image runs as root with the privileges described below. netlab's default
# clab commands prepend sudo, which this image neither needs nor installs.
# These defaults also cover `docker exec ... netlab up`, outside the UI.
ENV NETLAB_PROVIDERS_CLAB_START="containerlab deploy --reconfigure -t clab.yml" \
    NETLAB_PROVIDERS_CLAB_STOP="containerlab destroy --cleanup -t clab.yml"

# The backend drives the *host's* Docker daemon through the mounted socket, so
# how the container is started decides whether labs can deploy at all. The
# backend inspects its own container at startup and explains anything missing
# in the UI; the short version is:
#
#   --privileged --network host --pid host          containerlab netns/veth work
#   -v /var/run/docker.sock:/var/run/docker.sock    the host Docker daemon
#   -v $PWD/labs:$PWD/labs -e NETLAB_WORKSPACE=$PWD/labs
#       workspace at the SAME path as on the host: containerlab asks the host
#       daemon to bind-mount node files by their in-container path
#   -v $HOME/.netlab:/root/.netlab                  netlab's running-lab registry,
#       shared with `netlab status` on the host and kept across restarts
#
# See docker-compose.yml for the same thing as a ready-to-run file.
# uvicorn reads UVICORN_HOST/UVICORN_PORT, so `-e UVICORN_HOST=127.0.0.1`
# (what docker-compose.yml does with host networking) needs no CMD override.
ENV UVICORN_HOST=0.0.0.0 UVICORN_PORT=8000
EXPOSE 8000
# No curl in the image; the stdlib does the probe. Loopback works for both the
# default 0.0.0.0 bind and the compose file's 127.0.0.1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('UVICORN_PORT', '8000'), timeout=4)"
CMD ["uvicorn", "app.main:app"]

# Populates the GHCR package page (README, repo link, license) instead of the
# "no description" placeholder a pulled-from-nowhere image would show.
LABEL org.opencontainers.image.source="https://github.com/Muddyblack/netlab-ui" \
      org.opencontainers.image.licenses="Apache-2.0"

# ---- default image: the UI only ----
# netlab, Ansible and containerlab stay on the host, where whoever runs this
# already has them: no version skew against the netlab the user actually runs.
# Point Settings → Environment (or NETLAB_BIN) at the host's netlab install,
# mounted into the container at the same path. The backend probes that
# executable's Python environment for netsim metadata, so it does not need a
# second netlab installation of its own.
#
# A few backend features shell out to `containerlab` directly rather than
# through netlab — link impairment (`tools netem set`), orphaned-instance
# cleanup (`destroy --cleanup`) and post-start link reconcile (`apply`). It is
# a static Go binary, so bind-mounting the host's copy enables them:
#
#   -v /usr/bin/containerlab:/usr/bin/containerlab:ro
#
# Without it those three features report containerlab as unavailable in
# Settings → Environment; nothing else is affected.
FROM runtime AS ui
LABEL org.opencontainers.image.description="Web UI for netlab — topology editor, lab lifecycle and device consoles in one container."
