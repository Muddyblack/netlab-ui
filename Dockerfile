# Single-container "web app" image: builds the frontend, then serves the built
# static assets straight from the FastAPI backend on one port — one image,
# `docker compose up` (docker-compose.yml) or `docker run`, open a browser.
#
# Two targets: the default (`ui`) is the UI only; `--target full` adds netlab,
# Ansible and containerlab for a self-contained install (see the bottom).
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
# app/main.py. docker.io — the backend enumerates and cleans up lab containers
# through the Docker CLI. curl is gone with the containerlab installer that
# was its only user.
RUN apt-get update && apt-get install -y --no-install-recommends git docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/services ./services
# `[assistant]` ships the AI assistant's SDKs, so the API-key providers
# (OpenAI, Gemini, OpenAI-compatible) work in the container once the user
# supplies a key. The feature still stays off until NETLAB_APP_ASSISTANT is
# set — this means "available without rebuilding", not "on by default".
#
# The CLI-driven providers (Claude Code, Codex, Antigravity) are a different
# story: they drive an already-logged-in CLI on the host, so they stay
# unavailable here unless that CLI and its credentials are mounted in. The
# provider probes report exactly that in Settings, so nothing breaks silently.
#
# setuptools-scm has no .git here; the version comes from the build arg below.
ARG NETLAB_GUI_VERSION=0.0+container
ENV SETUPTOOLS_SCM_PRETEND_VERSION=${NETLAB_GUI_VERSION}
RUN pip install --no-cache-dir ".[assistant]"

COPY --from=frontend-build /app/dist ./frontend_dist
ENV FRONTEND_DIST_DIR=/app/frontend_dist
# Shown in the About dialog; release builds pass the tag.
ENV NETLAB_GUI_VERSION=${NETLAB_GUI_VERSION}
# Enables the container self-checks (Settings → Environment → Container
# Setup) even where /.dockerenv is missing (podman, some runtimes).
ENV NETLAB_GUI_IN_CONTAINER=1

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
CMD ["uvicorn", "app.main:app"]

# Populates the GHCR package page (README, repo link, license) instead of the
# "no description" placeholder a pulled-from-nowhere image would show.
LABEL org.opencontainers.image.source="https://github.com/Muddyblack/netlab-ui" \
      org.opencontainers.image.licenses="Apache-2.0"

# ---- "full" image: UI + netlab + Ansible + containerlab ----
# `docker build --target full .` — for machines that have Docker but no
# netlab install, or anyone who wants one pinned, self-contained toolchain.
# Everything runs against the host's Docker daemon exactly like the UI-only
# image; the difference is only where the netlab/containerlab binaries live.
FROM runtime AS full
ARG CLAB_VERSION=0.79.0
# openssh-client/sshpass: Ansible's network_cli for SSH-managed devices.
# iproute2: containerlab and netlab's link/bridge helpers.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-client sshpass iproute2 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir ".[netlab]"
# The official containerlab image ships the static binary at this path.
COPY --from=ghcr.io/srl-labs/clab:${CLAB_VERSION} /usr/bin/containerlab /usr/bin/containerlab
LABEL org.opencontainers.image.description="Web UI for netlab with netlab, Ansible and containerlab bundled — topology editor, lab lifecycle and device consoles in one container."

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
