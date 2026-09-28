# Contributing to netlab-ui

Bug reports, ideas and pull requests are welcome. This page covers the dev setup and the few workflows that aren't obvious from the code. For how the pieces fit together, see [docs/architecture.md](docs/architecture.md); for conventions per directory, see [AGENTS.md](AGENTS.md), [backend/AGENTS.md](backend/AGENTS.md) and [frontend/AGENTS.md](frontend/AGENTS.md).

## Dev setup

### Venv + npm (the normal path)

**1. Backend:**

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
# pip install -e ".[netlab]"           # if you don't already have netlab + ansible installed locally
uvicorn app.main:app --reload --reload-exclude 'tests/*' --timeout-graceful-shutdown 2
```

The backend doesn't bundle netlab or Ansible. Use **Settings → Environment** to select an existing `netlab` executable, or set `NETLAB_BIN=/path/to/netlab`. A pipx or separate virtualenv installation works: the backend uses that executable's Python environment for `netsim` metadata and prepends its `bin/` directory when netlab launches child tools.

**2. Frontend:**

```bash
cd frontend
npm install                              # also applies the clab-ui patches (see below)
npm run dev                              # http://localhost:5173
```

### Nix (flake)

The included `flake.nix` gives you a dev shell with Python 3.12, Node 24 and the `networklab` package.

```bash
nix run            # backend (:8000) + frontend (:5173); Ctrl-C stops both
nix run .#backend  # only the backend
nix run .#frontend # only the frontend
nix run .#test     # pytest
nix develop        # the dev shell (or `direnv allow`)
```

The first run executes `npm install` for the frontend.

## Before you open a pull request

CI runs these; run them locally first:

```bash
cd backend && ruff check && ruff format --check && pytest
cd frontend && npm run lint && npm run build     # build = tsc --noEmit + vite build
```

## API types

Response shapes are defined once in Python, and the frontend's TypeScript types are generated from them.

- **Source of truth:** every API response is a Pydantic model (in `backend/app/contract/responses/`, `backend/app/assistant/responses.py`, …), attached to its endpoint via `response_model=`.
- **Generated types:** `frontend/src/api/generated.ts`, produced with [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript). Don't edit it by hand.
- **Consumer:** `frontend/src/api/client.ts` uses those generated types (`Schemas["CommandResult"]`, …).

After changing a response shape:

```bash
# backend running (so /openapi.json is reachable), then:
cd frontend
npm run gen:api          # http://localhost:8000/openapi.json -> src/api/generated.ts
npm run typecheck        # fails where the frontend no longer matches
```

For another backend: `OPENAPI_URL=http://my-host:9000/openapi.json npm run gen:api`.

## clab-ui patches

`@containerlab/clab-ui` is pinned to an exact version and patched with [`patch-package`](https://github.com/ds300/patch-package) on `npm install`. The patches in `frontend/patches/` are numbered and applied in order; [docs/architecture.md](docs/architecture.md#about-containerlabclab-ui) lists what each one does.

- **Adding a change:** edit the file under `frontend/node_modules/@containerlab/clab-ui/dist/`, then `npx patch-package @containerlab/clab-ui --append "short-name"`. That creates the next numbered patch.
- **Keep patches small and generic:** a hook or field the host fills in, not netlab logic. The behaviour belongs in netlab-ui's own code.
- **Bumping clab-ui:** the patches edit built files with hashed names, so a new version usually breaks them. Bump deliberately, reinstall, redo the patches that fail, and test.

## Showcase (screenshots and videos)

The gallery in the README and [docs/showcase/GALLERY.md](docs/showcase/GALLERY.md) is generated from the running app. After UI changes, regenerate it with `docs/showcase/run.sh`; see [docs/showcase/README.md](docs/showcase/README.md) for options and how to add a feature.

## Releases

- **Container images:** `.github/workflows/container-release.yml` publishes `ghcr.io/muddyblack/netlab-ui:<ver>` (UI only) and `<ver>-full` on a release.
- **Desktop app:** push a `desktop-v*` tag; see [docs/desktop.md](docs/desktop.md).
