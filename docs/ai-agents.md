# AI agents

netlab-ui has no chat of its own. You use the AI tool you already have (Claude Code, Codex, Gemini CLI, Cursor, VS Code, …), connected to netlab-ui's **MCP server**. The agent can then read your topologies and lab state, run show commands on the nodes and propose changes that you review in the UI. netlab-ui doesn't handle API keys or maintain provider integrations: the agents, their logins and their updates all come from their vendors.

```mermaid
flowchart LR
    Agent["Your agent<br/>Claude Code, Codex, Gemini CLI, Cursor…"] -->|"HTTP MCP + bearer token"| Mcp["netlab-ui /mcp"]
    Mcp --> Tools["netlab CLI<br/>topology model<br/>lab state"]
    Mcp -->|"propose_topology_edit"| Panel["AI agents panel<br/>review diff → Apply / Reject"]
```

Open the **AI agents** panel with the mascot button in the toolbar or **Ctrl+I**. It has two ways to connect an agent.

## Start an agent in netlab-ui

If Claude Code, Codex or Gemini CLI is installed on the machine running the netlab-ui backend, the panel shows a button for each one. It opens that CLI in a terminal tab at the bottom of the window:

- It starts in the open lab's folder.
- It's already connected to this lab's MCP server; your own config files aren't touched.
- It uses your own login, and it's the vendor's real CLI, so it updates itself.

The terminal tab can be moved to its own window like any node shell.

Limits:

- **The CLI runs on the backend host, as the backend's user.** With the container image the CLIs aren't installed, so the buttons don't appear. Run your agent on your own machine and use the setup below.
- **Only from the same machine, unless a login is configured.** Without `NETLAB_UI_AUTH`, agent terminals are refused for anyone not browsing from the netlab-ui host itself, because they would get your agent and your account.
- Claude Code and Codex are tested. Gemini CLI gets its MCP server through a private system-settings file (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`); that path isn't tested yet.

## Connect another tool

For any other setup (an agent on another machine, your editor, a CLI not listed), the panel shows ready-to-copy setup with the right URL and token filled in:

- **Claude Code**: `claude mcp add --transport http netlab <url> --header "Authorization: Bearer <token>"`
- **Codex**: `codex mcp add netlab --url <url> --bearer-token-env-var NETLAB_MCP_TOKEN`, with the token in `NETLAB_MCP_TOKEN`
- **Gemini CLI**: a `mcpServers` entry for `~/.gemini/settings.json`
- **Cursor**: a `mcpServers` entry for `~/.cursor/mcp.json`
- **VS Code**: a `servers` entry for `.vscode/mcp.json`

Without the UI, `GET /api/assistant/capabilities` returns the URL, token, tool list and a generic `mcpServers` config:

```bash
curl -s localhost:8000/api/assistant/capabilities | jq -r .mcp.clientConfig
```

The token is random per backend start. Set `NETLAB_APP_ASSISTANT_TOKEN` so an agent's config keeps working across restarts.

## What the agent can do

| Tools | |
| ----- | - |
| **Read** | `list_labs`, `get_lab` (nodes with management IPs and loopbacks, and every link with its interfaces and IPs: what netlab builds, so "what IP did r1 get" works), `get_lab_status`, `get_topology_yaml`, `netlab_inspect` (the complete data model), `list_workspace_files`, `read_workspace_file`, `get_selection_context` (what you've selected on the canvas) |
| **Run** | `run_show_command`: one read-only command (`show …`, `ping`, `traceroute`, `ip …`) on several or all running nodes in parallel, identical answers merged. Writes and configuration are rejected by an allowlist in code, not by asking the model nicely. Also `get_config_changes` (running-config drift since the last deploy), `validate_topology`, `run_fcli_report`. |
| **Propose** | `propose_topology_edit`, `propose_fault_injection`: staged for your approval (see below) |
| **Write** | `write_workspace_file`: creates or overwrites a file inside the open lab's directory, without approval |
| **Teach** | `get_teaching_document`, `create_teaching_document`: guided tour and exercises |

The tools are built to keep the agent's context small:

- **Labs by name:** every tool takes an optional `lab`, the lab's name. Without it, the lab you opened last is used.
- **Short by default:** answers are compact, and `get_lab` and `get_lab_status` take `detail: "full"` when the agent needs more.
- **One block per answer:** each answer is a single compact JSON (or text) block.
- **Useful errors:** an error says what to do next, for example which labs are open.
- **Marked tools:** each tool is marked read-only or not, so clients can auto-approve reads and ask before writes.

## Reviewing proposed changes

`propose_topology_edit` and `propose_fault_injection` don't change anything by themselves. The proposal shows up in the **AI agents** panel as a diff, and a toast tells you when one arrives while the panel is closed. **Apply** runs it through the same undoable command path as a canvas edit, so `Ctrl+Z` works. **Reject** drops it. A proposal made against an older version of the topology is marked stale instead of applied.

Everything the agent reads (device output, file contents, config comments) is untrusted input to a model. That's why topology edits and faults need your approval, and why `run_show_command` is read-only. `write_workspace_file` is the exception: it can write any file in the lab's directory, the topology YAML included. Only connect agents you trust with that folder.

## Configuration

The MCP server is part of the default install (the `mcp` package) and served on the same port under `/mcp`.

| Variable                       | Default                       | Meaning |
| ------------------------------ | ----------------------------- | ------- |
| `NETLAB_APP_ASSISTANT`         | `auto`                        | `auto` = on when `mcp` is installed; `on` = also warn when it isn't; `off` = fully disabled |
| `NETLAB_APP_ASSISTANT_TOKEN`   | random per start              | Bearer token for `/mcp`; set it to keep agent configs working across restarts |
| `NETLAB_APP_ASSISTANT_MCP_URL` | the address you opened netlab-ui on, plus `/mcp` | The URL given to agents. Set it when the agent reaches netlab-ui differently than your browser does (another machine, a proxy). |

## Possible later: a chat window via ACP

The [Agent Client Protocol](https://agentclientprotocol.com) (ACP, from Zed) drives Claude Code, Gemini CLI, Codex and others through one protocol. netlab-ui could use it for a native chat panel (one generic UI, no per-provider code, diffs and approvals from the protocol) instead of the agent's terminal UI. Not built: the terminal gives the same agents with far less code to maintain.

Everything AI-related lives in `backend/services/assistant/`, `backend/app/assistant/` and `frontend/src/components/agents/`.
