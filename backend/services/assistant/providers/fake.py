"""Scripted provider for tests and UI development.

Exposed to the UI only when ``NETLAB_APP_ASSISTANT_FAKE=1``, so the whole chat
flow — streaming text, tool chips, proposal cards — can be exercised without any
agent CLI installed or any tokens spent.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import ClassVar

from services.assistant.providers.base import AgentEvent, ProviderInfo, SessionSpec


def detect() -> ProviderInfo:
    return ProviderInfo(id="fake", name="Demo (scripted)", available=True, note="scripted replies; no AI")


class FakeProvider:
    provider_id: ClassVar[str] = "fake"

    def __init__(self, script: list[AgentEvent] | None = None) -> None:
        self._script = script
        self._cancelled = False
        self.started_with: SessionSpec | None = None
        self.last_prompt: str = ""

    async def start(self, spec: SessionSpec) -> None:
        self.started_with = spec

    async def send(self, prompt: str) -> AsyncIterator[AgentEvent]:
        self.last_prompt = prompt
        self._cancelled = False
        for event in self._script or _default_script(prompt):
            if self._cancelled:
                yield AgentEvent("turn_done", {"stopReason": "cancelled"})
                return
            await asyncio.sleep(0)
            yield event

    async def cancel(self) -> None:
        self._cancelled = True

    async def close(self) -> None:
        return None


def _default_script(prompt: str) -> list[AgentEvent]:
    return [
        AgentEvent("tool_call", {"toolUseId": "u1", "tool": "get_topology_yaml", "args": {}}),
        AgentEvent("tool_result", {"toolUseId": "u1", "ok": True, "preview": "nodes: r1, r2"}),
        AgentEvent("text_delta", {"text": "This is the scripted demo provider. "}),
        AgentEvent("text_delta", {"text": f"You said: {prompt[:80]}"}),
        AgentEvent("turn_done", {"stopReason": "end_turn"}),
    ]
