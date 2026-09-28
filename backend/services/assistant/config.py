"""Environment configuration and limits for the MCP server.

Follows the backend's existing convention: plain ``os.environ`` reads, no
settings object.
"""

from __future__ import annotations

import os
import secrets

# ---------------------------------------------------------------- feature flag
_VALID_MODES = {"auto", "on", "off"}


def assistant_mode() -> str:
    """``auto`` (default) | ``on`` | ``off``.

    ``auto`` enables the MCP server when its optional dependency is installed;
    ``on`` additionally logs when it is not; ``off`` disables it outright.
    """
    mode = os.environ.get("NETLAB_APP_ASSISTANT", "auto").strip().lower()
    return mode if mode in _VALID_MODES else "auto"


# ------------------------------------------------------------------ MCP access
# Agents run as separate processes, so the MCP endpoint cannot be protected by
# the browser's same-origin policy. A bearer token keeps other local processes
# (and drive-by browser requests) out. A caller-supplied token makes the config
# stable across restarts for users who wire up their own agent.
_TOKEN = os.environ.get("NETLAB_APP_ASSISTANT_TOKEN", "").strip() or secrets.token_urlsafe(32)


def mcp_token() -> str:
    return _TOKEN


def mcp_base_url(request_base: str | None = None) -> str:
    """Public URL of the mounted MCP endpoint.

    ``NETLAB_APP_ASSISTANT_MCP_URL`` wins (proxies, other machines). Otherwise
    the address the request came in on (``request_base``), which is right
    whatever port uvicorn was started with; failing that, the configured port
    on loopback.
    """
    explicit = os.environ.get("NETLAB_APP_ASSISTANT_MCP_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    if request_base:
        return request_base.rstrip("/") + MCP_MOUNT_PATH
    # The container image and run.sh configure uvicorn through UVICORN_*.
    host = (os.environ.get("NETLAB_APP_HOST") or os.environ.get("UVICORN_HOST") or "").strip()
    if host in {"", "0.0.0.0", "::"}:  # a bind-all address is not something a client can dial
        host = "127.0.0.1"
    port = (os.environ.get("NETLAB_APP_PORT") or os.environ.get("UVICORN_PORT") or "8000").strip()
    return f"http://{host}:{port}{MCP_MOUNT_PATH}"


MCP_MOUNT_PATH = "/mcp"
MCP_SERVER_NAME = "netlab"

# ---------------------------------------------------------------------- limits
MAX_PROPOSALS = 50
# Tool payload caps: an agent context is finite, and a runaway file read or
# command output helps nobody.
MAX_FILE_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
EXEC_TIMEOUT_S = 30.0
MAX_CONCURRENT_EXEC = 4
