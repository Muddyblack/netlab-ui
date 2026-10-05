"""Launch the user's own AI agent CLI, already connected to netlab-ui's MCP server.

netlab-ui doesn't implement any agent: it starts the vendor's CLI in the lab's
directory inside a PTY, and the UI shows that CLI's own terminal interface. The
agent, its login and its updates all belong to the vendor; the only thing added
here is the MCP connection.

Every agent is one row of ``HARNESSES``; how it gets connected is one of three
kinds, chosen by what its CLI offers:

* ``session``: the connection is passed for this run only (a flag or an
  environment variable pointing at a private file), so the user's own config
  files are left alone;
* ``register``: the CLI has no per-run option, so before starting it we run its
  own ``mcp add`` (with the current token, which changes whenever netlab-ui
  restarts). It is stored in the CLI's config, like the command the panel shows;
* ``manual``: nothing we could rely on, so the CLI is started plainly and the
  panel shows how to connect it by hand.

To support another CLI, add a row, and one entry to ``_SESSION`` / ``_REGISTER`` /
``_MANUAL`` for its kind. Nothing else in the codebase names an agent.

The CLI runs on the backend host, as the backend's user. That's why it's only
offered when the binary is actually installed there (not in the container
image) and why the WebSocket that starts one is restricted (see the router).
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from services import host
from services.assistant.config import MCP_SERVER_NAME, mcp_base_url, mcp_token

# Env var agents read the bearer token from where their config supports a reference.
TOKEN_ENV = "NETLAB_MCP_TOKEN"

Kind = Literal["session", "register", "manual"]
# (argv, extra environment)
Launch = tuple[list[str], dict[str, str]]


@dataclass(frozen=True)
class Harness:
    id: str
    name: str
    binary: str
    homepage: str
    mcp: Kind


HARNESSES: tuple[Harness, ...] = (
    Harness("claude", "Claude Code", "claude", "https://claude.com/claude-code", "session"),
    Harness("codex", "Codex", "codex", "https://github.com/openai/codex", "session"),
    Harness("copilot", "GitHub Copilot", "copilot", "https://github.com/features/copilot/cli", "session"),
    Harness("opencode", "OpenCode", "opencode", "https://opencode.ai", "session"),
    Harness("cursor", "Cursor Agent", "cursor-agent", "https://cursor.com/cli", "session"),
    Harness("antigravity", "Antigravity", "agy", "https://antigravity.google", "register"),
    Harness("cline", "Cline", "cline", "https://cline.bot/cli", "register"),
    Harness("grok", "Grok", "grok", "https://x.ai/cli", "register"),
    Harness("vibe", "Mistral Vibe", "vibe", "https://github.com/mistralai/mistral-vibe", "register"),
    Harness("kiro", "Kiro", "kiro-cli", "https://kiro.dev/cli", "session"),
    Harness("junie", "Junie", "junie", "https://www.jetbrains.com/junie", "manual"),
    Harness("kimi", "Kimi", "kimi", "https://github.com/MoonshotAI/kimi-cli", "manual"),
    Harness("qwen", "Qwen Code", "qwen", "https://github.com/QwenLM/qwen-code", "manual"),
    Harness("mimo", "MiMo", "mimo", "https://github.com/XiaomiMiMo", "manual"),
)


def get(harness_id: str) -> Harness | None:
    return next((h for h in HARNESSES if h.id == harness_id), None)


def available(request_base: str | None = None) -> list[dict[str, object]]:
    """Every known agent CLI: whether it is installed here, how it gets connected, and
    (for ``manual`` ones) how to connect it by hand."""
    url, token = mcp_base_url(request_base), mcp_token()
    found = host.which_all([h.binary for h in HARNESSES])
    result: list[dict[str, object]] = []
    for h in HARNESSES:
        item: dict[str, object] = {
            "id": h.id,
            "name": h.name,
            "available": found[h.binary] is not None,
            "homepage": h.homepage,
            "mcp": h.mcp,
            "skipPermissions": h.id in YOLO_FLAGS,
        }
        if h.mcp == "manual":
            where, text = _MANUAL[h.id](url, token)
            item["connect"] = {"where": where, "text": text}
        result.append(item)
    return result


def _binary(harness: Harness) -> str:
    binary = host.which(harness.binary)
    if not binary:
        where = "inside the netlab-ui container" if host.in_container() and host.mode() != "host" else "on the host"
        raise FileNotFoundError(f"{harness.name} ({harness.binary}) is not installed {where}")
    return binary


# What each CLI takes to stop asking before it edits files or runs commands. Only agents whose flag
# is known are listed; the panel offers the switch for those. Off unless the user asks for it.
YOLO_FLAGS: dict[str, list[str]] = {
    "claude": ["--dangerously-skip-permissions"],
    "codex": ["--dangerously-bypass-approvals-and-sandbox"],
    "copilot": ["--allow-all-tools"],
    "cursor": ["--force"],
    "antigravity": ["--mode", "accept-edits", "--dangerously-skip-permissions"],
    "cline": ["--yolo"],
    "vibe": ["--auto-approve"],
    "kiro": ["chat", "--trust-all-tools"],
    "kimi": ["--yolo"],
    "qwen": ["--yolo"],
}


def launch_spec(
    harness: Harness,
    request_base: str | None = None,
    workdir: Path | None = None,
    with_mcp: bool = True,
    yolo: bool = False,
) -> Launch:
    """``(argv, extra_env)`` that starts ``harness``, connected to the MCP server unless
    ``with_mcp`` is off (or the agent can only be connected by hand).

    The token never goes on the agent's own command line (visible to every local user in
    the process list): it travels in a private file or an environment variable.
    Raises ``FileNotFoundError`` when the CLI isn't installed.
    """
    argv, env = _launch(harness, request_base, workdir, with_mcp)
    return argv + (YOLO_FLAGS.get(harness.id, []) if yolo else []), env


def _launch(harness: Harness, request_base: str | None, workdir: Path | None, with_mcp: bool) -> Launch:
    binary = _binary(harness)
    if not with_mcp or harness.mcp == "manual":
        return [binary], {}
    url, token = mcp_base_url(request_base), mcp_token()
    if harness.mcp == "register":
        # Registered through the CLI's own `mcp add` beforehand (setup_commands); some
        # configs refer to the token by variable name, so it is in the environment too.
        return [binary], {TOKEN_ENV: token}
    return _SESSION[harness.id](binary, url, token, workdir)


def setup_commands(harness: Harness, request_base: str | None = None, with_mcp: bool = True) -> list[Launch]:
    """Commands to run (and wait for) before the agent starts, as ``(argv, env)``.

    Only ``register`` agents have any: they replace the ``netlab`` server in the CLI's own
    config with one that has today's URL and token. Failures are not fatal (the agent
    still starts); the caller reports them."""
    if not with_mcp or harness.mcp != "register":
        return []
    binary = _binary(harness)
    return [
        (argv, {TOKEN_ENV: mcp_token()})
        for argv in _REGISTER[harness.id](binary, mcp_base_url(request_base), mcp_token())
    ]


# --------------------------------------------------------------------- session kind


def _claude(binary: str, url: str, token: str, _workdir: Path | None) -> Launch:
    config = _private_json(
        "claude", {"mcpServers": {MCP_SERVER_NAME: {"type": "http", "url": url, "headers": _auth(token)}}}
    )
    return [binary, "--mcp-config", str(config)], {}


def _codex(binary: str, url: str, token: str, _workdir: Path | None) -> Launch:
    server = f"mcp_servers.{MCP_SERVER_NAME}"
    argv = [binary, "-c", f'{server}.url="{url}"', "-c", f'{server}.bearer_token_env_var="{TOKEN_ENV}"']
    return argv, {TOKEN_ENV: token}


def _copilot(binary: str, url: str, token: str, _workdir: Path | None) -> Launch:
    # "augments config from ~/.copilot/mcp-config.json for this session" (copilot --help)
    server = {"type": "http", "url": url, "headers": _auth(token), "tools": ["*"]}
    config = _private_json("copilot", {"mcpServers": {MCP_SERVER_NAME: server}})
    return [binary, "--additional-mcp-config", f"@{config}"], {}


def _opencode(binary: str, url: str, token: str, _workdir: Path | None) -> Launch:
    # OpenCode merges an inline config from this variable over the user's own.
    server = {"type": "remote", "url": url, "headers": _auth(token), "enabled": True}
    return [binary], {"OPENCODE_CONFIG_CONTENT": json.dumps({"mcp": {MCP_SERVER_NAME: server}})}


def _project_mcp_file(workdir: Path | None, relative: str, url: str, token_ref: str) -> None:
    """Add the netlab server to an MCP config the agent reads from the lab's own folder, keeping
    the user's other servers. The header refers to the token by variable (``token_ref``), so the
    file holds no secret and stays valid when netlab-ui restarts with a new token."""
    if workdir is None:
        return
    path = workdir / relative
    try:
        doc = json.loads(path.read_text()) if path.is_file() else {}
    except (OSError, json.JSONDecodeError):
        doc = {}
    server = {"url": url, "headers": {"Authorization": f"Bearer {token_ref}"}}
    doc.setdefault("mcpServers", {})[MCP_SERVER_NAME] = server
    made = not path.parent.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2))
    # In a container the backend is root; the agent runs as the host user and must be able to use these.
    if made:
        host.share(path.parent)
    host.share(path)


def _cursor(binary: str, url: str, token: str, workdir: Path | None) -> Launch:
    # Cursor: <lab>/.cursor/mcp.json, ${env:VAR} in headers. --approve-mcps skips the per-server prompt.
    _project_mcp_file(workdir, ".cursor/mcp.json", url, f"${{env:{TOKEN_ENV}}}")
    return [binary, "--approve-mcps"], {TOKEN_ENV: token}


def _kiro(binary: str, url: str, token: str, workdir: Path | None) -> Launch:
    # Kiro: <lab>/.kiro/settings/mcp.json, ${VAR} in headers (kiro.dev/docs/mcp/configuration).
    # Checked: `kiro-cli mcp list` shows the server from this file.
    _project_mcp_file(workdir, ".kiro/settings/mcp.json", url, f"${{{TOKEN_ENV}}}")
    return [binary], {TOKEN_ENV: token}


_SESSION: dict[str, Callable[[str, str, str, Path | None], Launch]] = {
    "claude": _claude,
    "codex": _codex,
    "copilot": _copilot,
    "opencode": _opencode,
    "cursor": _cursor,
    "kiro": _kiro,
}


# -------------------------------------------------------------------- register kind
# Each returns the argv list to run, in order. Verified against the installed CLIs: all
# of them add (or replace) an HTTP server with their own `mcp add`.
# Where a CLI takes a literal header, the token is briefly in that one command's argv.


def _bearer(token: str) -> str:
    return f"Authorization: Bearer {token}"


_REGISTER: dict[str, Callable[[str, str, str], list[list[str]]]] = {
    "antigravity": lambda b, url, t: [[b, "mcp", "add", "--header", _bearer(t), MCP_SERVER_NAME, url]],
    "cline": lambda b, url, t: [
        [b, "mcp", "add", "--yes", "--transport", "http", "--header", _bearer(t), MCP_SERVER_NAME, url]
    ],
    "grok": lambda b, url, t: [[b, "mcp", "add", "--transport", "http", "--header", _bearer(t), MCP_SERVER_NAME, url]],
    # Vibe stores a reference to the variable, not the token, so its config stays valid.
    "vibe": lambda b, url, _t: [
        [b, "mcp", "remove", MCP_SERVER_NAME],
        [
            b,
            "mcp",
            "add",
            MCP_SERVER_NAME,
            "--transport",
            "streamable-http",
            "--url",
            url,
            "--bearer-token-env-var",
            TOKEN_ENV,
        ],
    ],
}


# ---------------------------------------------------------------------- manual kind


def _json_config(where: str, key: str = "url") -> Callable[[str, str], tuple[str, str]]:
    def build(url: str, token: str) -> tuple[str, str]:
        server = {key: url, "headers": _auth(token)}
        return where, json.dumps({"mcpServers": {MCP_SERVER_NAME: server}}, indent=2)

    return build


def _add_command(binary: str) -> Callable[[str, str], tuple[str, str]]:
    def build(url: str, token: str) -> tuple[str, str]:
        return (
            "Run once in a terminal",
            f'{binary} mcp add --transport http {MCP_SERVER_NAME} {url} --header "{_bearer(token)}"',
        )

    return build


# Not checked against the real CLIs (not installed where this was written): they follow each
# vendor's documented config, and are shown for the user to apply.
_MANUAL: dict[str, Callable[[str, str], tuple[str, str]]] = {
    "junie": _json_config("~/.junie/mcp/mcp.json"),
    "kimi": _add_command("kimi"),
    "qwen": _add_command("qwen"),
    "mimo": _json_config("MiMo's MCP settings (see its documentation)"),
}


# -------------------------------------------------------------------------- helpers


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _private_json(name: str, data: dict[str, Any]) -> Path:
    """Write ``data`` to a file only the agent's user can read (it holds the MCP token).

    Returns the path *the agent* uses, which in a container differs from where this process wrote it
    (see :func:`services.assistant.host.shared_dir`)."""
    written, visible = host.shared_dir()
    filename = f"netlab-ui-{name}-mcp-{os.getuid()}.json"
    path = written / filename
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle)
    os.chmod(path, 0o600)  # an older file may predate the mode above
    host.share(path)
    return visible / filename
