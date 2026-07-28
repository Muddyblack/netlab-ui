"""OpenAI-compatible adapter (Ollama, OpenRouter, LM Studio, vLLM, Groq, …).

A large family of providers — local runtimes and hosted gateways alike — expose
the OpenAI **Chat Completions** API. This one adapter drives all of them: it
reuses the OpenAI SDK client pointed at a user-supplied ``base_url`` and calls
``chat.completions.create``. That is the only real difference from :mod:`.openai`,
which targets a single vendor through the newer Responses API — the wire shapes
are different enough (and the Responses API's opaque reasoning state absent here)
that they are separate files rather than one parametrised provider.

Like Gemini and ChatGPT, there is no local CLI: netlab-ui owns the MCP tool
loop via :class:`~services.assistant.providers.mcp_agent.McpAgentProvider`. Every
symbol from the ``openai`` SDK is confined to this file.
"""

from __future__ import annotations

import json
import logging
from typing import Any, ClassVar

from services.assistant.config import (
    openai_compat_api_key,
    openai_compat_base_url,
    openai_compat_model,
)
from services.assistant.providers.base import ProviderInfo
from services.assistant.providers.mcp_agent import (
    McpAgentProvider,
    ToolCall,
    ToolSpec,
    TurnResult,
    json_schema_for_vendor,
    require_mcp,
)

logger = logging.getLogger(__name__)


def list_models() -> list[str]:
    """Model ids the configured endpoint advertises at ``/v1/models``.

    Local runtimes (Ollama, LM Studio) and gateways (OpenRouter, vLLM) all serve
    this, so it reflects exactly what that endpoint can run — no hardcoded list.
    """
    if not openai_compat_base_url():
        return []
    from openai import OpenAI

    client = OpenAI(
        base_url=openai_compat_base_url(),
        api_key=openai_compat_api_key() or "sk-no-key-required",
        timeout=10,
    )
    return sorted(model.id for model in client.models.list().data)


def detect() -> ProviderInfo:
    try:
        import openai  # noqa: F401
    except ImportError:
        return ProviderInfo(
            id="openai_compat",
            name="OpenAI-compatible",
            available=False,
            note="install the assistant extra (openai) to use OpenAI-compatible providers",
            configurable=True,
            takes_model=True,
            api_key_url="https://openrouter.ai/keys",
        )
    if (mcp_missing := require_mcp("openai_compat", "OpenAI-compatible")) is not None:
        return mcp_missing
    # The base URL is what makes this provider concrete; the API key is optional
    # (local runtimes like Ollama ignore it) so it is not required for
    # availability. A model must be named — these endpoints have no single
    # default the way the hosted vendors do.
    missing: list[str] = []
    if not openai_compat_base_url():
        missing.append(
            "a base URL (e.g. http://localhost:11434/v1 for Ollama, https://openrouter.ai/api/v1 for OpenRouter)"
        )
    if not openai_compat_model():
        missing.append("a model name")
    if missing:
        return ProviderInfo(
            id="openai_compat",
            name="OpenAI-compatible",
            available=False,
            note="set " + " and ".join(missing) + " in AI provider settings",
            configurable=True,
            takes_model=True,
            api_key_url="https://openrouter.ai/keys",
        )
    return ProviderInfo(
        id="openai_compat",
        name="OpenAI-compatible",
        available=True,
        version=openai_compat_model(),
        configurable=True,
        takes_model=True,
        api_key_url="https://openrouter.ai/keys",
    )


class OpenAICompatProvider(McpAgentProvider):
    provider_id: ClassVar[str] = "openai_compat"

    # Config source, overridable by the fixed-endpoint presets (Grok, DeepSeek,
    # Kimi, GLM) in ``openai_presets``. The base provider reads the generic
    # openai_compat settings — a user-supplied base URL and optional key; a
    # preset pins its own vendor base URL and reads its own settings slot.
    def _base_url(self) -> str:
        return openai_compat_base_url()

    def _api_key(self) -> str:
        return openai_compat_api_key()

    def _model(self) -> str:
        return openai_compat_model()

    def __init__(self) -> None:
        super().__init__()
        from openai import AsyncOpenAI

        # Local servers require *some* key to satisfy the client even though
        # they ignore it; a hosted gateway supplies a real one.
        self._client = AsyncOpenAI(
            base_url=self._base_url(),
            api_key=self._api_key() or "sk-no-key-required",
        )

    async def _call_model(self, history: list[Any], tools: list[ToolSpec], system_prompt: str) -> TurnResult:
        tool_defs = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": json_schema_for_vendor(tool.input_schema),
                },
            }
            for tool in tools
        ]
        messages = [{"role": "system", "content": system_prompt}, *history]
        response = await self._client.chat.completions.create(
            model=self._model(),
            messages=messages,
            tools=tool_defs or None,
        )

        choice = response.choices[0]
        message = choice.message
        tool_calls: list[ToolCall] = []
        for i, call in enumerate(message.tool_calls or []):
            # Some local servers omit the tool-call id; synthesise a stable one
            # so the assistant turn and its tool result can be matched up.
            call_id = call.id or f"call_{i}"
            tool_calls.append(
                ToolCall(
                    id=call_id,
                    name=call.function.name,
                    arguments=_loads(call.function.arguments),
                )
            )

        stop_reason = "max_tokens" if choice.finish_reason == "length" else "end_turn"
        return TurnResult(
            text=message.content or "",
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage={"costUsd": None, "durationMs": None},
        )

    def _append_user_message(self, prompt: str) -> None:
        self._history.append({"role": "user", "content": prompt})

    def _append_assistant_turn(self, result: TurnResult) -> None:
        # Plain Chat Completions carries no opaque state to echo back, so the
        # neutral fields are enough to reconstruct the assistant message.
        message: dict[str, Any] = {"role": "assistant", "content": result.text or None}
        if result.tool_calls:
            message["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                }
                for call in result.tool_calls
            ]
        self._history.append(message)

    def _append_tool_result(self, call: ToolCall, raw: Any, ok: bool) -> None:
        output = raw if ok else f"Error: {raw}"
        self._history.append(
            {
                "role": "tool",
                "tool_call_id": call.id,
                "content": output if isinstance(output, str) else json.dumps(output),
            }
        )


def _loads(arguments: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
