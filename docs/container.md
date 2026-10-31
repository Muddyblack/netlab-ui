# Running It as One Container

The dev setup (see [CONTRIBUTING](../CONTRIBUTING.md)) runs the backend and frontend as two separate processes. The [`Dockerfile`](../packaging/docker/Dockerfile) instead builds the frontend and bakes the static output straight into the FastAPI backend, so the whole app is one image on one port — same shape as [containerlab-app](https://github.com/srl-labs/containerlab-app)'s web app / desktop split, minus the split: our backend already _is_ the thing their `clab-api-server` is, so there's no separate API service to stand up first.

The image is the UI only. netlab, Ansible and containerlab stay on the host, installed however you like (pipx, pip, a venv, your distribution's packages or Nix), and the container uses that install, so the UI never drifts from the netlab you actually run and there is no second copy.

## Quick start

```bash
mkdir -p ~/.netlab labs     # first time only: Docker would create missing folders as root
docker compose up -d        # uses docker-compose.yml; labs live in ./labs
```

Open `http://localhost:8000`. The equivalent `docker run`:

```bash
mkdir -p ~/.netlab "$PWD/labs"
docker run -d --name netlab-ui \
  --privileged --network host --pid host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/run/netns:/var/run/netns \
  -v "$PWD/labs:$PWD/labs" -e NETLAB_WORKSPACE="$PWD/labs" \
  -v "$HOME/.netlab:/root/.netlab" \
  -e UVICORN_HOST=127.0.0.1 \
  ghcr.io/muddyblack/netlab-ui:latest
```

## How it uses the host's netlab

netlab is Python: a venv, an interpreter and Ansible, none of which work when mounted into a different container. So the container does not run netlab itself. It enters the host with `nsenter` (the reason for `--privileged --pid host`) and runs netlab, its Python and containerlab **there, as you**: your PATH from a login shell, your netlab install, your groups (`docker`, `clab_admins`). This works on any distribution.

- **Who "you" is:** the owner of the mounted `~/.netlab`. Set `NETLAB_UI_HOST_UID` to pick someone else.
- **Lab files belong to you.** netlab writes them as you; what the UI itself writes in a lab folder (edits, layout files, git history) is handed to you as soon as it appears. containerlab's own `clab-<lab>/` folders are left as containerlab made them.
- **Which netlab:** the first `netlab` on your login PATH, or the one you pick under **Settings → Environment** (a path on the host; `~` is your home there).
- **Setup checks:** Settings → Environment → Host Setup then checks the host as you (netlab version, containerlab without sudo, Docker access), and Container Setup checks the flags below.
- `NETLAB_UI_NETLAB=container` turns this off and uses a netlab inside the container instead (only if you build an image with one).

Why each flag matters — each one fails late and cryptically when missing:

- **`--privileged --network host --pid host`** — containerlab creates network namespaces, veth links and sysctls for the lab nodes (the same flags containerlab's own container image needs). Without them `netlab up` dies with errors like `rp_filter: read-only file system`.
- **Docker socket** — labs run on the host's Docker daemon, next to the UI container.
- **Labs directory at the *same path* as on the host** — containerlab asks the host daemon to bind-mount node config files by their in-container path. Mounting `./labs` at `/work` (as older docs suggested) makes every node fail to start.
- **`~/.netlab`** — netlab's running-lab registry, shared with `netlab status` on the host; its owner is the user netlab runs as. Create it before the first start, or Docker creates it owned by root and netlab runs as root.
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
docker build -f packaging/docker/Dockerfile -t netlab-ui .     # the UI image
docker compose build            # the compose file's image
```

libvirt-based providers aren't included in the image.
