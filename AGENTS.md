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

### Container

```bash
docker compose up -d                          # full image: UI + netlab + containerlab
docker build --target full -t netlab-ui:full .
docker build -t netlab-ui .                   # UI only (uses the host's netlab)
```

The backend checks its own `docker run` setup (`services/container_env.py`,
`GET /api/environment/container`, Settings → Environment → Container Setup).

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

`@containerlab/clab-ui` itself is an npm dependency (published on the public npm registry, pinned in `frontend/package.json`), not source in this repo. It provides the ReactFlow canvas, graph/canvas stores, `topologyHostSync`, `createApiClabUiHost`/`createExplorerController`, and the explorer tree/action registry — consumed via imports from `@containerlab/clab-ui` (and its declared sub-entries like `@containerlab/clab-ui/host`).

---

## Architecture

### The two-layer model

**clab-ui** is a generic topology canvas library originally built for the Containerlab VS Code extension, consumed here as a published npm package (`@containerlab/clab-ui`). The netlab-gui treats it as an opaque dependency and extends it only through its public prop surface — never by patching its source, since there is none checked into this repo.

**The backend** implements the `ClabUiHost` contract (`/api/topology/sessions`, `/api/topology/snapshot`, `/api/topology/command`) that clab-ui expects. It translates between netlab topology files and the graph JSON format clab-ui renders.

### Data flow (open a lab)

1. `App.tsx` → `host.createSession(yamlPath)` → `POST /api/topology/sessions`
2. Backend runs `netlab create -o clab` (cached by YAML hash), merges saved positions from `*.netlab-ui.json`, returns a `TopologySnapshot`.
3. `refreshTopologySnapshot()` → `applySnapshotToStores()` (from `@containerlab/clab-ui`) → pushes nodes+edges into its graph store (Zustand). If no saved positions: runs a force layout then persists positions via `savePositions` command.
4. clab-ui's `ReactFlowCanvas` renders the canvas from the graph store.

### Node positions (sidecar pattern)

The netlab YAML stays coordinate-free. Positions live in `<topology>.netlab-ui.json` alongside the YAML. The backend merges them into the snapshot on every read; the frontend writes them back via the `savePositions` topology command whenever nodes move.

### Explorer tree

`createExplorerController` (from `@containerlab/clab-ui`) builds a snapshot-based tree. `App.tsx` passes a `buildProviders` function that returns `runningProvider` (from SSE status) and `fileProvider` (from `GET /api/lab/files`). Each snapshot rebuilds `actionBindings` — a map from opaque `actionRef` strings to `{ commandId, args }`. The tree is rendered in clab-ui's webview; clicking invokes `executeAction` in `App.tsx`.

### Monaco editor (two-instance trap)

`@containerlab/clab-ui/monaco/core` exports are **pre-built dist** and register Monaco contributions on load. If anything in `frontend/src/` also imports from `@containerlab/clab-ui/monaco/core`, Monaco contributions register twice → crash. Always import `monaco-editor` directly from `frontend/src/` code.

### Known gotchas (fixed, but watch for regressions)

- **`ruamel.yaml` `YAML()` instances are stateful — never share one across load calls for unrelated documents.** `services/model/serialize.py` used one module-level `_yaml = YAML()` for every load *and* dump. Loading a single file that carried a `%YAML 1.1` directive (e.g. a cloned netlab-examples topology) set `_yaml.version` as a side effect, and every later `dump()` — for *any* unrelated topology — kept stamping `%YAML 1.1` onto files that never had it. Fixed by resetting `_yaml.version = None` right after every `.load()` in `from_yaml()`. If new round-trip `YAML()` singletons get added, make them per-call (like `_helpers.py`/`images.py` already do) or reset state after load.
- **Editing a canvas while the lab is deployed can look like edits "revert" after ~2-3s** if the background clab-projection cache warmer is allowed to use `netlab inspect` (the running instance) instead of the just-edited model. `app/contract/snapshot.py::_schedule_transform` now checks for `netlab.lock` and skips the `netlab create`/`inspect` transform entirely while locked, keeping the model-derived (edit-accurate) projection cached instead. Don't let that background warmer silently prefer "deployed" state over "just edited but not yet redeployed" state again.

- **clab-ui's node editor only loads and saves containerlab fields** — except the opaque `extraData.hostFields` bag added by our patch 003. The snapshot fills it with the node's netlab attributes, clab-ui loads/dirty-checks/saves it with `editNode`, and `components/node-editor/NetlabAttrsTab.tsx` (`withNetlabAttrs`) maps the netlab tabs' flat fields onto it. Any new netlab editor tab must be wrapped the same way (see `app/netlabNodeEditorTabs.ts`). `_edit_node` never pins netlab's default image (clab-ui always sends the resolved one).
- **clab-ui's node `data.role` is the icon, not netlab's `role`.** `snapshot.py` derives it (netlab role → device → device name); netlab's declared role lives in `extraData.netlabAttrs`. Never let the attrs merge overwrite `data.role` again.
- **Running-lab matching is by topology file, then the file's own directory** (`host/runningMatch.ts`). A directory *prefix* or bare name match marks unrelated labs as running. netlab allows one lab per directory — new labs are created as `<workspace>/<name>/topology.yml`.
- **`host.createSession` does not make a session active.** Explorer actions on a lab that isn't the open tab get their own background session (`getOrCreateSession` in `useTabManager`); only `activateSession` changes what canvas callbacks target. Resolving an action through "the current session" ran Deploy/Destroy on the wrong lab before.
- **The YAML serializer merges into the loaded document** (`serialize.to_yaml` + `Topology.source`) so comments and flow style survive UI edits. Rebuilding the document from the model dropped users' comments.
- **`netlab exec` and `netlab connect --show` always exit 0.** `app/lab/broadcast.py` gets a real status for shell commands on containers from an exit-code trailer, and flags CLI error replies (`% Unknown command`) as failures. netlab joins the words after the node name and hands them to `bash -c`, so pass commands as whitespace-split words: `shlex` would strip the quotes, and an extra `sh -c` gets its `$?` expanded by the outer shell.
- **clab-ui keeps only the traffic-rate keys of interface stats** (`EDGE_STATS_KEYS`). Anything else the runtime sample carries (error/drop counters, netem state) reaches our own UI through `host/runtimeStore.ts`, which the controller's runtime poll publishes to. Don't add a second poll.
- **Dialogs and overlays opened from the canvas or explorer use small module stores** (`host/captureStore.ts`, `configsDialogStore.ts`, `copyLabStore.ts`, `canvasSpotlight.ts`), mounted once in `components/dialogs/LabToolDialogs.tsx` / `components/app/CanvasLabOverlays.tsx`. This avoids threading props through `App.tsx`; follow the same pattern for new ones.
- **Explorer action ids choose their clab-ui menu group by substring** (`ACTION_GROUP_RULES`: `.graph.`, `copy`, `inspect`, `shell`, `addtoworkspace`, …). An id matching nothing lands in "Other".
- **netlab's transformed topology stores `validate:` as a list** of tests with a `name` key, not the YAML's mapping. The same goes for other normalized blocks: read both forms.
- **netlab's short group form (`core: [r1, r2]`) is a member list**, and `Group.short_form` keeps it that way on save.
- **Providers are per node** (`node.provider`, else the lab's; netlab reports unmanaged devices as `unmanaged`). A lab with any non-clab node gets its canvas from `services/netlab/projection.py` (source `"transform"`), because `clab.yml` lists containers only. Gate runtime actions on the node's provider in the backend (`lifecycle._require_clab_node` / `_provider_limit`) with a message the user can act on, and keep `frontend/src/netlabProviders.ts` (the support table) and the README table in step.
- **libvirt NICs map to netlab interfaces by order** (`services/netlab/libvirt.py`): `virsh domiflist` lists the management NIC first, then one NIC per non-virtual, non-loopback interface. p2p links are UDP tunnels (no host tap, target `-`); only LAN links have a `vnetN` tap. Tap counters are the host's view, so rx/tx are swapped. No KVM in CI: test with the fake `virsh` in `tests/test_libvirt.py`.

## Key rules

### clab-ui stays generic

Never put netlab text, branding, or logic into clab-ui — it's a third-party dependency, not code we own. Use a generic prop/callback it exposes and implement the netlab side in `frontend/src/`.

### Installing / upgrading clab-ui

`@containerlab/clab-ui` is published on the public npm registry (source: the [srl-labs/containerlab-app](https://github.com/srl-labs/containerlab-app) monorepo), pinned in `frontend/package.json`. No auth is needed to install. To upgrade, bump the version, port the sequenced patches in `frontend/patches/` (`@containerlab+clab-ui+<version>+NNN+<name>.patch`: 001 initial fixes, 002 lifecycle-modal lab name + actions, 003 node-editor `hostFields`, 004 link down/up menu item), and run `npm install` — there's no build step on our side. Keep each patch generic (no netlab text) and small; add new ones with `npx patch-package @containerlab/clab-ui --append <name>`. After changing a patch, restart Vite with `--force` (its dependency pre-bundle cache keeps the old code).

### Public API only

Import from `@containerlab/clab-ui` (the package root or its declared sub-entries like `@containerlab/clab-ui/host`). Never use `@containerlab/clab-ui/src/...` or `@containerlab/clab-ui/dist/...` deep paths.

### API types are generated

`frontend/src/api/generated.ts` is auto-generated from the backend's OpenAPI schema. Never hand-edit it. After changing a Pydantic response model, run `npm run gen:api` (backend must be running) then `npm run typecheck`.

### Backend endpoints need response models

Every FastAPI route must declare `response_model=`. This is what feeds `openapi.json` and keeps generated TypeScript types complete.

### Grep before implementing

Before writing a new hook, util, or component, check whether `@containerlab/clab-ui` already ships it (toasts, panels, dialogs, stores, and many utilities). Duplicating them creates divergence.

```bash
grep -r "YourConcept" frontend/node_modules/@containerlab/clab-ui --include="*.d.ts" -l
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
- **Dialogs** — `components/dialogs/` (`NewLabDialog`,
  `CloneRepoDialog`, …).
