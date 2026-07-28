# Backend Agent Guidelines

See root `AGENTS.md` for agent spawn policy and model roles.

## Stack
- **Python** with FastAPI (`app/main.py`)
- **Ruff** for linting (`ruff.toml`) — run `ruff check` before considering backend work done
- **pyproject.toml** manages deps

## Structure
```
backend/
  app/
    contract/   # API contracts / request+response schemas
    lab/        # Lab management logic
    plugins/    # Plugin system
    schema/     # Pydantic models
    sessions/   # Session handling
    shell/      # Shell execution
    main.py     # FastAPI app entrypoint
  services/
    annotations/
    assistant/  # Optional AI assistant (see below) — self-contained
    docs/
    model/
    netlab/     # Netlab-specific service logic
    topology_host.py
  tests/
```

## Rules
- All endpoints must have explicit FastAPI response models (enforced — do not skip).
- OpenAPI types are auto-generated — after adding/changing endpoints, regenerate types for the frontend.
- Do not add business logic directly in route handlers; keep it in `services/`.
- Tests live in `tests/` — add/update tests when changing service logic.

## Plugin discovery (`app/plugins/router.py`)
- Plugins are read **primarily from the installed netlab package**: pip package
  `networklab`, importable as `netsim`, plugins live in `netsim/extra/<id>/`.
  Discovery uses `find_spec("netsim")` — so whatever Python runs uvicorn must
  have netlab installed.
- Make sure netlab is reachable in each runtime:
  - **Docker** (`backend/Dockerfile`): installed via `pip install networklab`.
  - **Nix** (`flake.nix`): the `python` env bundles the `netlab` package, so
    `nix run` / `nix run .#backend` resolve `netsim` automatically.
  - **Bare host**: `pip install networklab` in the same env as uvicorn.
- The pip/nix package ships plugin *code* but **not** the docs markdown (those
  live in the netlab repo / netlab.tools). Installed-only plugins get a
  placeholder body + a `netlab.tools/plugins/<id>/` link — by design.

## Token tips
- When asked about an endpoint, `grep` for the route path in `app/` before reading whole files.
- Service logic is in `services/netlab/` — check there first for domain behavior.
