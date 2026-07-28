"""Provider adapter interface.

A *provider* is a locally installed agent CLI that the user has already logged
into (Claude Code, Codex, Gemini). netlab-ui never handles their credentials or
API keys: it spawns the CLI, points it at our MCP endpoint, and relays events.
That is what makes subscription plans work — the CLI authenticates itself.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol, runtime_checkable


@dataclass
class AgentEvent:
    """One thing that happened during a turn, on its way to the browser."""

    type: str  # text_delta | thinking | tool_call | tool_result | turn_done | error
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderInfo:
    id: str
    name: str
    available: bool
    version: str | None = None
    note: str | None = None
    # Whether this provider takes a user-entered API key / base URL from the
    # settings dialog (Gemini, ChatGPT, OpenAI-compatible incl. the vendor
    # presets), as opposed to a CLI agent that authenticates itself
    # (Claude Code, Codex, agy). Single source of truth for the frontend
    # instead of a hand-copied id list.
    configurable: bool = False
    # Whether this provider has a model to pick — true for every real provider
    # (configurable ones and the CLI agents alike), false only for the dev-only
    # fake provider. Separate from ``configurable``: a CLI agent has a model
    # flag but no API key/base URL to configure.
    takes_model: bool = False
    api_key_url: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "available": self.available,
            "version": self.version,
            "note": self.note,
            "configurable": self.configurable,
            "takesModel": self.takes_model,
            "apiKeyUrl": self.api_key_url,
        }


@dataclass
class SessionSpec:
    """Everything a provider needs to start a conversation."""

    system_prompt: str
    mcp_url: str
    mcp_token: str
    cwd: str


@runtime_checkable
class AgentProvider(Protocol):
    provider_id: ClassVar[str]

    async def start(self, spec: SessionSpec) -> None: ...

    def send(self, prompt: str) -> AsyncIterator[AgentEvent]:
        """Run one turn, yielding events until it completes."""
        ...

    async def cancel(self) -> None: ...

    async def close(self) -> None: ...


def probe_cli(binary: str, args: tuple[str, ...] = ("--version",), timeout: float = 4.0) -> str | None:
    """Return a CLI's version string, or None when it isn't usable.

    Mirrors ``runner._tool_output``: a short blocking probe is fine here because
    detection runs on the capabilities endpoint, not in a hot path.
    """
    if shutil.which(binary) is None:
        return None
    try:
        result = subprocess.run(
            [binary, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    output = (result.stdout or result.stderr).strip()
    return output.splitlines()[0] if output else "installed"
