"""Google Gemini adapter.

Unlike Claude, there is no locally installed, already-authenticated Gemini
CLI this talks to — it calls the Gemini API directly with a user-supplied API
key (:func:`services.assistant.config.gemini_api_key`), driving the MCP tool
loop itself via :class:`~services.assistant.providers.mcp_agent.McpAgentProvider`.

Every symbol from ``google-genai`` is confined to this file.
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

from services.assistant.config import gemini_api_key, gemini_model
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


# Substrings that mark a Gemini model id as non-chat (image/tts/music/robotics/
# …). Gemini doesn't reliably populate ``supported_actions``, so this catches
# what that filter misses and keeps the picker to chat models.
_NON_CHAT = ("image", "tts", "audio", "robotics", "computer-use", "embedding", "lyria", "nano-banana", "veo", "imagen")


def list_models() -> list[str]:
    """Model ids this key can call for chat, straight from the vendor."""
    if not gemini_api_key():
        return []
    from google import genai

    client = genai.Client(api_key=gemini_api_key())
    names: list[str] = []
    for model in client.models.list():
        actions = getattr(model, "supported_actions", None)
        # Keep only chat-capable models; if the field is absent, don't guess.
        if actions and "generateContent" not in actions:
            continue
        name = (model.name or "").removeprefix("models/")
        if name and not any(bad in name for bad in _NON_CHAT):
            names.append(name)
    return sorted(set(names))


def detect() -> ProviderInfo:
    try:
        import google.genai  # noqa: F401
    except ImportError:
        return ProviderInfo(
            id="gemini",
            name="Gemini",
            available=False,
            note="install the assistant extra (google-genai) to use Gemini",
            configurable=True,
            takes_model=True,
            api_key_url="https://aistudio.google.com/app/apikey",
        )
    if (missing := require_mcp("gemini", "Gemini")) is not None:
        return missing
    if not gemini_api_key():
        return ProviderInfo(
            id="gemini",
            name="Gemini",
            available=False,
            note="set NETLAB_APP_GEMINI_API_KEY to use Gemini",
            configurable=True,
            takes_model=True,
            api_key_url="https://aistudio.google.com/app/apikey",
        )
    return ProviderInfo(
        id="gemini",
        name="Gemini",
        available=True,
        version=gemini_model(),
        configurable=True,
        takes_model=True,
        api_key_url="https://aistudio.google.com/app/apikey",
    )


class GeminiProvider(McpAgentProvider):
    provider_id: ClassVar[str] = "gemini"

    def __init__(self) -> None:
        super().__init__()
        from google import genai

        self._client = genai.Client(api_key=gemini_api_key())
        self._contents: list[Any] = []

    async def _call_model(self, history: list[Any], tools: list[ToolSpec], system_prompt: str) -> TurnResult:
        from google.genai import types

        function_declarations = [
            types.FunctionDeclaration(
                name=tool.name,
                description=tool.description,
                parameters=json_schema_for_vendor(tool.input_schema),
            )
            for tool in tools
        ]
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=[types.Tool(function_declarations=function_declarations)] if function_declarations else None,
        )
        response = await self._client.aio.models.generate_content(
            model=gemini_model(),
            contents=history,
            config=config,
        )

        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        candidate = response.candidates[0] if response.candidates else None
        parts = candidate.content.parts if candidate and candidate.content else []
        for i, part in enumerate(parts or []):
            if part.text:
                text_parts.append(part.text)
            elif part.function_call:
                tool_calls.append(
                    ToolCall(
                        id=f"{part.function_call.name}-{i}",
                        name=part.function_call.name,
                        arguments=dict(part.function_call.args or {}),
                    )
                )

        usage = {}
        if response.usage_metadata:
            usage = {
                "costUsd": None,
                "durationMs": None,
            }

        stop_reason = "end_turn"
        finish_reason = candidate.finish_reason if candidate else None
        if finish_reason and finish_reason.name not in {"STOP", "FINISH_REASON_UNSPECIFIED"}:
            stop_reason = finish_reason.name.lower()

        return TurnResult(
            text="".join(text_parts),
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage=usage,
            # Gemini 3 attaches a `thought_signature` to function-call parts and
            # rejects the next request if it doesn't come back, so the model's
            # own content is what gets replayed.
            raw=candidate.content if candidate else None,
        )

    def _append_user_message(self, prompt: str) -> None:
        from google.genai import types

        self._history.append(types.Content(role="user", parts=[types.Part(text=prompt)]))

    def _append_assistant_turn(self, result: TurnResult) -> None:
        from google.genai import types

        if result.raw is not None:
            # Replay the model's content verbatim — reconstructing the parts
            # would drop the thought_signature Gemini 3 requires back.
            self._history.append(result.raw)
            return

        parts = []
        if result.text:
            parts.append(types.Part(text=result.text))
        for call in result.tool_calls:
            parts.append(types.Part(function_call=types.FunctionCall(name=call.name, args=call.arguments)))
        self._history.append(types.Content(role="model", parts=parts))

    def _append_tool_result(self, call: ToolCall, raw: Any, ok: bool) -> None:
        from google.genai import types

        response = {"result": raw} if ok else {"error": raw}
        self._history.append(
            types.Content(
                role="user",
                parts=[types.Part(function_response=types.FunctionResponse(name=call.name, response=response))],
            )
        )
