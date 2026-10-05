# Running It as One Container

The dev setup (see [CONTRIBUTING](../CONTRIBUTING.md)) runs the backend and frontend as two separate processes. The root [`Dockerfile`](../Dockerfile) instead builds the frontend and bakes the static output straight into the FastAPI backend, so the whole app is one image on one port — same shape as [containerlab-app](https://github.com/srl-labs/containerlab-app)'s web app / desktop split, minus the split: our backend already _is_ the thing their `clab-api-server` is, so there's no separate API service to stand up first.

The image is the UI only. netlab, Ansible and containerlab stay on the host (install them with your package manager, pip or Nix) and the container uses that install, so the UI never drifts from the netlab you actually run.

## Quick start

```bash
NETLAB_BIN=$(command -v netlab) CLAB_DIR=$(dirname "$(command -v containerlab)") \
  docker compose up -d        # uses docker-compose.yml; labs live in ./labs
```

Open `http://localhost:8000`. The equivalent `docker run`:

```bash
mkdir -p "$PWD/labs"
docker run -d --name netlab-ui \
  --privileged --network host --pid host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/run/netns:/var/run/netns \
  -v "$PWD/labs:$PWD/labs" -e NETLAB_WORKSPACE="$PWD/labs" \
  -v "$HOME/.netlab:/root/.netlab" \
  -e UVICORN_HOST=127.0.0.1 \
  -v /opt/netlab-venv:/opt/netlab-venv:ro -e NETLAB_BIN=/opt/netlab-venv/bin/netlab \
  -v /usr/bin/containerlab:/usr/bin/containerlab:ro \
  ghcr.io/muddyblack/netlab-ui:latest
```

Mount your netlab install at its own path (here `/opt/netlab-venv`; on NixOS the store, `HOST_TOOLS_DIR=/nix/store` in the compose file) and point `NETLAB_BIN` at it, or pick it in **Settings → Environment**. containerlab is a static binary; mounting it enables link impairment, orphan cleanup and link reconcile.

Why each flag matters — each one fails late and cryptically when missing:

- **`--privileged --network host --pid host`** — containerlab creates network namespaces, veth links and sysctls for the lab nodes (the same flags containerlab's own container image needs). Without them `netlab up` dies with errors like `rp_filter: read-only file system`.
- **Docker socket** — labs run on the host's Docker daemon, next to the UI container.
- **Labs directory at the *same path* as on the host** — containerlab asks the host daemon to bind-mount node config files by their in-container path. Mounting `./labs` at `/work` (as older docs suggested) makes every node fail to start.
- **`~/.netlab`** — netlab's running-lab registry. Shared with `netlab status` on the host and kept across container re-creation; without it labs started from the UI turn into orphans.
- **`UVICORN_HOST=127.0.0.1`** — the UI can deploy labs and open root shells, so it listens on loopback unless you set `0.0.0.0` on purpose. When you do, also set **`NETLAB_UI_AUTH=user:password`**: every page, API call, live stream and terminal then requires that login (HTTP Basic — the browser asks once).

## Several users on one lab server

- **`NETLAB_UI_AUTH=alice:pw1,bob:pw2`** (or one `user:password` per line in the file named by **`NETLAB_UI_AUTH_FILE`**) — each person logs in as themselves.
- **`NETLAB_UI_SHARED_WORKSPACE=/srv/labs`** — a folder everyone works in. It is always listed (as *name (shared)*), cannot be removed from the UI, and its labs carry a *shared* badge.
- Running labs show who deployed them (*team-lab (7) · by alice · shared*). The owner is recorded next to netlab's own registry in `~/.netlab/netlab-ui-owners.json` and cleared on `netlab down`.
- **Copy Lab to Workspace…** (right-click any lab → Copy) forks a shared lab into your own workspace, publishes yours to the shared one, or duplicates it. The copy gets its own folder and `name:`, keeps its layout, tours and scripts, and leaves netlab's generated files and running state behind; it opens right away and can run next to the original. **Clone Repository…** / **Browse Example Labs…** import from git.
- **`NETLAB_UI_LAB_HOURS=4`**: a lab deployed from the UI shuts down (`netlab down`) 4 hours later.
  - The canvas shows *Running until 14:30*, turning red with a countdown in the last 10 minutes.
  - **Extend** gives the lab another full period.
  - The explorer shows the shutdown time next to the lab.
- **`NETLAB_UI_MAX_LABS_PER_USER=2`**: a third deploy by the same login is refused, with the labs it already runs. **`NETLAB_UI_ADMINS=alice`** exempts logins from the limit.

You don't have to remember any of this: the backend inspects its own container and lists anything missing — with the exact flag to add — under **Settings → Environment → Container Setup**, plus a banner at startup when a deployment would fail.

## Building locally

```bash
docker build -t netlab-ui .     # the UI image
docker compose build            # the compose file's image
```

libvirt-based providers aren't included in the image.
