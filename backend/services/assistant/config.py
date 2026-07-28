"""Environment configuration and limits for the assistant feature.

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

    ``auto`` enables the feature when its optional dependencies are installed;
    ``on`` additionally logs when they are not; ``off`` disables it outright.
    """
    mode = os.environ.get("NETLAB_APP_ASSISTANT", "auto").strip().lower()
    return mode if mode in _VALID_MODES else "auto"


def fake_provider_enabled() -> bool:
    """Expose the scripted provider used for UI development and manual testing."""
    return os.environ.get("NETLAB_APP_ASSISTANT_FAKE", "").strip().lower() in {"1", "true", "yes"}


# ------------------------------------------------------------- direct-API keys
# Gemini and ChatGPT have no local, already-authenticated CLI like Claude Code
# does, so their providers call the vendor API directly with a key the user
# sets in the assistant settings dialog (or an env var). See
# services.assistant.settings for where these are actually stored; netlab-ui
# holds them in the backend process/disk only — they are never sent back to
# the browser after being set.
def gemini_api_key() -> str:
    from services.assistant import settings

    return settings.get("gemini").get("apiKey", "")


def gemini_model() -> str:
    from services.assistant import settings

    return settings.get("gemini").get("model") or "gemini-3-pro-preview"


def openai_api_key() -> str:
    from services.assistant import settings

    return settings.get("openai").get("apiKey", "")


def openai_model() -> str:
    from services.assistant import settings

    return settings.get("openai").get("model") or "gpt-5.1"


# OpenAI-compatible providers (Ollama, OpenRouter, LM Studio, vLLM, …) reuse the
# OpenAI SDK against a user-supplied base URL. There is no sensible default base
# URL or model — both name a concrete endpoint the user chose — so they come
# from settings with no fallback. The key is optional (local runtimes ignore it).
def openai_compat_base_url() -> str:
    from services.assistant import settings

    return settings.get("openai_compat").get("baseUrl", "")


def openai_compat_api_key() -> str:
    from services.assistant import settings

    return settings.get("openai_compat").get("apiKey", "")


def openai_compat_model() -> str:
    from services.assistant import settings

    return settings.get("openai_compat").get("model", "")


# CLI agents authenticate and pick a model themselves, but each exposes a flag
# to override it. An empty string means "don't pass the flag — let the CLI use
# its own default", not "use this literal empty model".
def claude_model() -> str:
    from services.assistant import settings

    return settings.get("claude").get("model", "")


def codex_model() -> str:
    from services.assistant import settings

    return settings.get("codex").get("model", "")


def agy_model() -> str:
    from services.assistant import settings

    return settings.get("agy").get("model", "")


# ------------------------------------------------------------------ MCP access
# Agent CLIs run as separate local processes, so the MCP endpoint cannot be
# protected by the browser's same-origin policy. A bearer token keeps other
# local processes (and drive-by browser requests) out. A caller-supplied token
# makes the URL stable across restarts for users who wire up their own agent.
_TOKEN = os.environ.get("NETLAB_APP_ASSISTANT_TOKEN", "").strip() or secrets.token_urlsafe(32)


def mcp_token() -> str:
    return _TOKEN


def mcp_base_url() -> str:
    """Public URL of the mounted MCP endpoint.

    Agent CLIs are spawned on the same host, so the loopback default is right
    for the normal case; deployments behind a proxy override it.
    """
    explicit = os.environ.get("NETLAB_APP_ASSISTANT_MCP_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    host = os.environ.get("NETLAB_APP_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = os.environ.get("NETLAB_APP_PORT", "8000").strip() or "8000"
    return f"http://{host}:{port}{MCP_MOUNT_PATH}"


MCP_MOUNT_PATH = "/mcp"
MCP_SERVER_NAME = "netlab"

# ---------------------------------------------------------------------- limits
MAX_CONCURRENT_CHATS = 3
MAX_PROPOSALS = 50
# Tool payload caps: an agent context is finite, and a runaway file read or
# command output helps nobody.
MAX_FILE_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
EXEC_TIMEOUT_S = 30.0
MAX_CONCURRENT_EXEC = 4
# SSE keepalive: proxies drop idle connections, and an agent turn can think for
# a while before emitting its first token.
HEARTBEAT_S = 15.0
