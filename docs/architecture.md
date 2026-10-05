# Architecture

## Why this approach?

We consume `@containerlab/clab-ui` as a normal **npm dependency** (not a fork or local checkout) and feed it netlab data through a thin Python adapter.

- **No Rebasing Debt:** Because `clab-ui` moves fast and is published as a reusable library with an integrator contract, we get design updates via simple version bumps.
- **Single Source of Truth:** Netlab remains the ultimate source of truth. The netlab-to-clab projection (`netlab create -o clab`) is what gets rendered.

---

## Components

```mermaid
flowchart TD
    subgraph Frontend ["Frontend (React 19 + Vite)"]
        App["App.tsx<br>(runtime + host wiring)"]
        Canvas["@containerlab/clab-ui<br>(Canvas, explorer, palette, lifecycle UI)"]
        Panels["Netlab UI Extensions<br>(Lenses, Units, Links, Groups, Plugins, Workers, AI agents)"]
        Editor["Lazy Tooling<br>(Monaco file editor, xterm shells/logs)"]
        Client["Generated API Client<br>(OpenAPI TypeScript types)"]
    end

    subgraph Backend ["FastAPI Backend (Python)"]
        Contract["/api/topology<br>(ClabUiHost sessions, snapshots, commands, model edits)"]
        Lab["/api/lab<br>(workspaces, files, lifecycle, runtime, images, capture)"]
        Lenses["/api/lenses<br>(validation, readiness, paths, services, reports)"]
        Extras["/mcp for your AI agent + /api/assistant<br>Plugins, docs, schema, shell WebSocket"]
        HostState["Session Host<br>(undo/redo, revision, transactions)"]
        Snapshot["Snapshot Builder<br>(netlab model + clab projection + status)"]
        Model["Model Service<br>(YAML parsing + ruamel round-trip)"]
        Annotations["Annotation Service<br>(layout sidecar)"]
        Runner["Runner Service<br>(netlab/containerlab/libvirt commands + streams)"]
        Events["Event Hub<br>(SSE status + workspace push events)"]
    end

    subgraph Host ["Host Environment / Runtimes"]
        NetlabCLI["netlab CLI"]
        Providers["containerlab / libvirt / Docker"]
        AgentCLI["Your AI agent<br>(Claude Code, Codex, Copilot, Kiro, …)"]
    end

    subgraph Storage ["Workspace Storage"]
        NetlabYAML[("Topology YAML<br>(topology.yml)")]
        Sidecar[("Layout Sidecar<br>(*.netlab-ui.json)")]
        RuntimeFiles[("Generated runtime files<br>(clab.yml, configs, logs)")]
        IconsUnits[("User assets<br>(icons, unit templates)")]
    end

    App --> Canvas
    App --> Panels
    App --> Editor
    Canvas <-->|Host contract| Contract
    Panels <-->|HTTP API| Client
    Editor <-->|HTTP / WebSocket| Client
    Client <-->|fetch / SSE| Lab
    Client <-->|fetch| Contract
    Client <-->|fetch| Lenses
    Client <-->|fetch / WebSocket| Extras

    Contract <--> HostState
    Contract <--> Snapshot
    Contract <--> Model
    Contract <--> Annotations
    Lab <--> Runner
    Lab <--> Events
    Lenses <--> Runner
    Extras <--> Runner

    Annotations <-->|Read / Write| Sidecar
    Model <-->|Read / Write| NetlabYAML
    Runner <-->|Read / Write| RuntimeFiles
    Lab <-->|Read / Write| IconsUnits

    Runner -->|CLI invocations| NetlabCLI
    NetlabCLI -->|Deploy / Destroy / Inspect| Providers
    Snapshot -->|Background netlab create cache| NetlabCLI
    Extras -.->|MCP tools| AgentCLI
    AgentCLI -.->|HTTP MCP| Extras
```

- **Backend (`backend/`)** — Built with FastAPI. It implements clab-ui's `ClabUiHost` contract (`/api/topology/{sessions,snapshot,command}`), wraps lab lifecycle/runtime/file APIs, and provides lenses, plugin, schema/docs, shell, capture, and the MCP server for AI agents.
- **Frontend (`frontend/`)** — React 19 + Vite. Consumes the clab-ui canvas and overlays netlab-native panels and tools for units, links, groups, plugins, workers, lenses, files, shells/logs, and the AI agents panel.

### Data & Projection Flow

To keep the primary netlab YAML file clean, coordinates and visual metadata are projected/merged on-the-fly and stored in a sidecar file.

```mermaid
flowchart LR
    YAML[("netlab YAML<br>(topology.yml)")] -->|Parse with ruamel| Model["Netlab Model"]
    Model -->|Immediate fallback projection| Snapshot["Topology Snapshot"]
    YAML -->|Hash miss schedules background transform| NetlabCreate["netlab create -o clab"]
    NetlabCreate -->|Cache clab nodes + links| Snapshot
    Sidecar[("Layout Sidecar<br>(*.netlab-ui.json)")] -->|Merge coordinates + UI metadata| Snapshot
    Status["netlab status<br>(SSE cache)"] -->|Deployment state + node dots| Snapshot
    Snapshot -->|/api/topology/snapshot| Frontend["clab-ui Canvas"]
    Frontend -->|Topology commands| Commands["/api/topology/command"]
    Commands -->|Model edits| YAML
    Commands -->|Layout-only updates| Sidecar
```

## About `@containerlab/clab-ui`

[`@containerlab/clab-ui`](https://www.npmjs.com/package/@containerlab/clab-ui) is published on the public npm registry (source lives in the [containerlab-app](https://github.com/srl-labs/containerlab-app) monorepo), so a plain `npm install` is all it takes — no token or `.npmrc`. It requires **Node ≥ 24**.

The frontend imports `@containerlab/clab-ui` directly wherever it's needed (see `frontend/src/App.tsx`, `frontend/src/host/`, etc.) — there is no local checkout, stub, or swap-point to configure.

`@containerlab/clab-ui` is pinned to an exact version (`0.3.2`), with small
`patch-package` patches applied on install (`frontend/patches/`, applied in order):

| Patch | What it does |
| --- | --- |
| `001 initial` | Exports netlab-ui needs, plus two UI fixes (YAML tab race, panel flicker) |
| `002 lifecycle-context` | The host can set the progress modal's lab name and follow-up buttons |
| `003 editor-host-fields` | The node editor carries host-owned fields (netlab attributes) |
| `004 link-actions` | Link menu actions provided by the host |
| `005 runtime-link-status` | Running links turn green: runtime updates also set `linkStatus` |

They patch clab-ui's built files, so a clab-ui version bump means redoing them;
[CONTRIBUTING](../CONTRIBUTING.md#clab-ui-patches) has the workflow.
