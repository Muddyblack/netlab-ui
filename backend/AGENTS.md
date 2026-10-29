# Backend Agent Guidelines

See root `AGENTS.md` for repo-wide rules.

## Stack
- **Python** with FastAPI (`netlab_ui/app/main.py`)
- **Ruff** for linting (`ruff.toml`) — run `ruff check` before considering backend work done
- **pyproject.toml** manages deps

## Structure
```
backend/
  netlab_ui/            # the installable package
    cli.py config.py service.py   # `netlab-ui` command, settings, systemd user service
    app/                # API layer
      contract/         # clab-ui host contract: routes, commands, snapshot, response models
      lab/              # /api/lab: files, lifecycle, images, capture, monitoring, tools…
      plugins/          # plugin discovery
      assistant/ environment/ lenses/ docs/ schema/ sessions/ shell/
      auth.py main.py
    services/           # business logic
      annotations/ assistant/ docs/ lenses/ model/ netlab/
      topology_host.py events.py units.py workspaces.py …
  tests/
```

## Rules
- All endpoints must have explicit FastAPI response models (enforced — do not skip).
- OpenAPI types are auto-generated — after adding/changing endpoints, regenerate types for the frontend.
- Do not add business logic directly in route handlers; keep it in `services/`.
- Tests live in `tests/` — add/update tests when changing service logic.

## Plugin discovery (`netlab_ui/app/plugins/router.py`)
- Plugins are read **primarily from the installed netlab package**: pip package
  `networklab`, importable as `netsim`, plugins live in `netsim/extra/<id>/`.
  Discovery uses `find_spec("netsim")` — so whatever Python runs uvicorn must
  have netlab installed.
- Make sure netlab is reachable in each runtime:
  - **Docker** (`packaging/docker/Dockerfile`): the `full` target installs `.[netlab]`;
    the default `ui` target uses a mounted host install (`NETLAB_BIN`).
  - **Nix** (`flake.nix`): the `python` env bundles the `netlab` package, so
    `nix run` / `nix run .#backend` resolve `netsim` automatically.
  - **Bare host**: `pip install networklab` in the same env as uvicorn.
- The pip/nix package ships plugin *code* but **not** the docs markdown (those
  live in the netlab repo / netlab.tools). Installed-only plugins get a
  placeholder body + a `netlab.tools/plugins/<id>/` link — by design.

## Token tips
- When asked about an endpoint, `grep` for the route path in `netlab_ui/app/` before reading whole files.
- Service logic is in `netlab_ui/services/netlab/` — check there first for domain behavior.
