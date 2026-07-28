"""Claude Code adapter.

Drives the user's locally installed, already-logged-in ``claude`` CLI through
``claude-agent-sdk``. Their Claude subscription (or API key, if that is how they
signed in) is used by the CLI itself — netlab-ui never sees a credential.

Every symbol from the SDK is confined to this file, so an upstream API change is
a one-file fix.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any, ClassVar

from services.assistant.config import MCP_SERVER_NAME, claude_model
from services.assistant.providers.base import AgentEvent, ProviderInfo, SessionSpec, probe_cli

logger = logging.getLogger(__name__)

# Built-in Claude Code tools the assistant must not use: it acts on the lab
# through our MCP tools, and every mutation goes through the approval flow.
_DISALLOWED = [
    "Bash",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "Task",
]


def detect() -> ProviderInfo:
    version = probe_cli("claude")
    try:
        import claude_agent_sdk  # noqa: F401
    except ImportError:
        return ProviderInfo(
            id="claude",
            name="Claude Code",
            available=False,
            version=version,
            note="install the assistant extra (claude-agent-sdk) to use Claude",
        )
    if version is None:
        return ProviderInfo(
            id="claude",
            name="Claude Code",
            available=False,
            note="claude CLI not found on PATH — install Claude Code and run `claude` once to log in",
        )
    return ProviderInfo(
        id="claude",
        name="Claude Code",
        available=True,
        version=version,
        takes_model=True,
        api_key_url="https://console.anthropic.com/",
    )


class ClaudeProvider:
    provider_id: ClassVar[str] = "claude"

    def __init__(self) -> None:
        self._client: Any = None

    async def start(self, spec: SessionSpec) -> None:
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

        options = ClaudeAgentOptions(
            model=claude_model() or None,
            system_prompt=spec.system_prompt,
            mcp_servers={
                MCP_SERVER_NAME: {
                    "type": "http",
                    "url": spec.mcp_url,
                    "headers": {"Authorization": f"Bearer {spec.mcp_token}"},
                }
            },
            allowed_tools=[f"mcp__{MCP_SERVER_NAME}__*"],
            disallowed_tools=_DISALLOWED,
            # Our MCP server is the whole tool surface; don't inherit the
            # user's global/project Claude Code config into this session.
            strict_mcp_config=True,
            setting_sources=[],
            # There is no terminal to prompt in, and prompting is not what
            # guards this session: the exposed tools either read, or park a
            # change in the proposal store for the user to approve in the UI.
            permission_mode="bypassPermissions",
            cwd=spec.cwd,
            include_partial_messages=True,
        )
        self._client = ClaudeSDKClient(options=options)
        await self._client.connect()

    async def send(self, prompt: str) -> AsyncIterator[AgentEvent]:
        if self._client is None:
            raise RuntimeError("provider not started")
        await self._client.query(prompt)
        async for message in self._client.receive_response():
            for event in _translate(message):
                yield event

    async def cancel(self) -> None:
        if self._client is not None:
            await self._client.interrupt()

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            await client.disconnect()


def _translate(message: Any) -> list[AgentEvent]:
    """Map one SDK message onto zero or more UI events."""
    from claude_agent_sdk import (
        AssistantMessage,
        ResultMessage,
        StreamEvent,
        TextBlock,
        ThinkingBlock,
        ToolResultBlock,
        ToolUseBlock,
    )

    # Partial messages carry the token stream; the completed AssistantMessage
    # that follows repeats the same text, so only the deltas are forwarded.
    if isinstance(message, StreamEvent):
        event = message.event or {}
        if event.get("type") == "content_block_delta":
            delta = event.get("delta") or {}
            if delta.get("type") == "text_delta" and delta.get("text"):
                return [AgentEvent("text_delta", {"text": delta["text"]})]
            if delta.get("type") == "thinking_delta":
                return [AgentEvent("thinking", {})]
        return []

    if isinstance(message, AssistantMessage):
        events: list[AgentEvent] = []
        for block in message.content:
            if isinstance(block, ToolUseBlock):
                events.append(
                    AgentEvent(
                        "tool_call",
                        {"toolUseId": block.id, "tool": _short_name(block.name), "args": block.input},
                    )
                )
            elif isinstance(block, ToolResultBlock):
                events.append(
                    AgentEvent(
                        "tool_result",
                        {
                            "toolUseId": block.tool_use_id,
                            "ok": not block.is_error,
                            "preview": _preview(block.content),
                        },
                    )
                )
            elif isinstance(block, ThinkingBlock):
                events.append(AgentEvent("thinking", {}))
            elif isinstance(block, TextBlock):
                # Text already arrived as deltas; nothing to emit.
                pass
        return events

    if isinstance(message, ResultMessage):
        return [
            AgentEvent(
                "turn_done",
                {
                    "stopReason": "error" if message.is_error else "end_turn",
                    "costUsd": message.total_cost_usd,
                    "durationMs": message.duration_ms,
                },
            )
        ]

    return []


def _short_name(name: str) -> str:
    """``mcp__netlab__get_topology_yaml`` → ``get_topology_yaml``."""
    prefix = f"mcp__{MCP_SERVER_NAME}__"
    return name[len(prefix) :] if name.startswith(prefix) else name


def _preview(content: Any, limit: int = 200) -> str:
    if isinstance(content, list):
        text = " ".join(
            part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
        )
    else:
        text = str(content or "")
    text = text.strip().replace("\n", " ")
    return text[:limit] + ("…" if len(text) > limit else "")
