# Running It as One Container

The dev setup (see [CONTRIBUTING](../CONTRIBUTING.md)) runs the backend and frontend as two separate processes. The [`Dockerfile`](../packaging/docker/Dockerfile) instead builds the frontend and bakes the static output straight into the FastAPI backend, so the whole app is one image on one port — same shape as [containerlab-app](https://github.com/srl-labs/containerlab-app)'s web app / desktop split, minus the split: our backend already _is_ the thing their `clab-api-server` is, so there's no separate API service to stand up first.

The image is the UI only. netlab, Ansible and containerlab stay on the host, installed however you like (pipx, pip, a venv, your distribution's packages or Nix), and the container uses that install, so the UI never drifts from the netlab you actually run and there is no second copy.

## Quick start

```bash
docker compose -f https://github.com/Muddyblack/netlab-ui.git up -d
```

No checkout needed: compose reads the file from the repository (plain `https://raw...` URLs are not supported by compose, only git and OCI ones; it needs `git` on the host). Compose asks you to confirm the variables it will use, as it does for any remote file: answer `Y`, or add `-y`. From a checkout, plain `docker compose up -d` does the same. A one-shot `init` service first creates `~/.netlab` and the labs folder (`~/netlab-labs`, or `LABS_DIR`) owned by you, because Docker would otherwise create missing bind-mount folders as root and the UI runs netlab as the owner of `~/.netlab`.

Open `http://localhost:8000`. The equivalent `docker run`:

```bash
mkdir -p ~/.netlab "$PWD/labs"     # by hand here: only compose has the init step
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
- **A netlab that needs variables** (a checkout needs `PYTHONPATH`; your shell's values never reach the container): `NETLAB_UI_TOOL_ENV='{"PYTHONPATH": "/home/you/scratch/netlab"}'` is set for every netlab command and the version check, on the host. Pick that checkout's `netlab` under Settings → Environment.
- **Links to lab tools** use the address your browser used. For a fixed one, set `NETLAB_UI_PUBLIC_HOST` (see [install.md](install.md)).
- **Update notice:** the UI shows when a newer release exists and the command to get it (`docker compose pull && docker compose up -d`). `NETLAB_UI_UPDATE_CHECK=off` disables the lookup.
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
