"""OpenAI (ChatGPT) adapter.

Like :mod:`.gemini`, there is no locally installed CLI here — it calls the
OpenAI Responses API directly with a user-supplied API key
(:func:`services.assistant.config.openai_api_key`), driving the MCP tool loop
itself via :class:`~services.assistant.providers.mcp_agent.McpAgentProvider`.

Every symbol from the ``openai`` SDK is confined to this file.
"""

from __future__ import annotations

import json
import logging
from typing import Any, ClassVar

from services.assistant.config import openai_api_key, openai_model
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


# Substrings that mark an OpenAI model id as non-chat (embeddings, audio,
# images, moderation, …); dropped so the picker shows only usable models.
_NON_CHAT = ("embedding", "whisper", "tts", "dall-e", "moderation", "audio", "image", "realtime", "transcribe")


def list_models() -> list[str]:
    """Chat-capable model ids for this key, straight from the vendor."""
    if not openai_api_key():
        return []
    from openai import OpenAI

    client = OpenAI(api_key=openai_api_key(), timeout=10)
    ids = [model.id for model in client.models.list().data]
    return sorted(mid for mid in ids if not any(bad in mid for bad in _NON_CHAT))


def detect() -> ProviderInfo:
    try:
        import openai  # noqa: F401
    except ImportError:
        return ProviderInfo(
            id="openai",
            name="ChatGPT",
            available=False,
            note="install the assistant extra (openai) to use ChatGPT",
            configurable=True,
            takes_model=True,
            api_key_url="https://platform.openai.com/api-keys",
        )
    if (missing := require_mcp("openai", "ChatGPT")) is not None:
        return missing
    if not openai_api_key():
        return ProviderInfo(
            id="openai",
            name="ChatGPT",
            available=False,
            note="set NETLAB_APP_OPENAI_API_KEY to use ChatGPT",
            configurable=True,
            takes_model=True,
            api_key_url="https://platform.openai.com/api-keys",
        )
    return ProviderInfo(
        id="openai",
        name="ChatGPT",
        available=True,
        version=openai_model(),
        configurable=True,
        takes_model=True,
        api_key_url="https://platform.openai.com/api-keys",
    )


class OpenAIProvider(McpAgentProvider):
    provider_id: ClassVar[str] = "openai"

    def __init__(self) -> None:
        super().__init__()
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(api_key=openai_api_key())

    async def _call_model(self, history: list[Any], tools: list[ToolSpec], system_prompt: str) -> TurnResult:
        tool_defs = [
            {
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": json_schema_for_vendor(tool.input_schema),
            }
            for tool in tools
        ]
        response = await self._client.responses.create(
            model=openai_model(),
            instructions=system_prompt,
            input=history,
            tools=tool_defs or None,
        )

        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for item in response.output:
            if item.type == "message":
                for block in item.content:
                    if block.type == "output_text":
                        text_parts.append(block.text)
            elif item.type == "function_call":
                tool_calls.append(
                    ToolCall(
                        id=item.call_id,
                        name=item.name,
                        arguments=json.loads(item.arguments or "{}"),
                    )
                )

        stop_reason = "end_turn"
        status = getattr(response, "status", None)
        if status == "incomplete":
            stop_reason = "max_tokens"

        usage = {"costUsd": None, "durationMs": None}
        return TurnResult(
            text="".join(text_parts),
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage=usage,
            # Reasoning models emit `reasoning` items alongside the visible
            # output; the Responses API expects the whole output list back on
            # the next request, so keep it rather than rebuilding it.
            raw=list(response.output),
        )

    def _append_user_message(self, prompt: str) -> None:
        self._history.append({"role": "user", "content": prompt})

    def _append_assistant_turn(self, result: TurnResult) -> None:
        if result.raw:
            # Echo every output item (messages, function calls, reasoning) so
            # the model keeps its own chain of thought across tool rounds.
            self._history.extend(result.raw)
            return

        if result.text:
            self._history.append({"role": "assistant", "content": result.text})
        for call in result.tool_calls:
            self._history.append(
                {
                    "type": "function_call",
                    "call_id": call.id,
                    "name": call.name,
                    "arguments": json.dumps(call.arguments),
                }
            )

    def _append_tool_result(self, call: ToolCall, raw: Any, ok: bool) -> None:
        output = raw if ok else f"Error: {raw}"
        self._history.append(
            {
                "type": "function_call_output",
                "call_id": call.id,
                "output": output if isinstance(output, str) else json.dumps(output),
            }
        )
