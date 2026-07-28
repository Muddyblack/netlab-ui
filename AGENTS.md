# AGENTS.md

## Commands

### Backend (Python / FastAPI)

```bash
# Run (from repo root)
uvicorn app.main:app --reload --app-dir backend   # :8000

# Tests
cd backend && pytest
cd backend && pytest tests/test_contract.py::test_save_positions_command_is_layout_only  # single test

# Lint (must pass before backend work is done)
cd backend && ruff check
cd backend && ruff format --check
```

### Frontend (React / Vite)

```bash
cd frontend && npm run dev          # :5173
cd frontend && npm run build        # tsc --noEmit + vite build
cd frontend && npm run typecheck    # tsc --noEmit only
cd frontend && npm run gen:api      # regenerate src/api/generated.ts (backend must be running)
```

### Nix (full stack)

```bash
nix run              # backend :8000 + frontend :5173
nix run .#backend
nix run .#frontend
nix run .#test       # pytest
nix develop          # dev shell
```

---

## Repository layout

```
netlab_gui/
  backend/           FastAPI backend — implements clab-ui's ClabUiHost contract
    app/
      contract/      API routes, commands.py, snapshot.py, responses.py
      lab/           /api/lab surface, split by concern:
                       common.py (shared helpers), files.py (workspaces/files/
                       icons/fs/push events), images.py (Docker image manager),
                       lifecycle.py (up/down/status + SSE), router.py (aggregator)
      plugins/       Plugin discovery (reads from installed `netsim` package)
    services/
      annotations/   Sidecar *.netlab-ui.json read/write
      events.py      Pub/sub hub + watchfiles workspace watcher (push events)
      model/         Topology YAML parsing (ruamel round-trip)
      multiserver.py Multiserver plugin placement discovery + panel payload
      netlab/        netlab CLI wrappers (create, up, down, status…)
      topology_host.py  Per-session undo/redo history + revision
      units.py       Workspace unit (template) library
  frontend/          React 19 + Vite app
    src/
      api/           Generated OpenAPI types (generated.ts) + fetch client (client.ts)
      components/    Netlab-specific components (FileEditorTabPanel, dialogs…)
      hooks/         useAppData, useTabManager, useExplorerController, …
      host/          createHost.ts — wires FastAPI backend to clab-ui's host interface
      panels/        Side panels (Plugins, UnitsDock, Groups, Workers)
      App.tsx        Root — wiring point (~550 lines; logic lives in hooks/)
```

`@srl-labs/clab-ui` itself is an npm dependency (published on GitHub Packages, pinned in `frontend/package.json`), not source in this repo. It provides the ReactFlow canvas, graph/canvas stores, `topologyHostSync`, `createApiClabUiHost`/`createExplorerController`, and the explorer tree/action registry — consumed via imports from `@srl-labs/clab-ui` (and its declared sub-entries like `@srl-labs/clab-ui/host`).

---

## Architecture

### The two-layer model

**clab-ui** is a generic topology canvas library originally built for the Containerlab VS Code extension, consumed here as a published npm package (`@srl-labs/clab-ui`). The netlab-gui treats it as an opaque dependency and extends it only through its public prop surface — never by patching its source, since there is none checked into this repo.

**The backend** implements the `ClabUiHost` contract (`/api/topology/sessions`, `/api/topology/snapshot`, `/api/topology/command`) that clab-ui expects. It translates between netlab topology files and the graph JSON format clab-ui renders.

### Data flow (open a lab)

1. `App.tsx` → `host.createSession(yamlPath)` → `POST /api/topology/sessions`
2. Backend runs `netlab create -o clab` (cached by YAML hash), merges saved positions from `*.netlab-ui.json`, returns a `TopologySnapshot`.
3. `refreshTopologySnapshot()` → `applySnapshotToStores()` (from `@srl-labs/clab-ui`) → pushes nodes+edges into its graph store (Zustand). If no saved positions: runs a force layout then persists positions via `savePositions` command.
4. clab-ui's `ReactFlowCanvas` renders the canvas from the graph store.

### Node positions (sidecar pattern)

The netlab YAML stays coordinate-free. Positions live in `<topology>.netlab-ui.json` alongside the YAML. The backend merges them into the snapshot on every read; the frontend writes them back via the `savePositions` topology command whenever nodes move.

### Explorer tree

`createExplorerController` (from `@srl-labs/clab-ui`) builds a snapshot-based tree. `App.tsx` passes a `buildProviders` function that returns `runningProvider` (from SSE status) and `fileProvider` (from `GET /api/lab/files`). Each snapshot rebuilds `actionBindings` — a map from opaque `actionRef` strings to `{ commandId, args }`. The tree is rendered in clab-ui's webview; clicking invokes `executeAction` in `App.tsx`.

### Monaco editor (two-instance trap)

`@srl-labs/clab-ui/monaco/core` exports are **pre-built dist** and register Monaco contributions on load. If anything in `frontend/src/` also imports from `@srl-labs/clab-ui/monaco/core`, Monaco contributions register twice → crash. Always import `monaco-editor` directly from `frontend/src/` code.

---

## Key rules

### clab-ui stays generic

Never put netlab text, branding, or logic into clab-ui — it's a third-party dependency, not code we own. Use a generic prop/callback it exposes and implement the netlab side in `frontend/src/`.

### Installing / upgrading clab-ui

`@srl-labs/clab-ui` is published on GitHub Packages, pinned in `frontend/package.json`. `frontend/.npmrc` + a `NODE_AUTH_TOKEN` with `read:packages` are required to install. To upgrade, bump the version and run `npm install` — there's no build step on our side.

### Public API only

Import from `@srl-labs/clab-ui` (the package root or its declared sub-entries like `@srl-labs/clab-ui/host`). Never use `@srl-labs/clab-ui/src/...` or `@srl-labs/clab-ui/dist/...` deep paths.

### API types are generated

`frontend/src/api/generated.ts` is auto-generated from the backend's OpenAPI schema. Never hand-edit it. After changing a Pydantic response model, run `npm run gen:api` (backend must be running) then `npm run typecheck`.

### Backend endpoints need response models

Every FastAPI route must declare `response_model=`. This is what feeds `openapi.json` and keeps generated TypeScript types complete.

### Grep before implementing

Before writing a new hook, util, or component, check whether `@srl-labs/clab-ui` already ships it (toasts, panels, dialogs, stores, and many utilities). Duplicating them creates divergence.

```bash
grep -r "YourConcept" frontend/node_modules/@srl-labs/clab-ui --include="*.d.ts" -l
```

---

## App.tsx anatomy

`App.tsx` is the wiring point (~550 lines); most logic has been extracted into
hooks and panels. Where things live now:

- **`App.tsx`** — composes the hooks below, renders clab-ui's `<App>` with all
  extension props, and portals netlab panels (tabs bar, file editor, UnitsDock,
  Shell dialog) into clab-ui's containers. Monaco (`FileEditorTabPanel`) and
  xterm (`Shell`) are `React.lazy` — keep them out of eager import graphs.
- **`hooks/useAppData.ts`** — startup health check, theme, lab files +
  workspaces state, SSE status subscription, backend push-event subscription
  (with a slow polling fallback).
- **`hooks/useTabManager.ts`** — open lab/file tabs, activation, persistence.
- **`hooks/useLabLifecycle.ts`** — deploy/destroy/validate handlers.
- **`hooks/useExplorerController.ts`** — `createExplorerController` wiring:
  `buildProviders` / `executeAction` / snapshot options.
- **`lifecycle/`** — shared types (`StartupState`, `WorkspaceEntry`) and
  persistence helpers.
- **Dialogs** — `components/dialogs/` (`WorkspacesDialog`, `NewLabDialog`,
  `CloneRepoDialog`, …).
