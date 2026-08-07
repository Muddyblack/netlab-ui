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
# Pinned to the *build* platform: the frontend output is arch-independent, so
# building it under QEMU for the arm64 variant would cost minutes for nothing.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# Generated here rather than copied from the build context: the token normally
# lives in the developer's ~/.npmrc, which Docker cannot see. Only the
# *variable name* is written to the layer — the value arrives from the secret
# mount at `npm ci` time and is never baked in.
RUN printf '%s\n' \
      '@srl-labs:registry=https://npm.pkg.github.com' \
      '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' \
      > .npmrc
# patches/ must land before `npm ci`: the postinstall hook runs patch-package,
# and with no patches directory it silently no-ops — shipping an unpatched
# clab-ui (wrong palette tab order) instead of failing the build.
COPY frontend/patches ./patches
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
# `[assistant]` ships the AI assistant's SDKs, so the API-key providers
# (OpenAI, Gemini, OpenAI-compatible) work in the container once the user
# supplies a key. The feature still stays off until NETLAB_APP_ASSISTANT is
# set — this means "available without rebuilding", not "on by default".
#
# The CLI-driven providers (Claude Code, Codex, Antigravity) are a different
# story: they drive an already-logged-in CLI on the host, so they stay
# unavailable here unless that CLI and its credentials are mounted in. The
# provider probes report exactly that in Settings, so nothing breaks silently.
RUN pip install --no-cache-dir ".[assistant]"

# netlab and Ansible intentionally are not installed in this UI image. Point
# Settings → Environment at an existing/mounted netlab executable, or set
# NETLAB_BIN. The backend probes that executable's Python environment for
# netsim metadata, so it does not need a second netlab installation of its own.

# containerlab — netlab's default provider — so `netlab up`, status and shell
# actions work out of the box. libvirt-based providers are still not included.
# Pinned so a rebuild of an old tag produces the same image; bump deliberately.
ARG CONTAINERLAB_VERSION=v0.77.0
RUN bash -c "$(curl -sL https://get.containerlab.dev)" -- -v "${CONTAINERLAB_VERSION}"

COPY --from=frontend-build /app/dist ./frontend_dist
ENV FRONTEND_DIST_DIR=/app/frontend_dist

# NOTE: containerlab drives the host's Docker daemon to create lab nodes, so
# the container must be run with access to a Docker daemon — mount the socket
# (`-v /var/run/docker.sock:/var/run/docker.sock`) or run with `--privileged`.

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Populates the GHCR package page (README, repo link, license) instead of the
# "no description" placeholder a pulled-from-nowhere image would show.
LABEL org.opencontainers.image.source="https://github.com/Muddyblack/netlab-ui" \
      org.opencontainers.image.description="Web UI for netlab — topology editor, lab lifecycle and device consoles in one container." \
      org.opencontainers.image.licenses="Apache-2.0"
