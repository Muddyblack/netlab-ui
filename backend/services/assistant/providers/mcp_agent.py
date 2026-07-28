"""Shared plumbing for providers that speak to a vendor chat API directly.

Unlike :mod:`.claude` (which drives a locally installed CLI that already knows
how to be an MCP client), Gemini and OpenAI are plain chat completion APIs: we
own the agent loop. This module is that loop, factored out so
:mod:`.gemini` and :mod:`.openai` only have to translate between our
vendor-neutral shape and each SDK's request/response objects.

The loop:

1. Connect to netlab-ui's own MCP endpoint (the same one Claude Code is
   pointed at) as an MCP *client*, and fetch its tool list.
2. Hand those tools to the vendor API alongside the conversation.
3. When the model asks for a tool call, execute it over the MCP session and
   feed the result back, repeating until the model produces a final answer.
"""

from __future__ import annotations

import abc
import contextlib
import importlib.util
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, ClassVar

try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    from mcp.shared.exceptions import McpError
except ImportError:
    ClientSession = Any  # type: ignore[misc,assignment]
    streamablehttp_client = Any  # type: ignore[misc,assignment]
    McpError = Exception  # type: ignore[misc,assignment]

from services.assistant.providers.base import AgentEvent, ProviderInfo, SessionSpec

logger = logging.getLogger(__name__)

# A runaway tool-call loop helps nobody; the vendor CLIs impose similar caps.
MAX_TOOL_ROUNDS = 25


def mcp_available() -> bool:
    """Whether the optional ``mcp`` package is installed.

    Every :class:`McpAgentProvider` subclass needs this at ``start()`` time (it
    connects to netlab-ui's own MCP endpoint as a client), but each vendor's
    ``detect()`` only checks its own SDK. Call this from each ``detect()`` too,
    so an install missing ``mcp`` reports unavailable instead of crashing on
    first use.
    """
    return importlib.util.find_spec("mcp") is not None


def require_mcp(provider_id: str, name: str) -> ProviderInfo | None:
    """``ProviderInfo`` explaining the missing ``mcp`` dependency, or None if present."""
    if mcp_available():
        return None
    return ProviderInfo(
        id=provider_id,
        name=name,
        available=False,
        note=f"install the assistant extra (mcp) to use {name}",
        configurable=True,
        takes_model=True,
    )


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class TurnResult:
    """What one round-trip to the vendor API produced."""

    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = "end_turn"
    usage: dict[str, Any] = field(default_factory=dict)
    # The vendor's own assistant message, kept verbatim. Current models attach
    # opaque state to their output — Gemini's `thought_signature`, OpenAI's
    # reasoning items — that must be echoed back on the next request, and
    # rebuilding the message from the neutral fields above silently drops it.
    # Providers append this rather than a reconstruction; see
    # ``_append_assistant_turn``.
    raw: Any = None


class McpAgentProvider(abc.ABC):
    """Base class for direct-API providers (Gemini, OpenAI, …).

    Subclasses implement :meth:`_call_model` (one request to the vendor API,
    given the running message history and the MCP tool list) and translate
    their SDK's message objects to/from :class:`TurnResult`/history entries.
    """

    provider_id: ClassVar[str]

    def __init__(self) -> None:
        self._mcp_cm: Any = None
        self._session: ClientSession | None = None
        self._tools: list[ToolSpec] = []
        self._history: list[Any] = []
        self._system_prompt: str = ""
        self._cancelled = False

    # ------------------------------------------------------------- lifecycle
    async def start(self, spec: SessionSpec) -> None:
        self._system_prompt = spec.system_prompt
        self._mcp_cm = streamablehttp_client(
            spec.mcp_url,
            headers={"Authorization": f"Bearer {spec.mcp_token}"},
        )
        read, write, _ = await self._mcp_cm.__aenter__()
        self._session = ClientSession(read, write)
        await self._session.__aenter__()
        await self._session.initialize()
        listed = await self._session.list_tools()
        self._tools = [
            ToolSpec(name=tool.name, description=tool.description or "", input_schema=tool.inputSchema)
            for tool in listed.tools
        ]
        self._history = []

    async def close(self) -> None:
        session, self._session = self._session, None
        mcp_cm, self._mcp_cm = self._mcp_cm, None
        if session is not None:
            with contextlib.suppress(Exception):
                await session.__aexit__(None, None, None)
        if mcp_cm is not None:
            with contextlib.suppress(Exception):
                await mcp_cm.__aexit__(None, None, None)

    async def cancel(self) -> None:
        self._cancelled = True

    # ------------------------------------------------------------------ turn
    async def send(self, prompt: str) -> AsyncIterator[AgentEvent]:
        if self._session is None:
            raise RuntimeError("provider not started")
        self._cancelled = False
        self._append_user_message(prompt)

        for _ in range(MAX_TOOL_ROUNDS):
            if self._cancelled:
                yield AgentEvent("turn_done", {"stopReason": "cancelled"})
                return

            try:
                result = await self._call_model(self._history, self._tools, self._system_prompt)
            except Exception as exc:
                logger.exception("%s call failed", self.provider_id)
                yield AgentEvent("error", {"message": describe_vendor_error(exc)})
                yield AgentEvent("turn_done", {"stopReason": "error"})
                return

            if result.text:
                yield AgentEvent("text_delta", {"text": result.text})

            if not result.tool_calls:
                yield AgentEvent(
                    "turn_done",
                    {
                        "stopReason": result.stop_reason,
                        "costUsd": result.usage.get("costUsd"),
                        "durationMs": result.usage.get("durationMs"),
                    },
                )
                return

            self._append_assistant_turn(result)
            for call in result.tool_calls:
                if self._cancelled:
                    yield AgentEvent("turn_done", {"stopReason": "cancelled"})
                    return
                yield AgentEvent("tool_call", {"toolUseId": call.id, "tool": call.name, "args": call.arguments})
                ok, preview, raw = await self._run_tool(call)
                yield AgentEvent("tool_result", {"toolUseId": call.id, "ok": ok, "preview": preview})
                self._append_tool_result(call, raw, ok)

        yield AgentEvent(
            "error", {"message": f"stopped after {MAX_TOOL_ROUNDS} tool-call rounds without a final answer"}
        )
        yield AgentEvent("turn_done", {"stopReason": "error"})

    async def _run_tool(self, call: ToolCall) -> tuple[bool, str, Any]:
        assert self._session is not None
        try:
            result = await self._session.call_tool(call.name, call.arguments)
        except (McpError, OSError) as exc:  # MCP transport/tool error
            return False, str(exc)[:200], str(exc)
        text = "\n".join(block.text for block in result.content if hasattr(block, "text"))
        ok = not result.isError
        preview = text.strip().replace("\n", " ")[:200]
        return ok, preview, text

    # ------------------------------------------------------- vendor-specific
    @abc.abstractmethod
    async def _call_model(self, history: list[Any], tools: list[ToolSpec], system_prompt: str) -> TurnResult: ...

    @abc.abstractmethod
    def _append_user_message(self, prompt: str) -> None: ...

    @abc.abstractmethod
    def _append_assistant_turn(self, result: TurnResult) -> None: ...

    @abc.abstractmethod
    def _append_tool_result(self, call: ToolCall, raw: Any, ok: bool) -> None: ...


def describe_vendor_error(exc: Exception) -> str:
    """Turn a vendor SDK exception into one line a user can act on.

    Both SDKs stringify their errors as the raw API JSON — a quota message
    arrives as several hundred characters of nested dicts, which is not what
    belongs in a chat transcript.
    """
    message = _extract_api_message(exc) or str(exc)
    message = " ".join(message.split())

    lowered = message.lower()
    status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if status == 429 or "resource_exhausted" in lowered or "quota" in lowered:
        return f"The provider rejected the request for quota reasons: {message[:300]}"
    if status in {401, 403} or "api key" in lowered or "unauthenticated" in lowered:
        return f"The provider rejected the credentials: {message[:200]}"
    return message[:500]


def _extract_api_message(exc: Exception) -> str:
    """Pull ``error.message`` out of a vendor error payload, if there is one."""
    for attribute in ("message", "body", "response_json"):
        payload = getattr(exc, attribute, None)
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                return error["message"]
        elif isinstance(payload, str) and payload and attribute == "message":
            return payload
    return ""


# Keywords the Gemini function-declaration schema accepts. Gemini is the most
# restrictive of the vendors (its schema is an OpenAPI 3.0 subset and the API
# rejects unknown keys outright), so cleaning to this set produces one schema
# that every vendor accepts.
_SUPPORTED_KEYWORDS = frozenset(
    {
        "type",
        "format",
        "title",
        "description",
        "nullable",
        "enum",
        "items",
        "properties",
        "required",
        "anyOf",
        "default",
        "minimum",
        "maximum",
        "minItems",
        "maxItems",
        "minLength",
        "maxLength",
        "pattern",
    }
)


def json_schema_for_vendor(schema: dict[str, Any]) -> dict[str, Any]:
    """Convert an MCP tool's JSON Schema into one vendor chat APIs accept.

    MCP tool schemas are plain JSON Schema, generated here from Python type
    hints. Two things in them break Gemini, and both are nested rather than
    top-level, so this has to recurse:

    * ``additionalProperties`` (emitted for ``dict[str, Any]``) is not a field
      on Gemini's schema proto — the API replies
      ``Unknown name "additional_properties" … Cannot find field``.
    * ``{"type": "null"}``, emitted inside ``anyOf`` for optional arguments,
      has no counterpart in Gemini's type enum; the equivalent is dropping the
      null branch and setting ``nullable``.

    Anything else outside :data:`_SUPPORTED_KEYWORDS` is dropped rather than
    passed through, so a future schema-generator change cannot reintroduce the
    same class of failure.
    """
    if not isinstance(schema, dict):
        return schema

    cleaned: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in _SUPPORTED_KEYWORDS:
            continue
        if key == "properties" and isinstance(value, dict):
            cleaned[key] = {name: json_schema_for_vendor(sub) for name, sub in value.items()}
        elif key == "items":
            cleaned[key] = json_schema_for_vendor(value)
        elif key == "anyOf" and isinstance(value, list):
            cleaned[key] = [json_schema_for_vendor(sub) for sub in value]
        else:
            cleaned[key] = value

    return _collapse_nullable(cleaned)


def _collapse_nullable(schema: dict[str, Any]) -> dict[str, Any]:
    """Rewrite ``anyOf: [X, {"type": "null"}]`` as ``X`` plus ``nullable``."""
    branches = schema.get("anyOf")
    if not isinstance(branches, list):
        return schema

    concrete = [branch for branch in branches if branch.get("type") != "null"]
    if len(concrete) == len(branches):
        return schema

    collapsed = {key: value for key, value in schema.items() if key != "anyOf"}
    collapsed["nullable"] = True
    if len(concrete) == 1:
        # Single remaining branch: inline it, keeping this level's own
        # description/title rather than the branch's.
        collapsed = {**concrete[0], **collapsed}
    elif concrete:
        collapsed["anyOf"] = concrete
    return collapsed
