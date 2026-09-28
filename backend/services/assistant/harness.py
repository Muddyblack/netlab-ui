"""Launch the user's own AI agent CLI, already connected to netlab-ui's MCP server.

netlab-ui doesn't implement any agent: it starts the vendor's CLI (Claude Code,
Codex, Gemini CLI) in the lab's directory inside a PTY, and the UI shows that
CLI's own terminal interface. The agent, its login and its updates all belong
to the vendor; the only thing added here is the MCP connection, passed on the
command line or through the environment so the user's own config files are
left alone.

The CLI runs on the backend host, as the backend's user. That's why it's only
offered when the binary is actually installed there (not in the container
image) and why the WebSocket that starts one is restricted (see the router).
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services.assistant.config import MCP_SERVER_NAME, mcp_base_url, mcp_token

# Env var the Codex config reads the bearer token from (`bearer_token_env_var`).
_CODEX_TOKEN_ENV = "NETLAB_MCP_TOKEN"


@dataclass(frozen=True)
class Harness:
    id: str
    name: str
    binary: str
    homepage: str


HARNESSES: tuple[Harness, ...] = (
    Harness("claude", "Claude Code", "claude", "https://claude.com/claude-code"),
    Harness("codex", "Codex", "codex", "https://github.com/openai/codex"),
    Harness("gemini", "Gemini CLI", "gemini", "https://github.com/google-gemini/gemini-cli"),
)


def available() -> list[dict[str, object]]:
    """Every known agent CLI and whether it is installed on the backend host."""
    return [
        {"id": h.id, "name": h.name, "available": shutil.which(h.binary) is not None, "homepage": h.homepage}
        for h in HARNESSES
    ]


def get(harness_id: str) -> Harness | None:
    return next((h for h in HARNESSES if h.id == harness_id), None)


def launch_spec(harness: Harness, request_base: str | None = None) -> tuple[list[str], dict[str, str]]:
    """``(argv, extra_env)`` that starts ``harness`` connected to the MCP server.

    The token never goes on the command line (visible to every local user in
    the process list): it travels in a private file or an environment variable.
    Raises ``FileNotFoundError`` when the CLI isn't installed.
    """
    binary = shutil.which(harness.binary)
    if not binary:
        raise FileNotFoundError(f"{harness.name} ({harness.binary}) is not installed on the netlab-ui host")
    url, token = mcp_base_url(request_base), mcp_token()
    auth = {"Authorization": f"Bearer {token}"}
    if harness.id == "claude":
        config = _private_json(
            "claude", {"mcpServers": {MCP_SERVER_NAME: {"type": "http", "url": url, "headers": auth}}}
        )
        return [binary, "--mcp-config", str(config)], {}
    if harness.id == "codex":
        server = f"mcp_servers.{MCP_SERVER_NAME}"
        argv = [binary, "-c", f'{server}.url="{url}"', "-c", f'{server}.bearer_token_env_var="{_CODEX_TOKEN_ENV}"']
        return argv, {_CODEX_TOKEN_ENV: token}
    if harness.id == "gemini":
        # Gemini CLI has no flag for an MCP server; it merges a system settings
        # file (path overridable by env) with the user's own settings.
        settings = _private_json("gemini", {"mcpServers": {MCP_SERVER_NAME: {"httpUrl": url, "headers": auth}}})
        return [binary], {"GEMINI_CLI_SYSTEM_SETTINGS_PATH": str(settings)}
    raise ValueError(f"unknown harness {harness.id!r}")


def _private_json(name: str, data: dict[str, Any]) -> Path:
    """Write ``data`` to a file only this user can read (it holds the MCP token)."""
    path = Path(tempfile.gettempdir()) / f"netlab-ui-{name}-mcp-{os.getuid()}.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle)
    os.chmod(path, 0o600)  # an older file may predate the mode above
    return path
