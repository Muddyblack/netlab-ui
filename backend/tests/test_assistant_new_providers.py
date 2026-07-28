"""Codex and OpenAI-compatible provider adapters.

Both translate between a vendor shape and our neutral one against a surface no
unit test can reach live (a spawned ``codex`` CLI; a remote chat endpoint), so
these pin the translation the same way ``test_assistant_schema`` pins Gemini's.
"""

from __future__ import annotations

import importlib.util

from services.assistant.providers import agy, codex, list_models
from services.assistant.providers.mcp_agent import ToolCall, TurnResult
from services.assistant.providers.openai_compat import OpenAICompatProvider


def _kinds(events):
    return [event.type for event in events]


# --------------------------------------------------------------------- codex
def test_codex_agent_message_emits_text_only_on_completion():
    started = codex._translate({"type": "item.started", "item": {"type": "agent_message", "text": "partial"}})
    completed = codex._translate({"type": "item.completed", "item": {"type": "agent_message", "text": "the answer"}})
    assert started == []
    assert _kinds(completed) == ["text_delta"]
    assert completed[0].data == {"text": "the answer"}


def test_codex_mcp_tool_call_start_and_success():
    start = codex._translate(
        {
            "type": "item.started",
            "item": {
                "type": "mcp_tool_call",
                "id": "tc1",
                "server": "netlab",
                "tool": "get_topology_yaml",
                "arguments": {"x": 1},
            },
        }
    )
    assert _kinds(start) == ["tool_call"]
    assert start[0].data == {"toolUseId": "tc1", "tool": "get_topology_yaml", "args": {"x": 1}}

    done = codex._translate(
        {
            "type": "item.completed",
            "item": {
                "type": "mcp_tool_call",
                "id": "tc1",
                "status": "completed",
                "result": {"content": [{"type": "text", "text": "nodes: 3"}]},
            },
        }
    )
    assert _kinds(done) == ["tool_result"]
    assert done[0].data["ok"] is True
    assert done[0].data["preview"] == "nodes: 3"


def test_codex_mcp_tool_call_failure_surfaces_error_message():
    done = codex._translate(
        {
            "type": "item.completed",
            "item": {"type": "mcp_tool_call", "id": "tc2", "status": "failed", "error": {"message": "boom"}},
        }
    )
    assert done[0].type == "tool_result"
    assert done[0].data["ok"] is False
    assert done[0].data["preview"] == "boom"


def test_codex_tool_name_prefix_is_stripped():
    assert codex._short_name("mcp__netlab__add_node") == "add_node"
    assert codex._short_name("netlab__add_node") == "add_node"
    assert codex._short_name("add_node") == "add_node"


def test_codex_arguments_accept_json_string():
    start = codex._translate(
        {"type": "item.started", "item": {"type": "mcp_tool_call", "id": "t", "tool": "x", "arguments": '{"k": "v"}'}}
    )
    assert start[0].data["args"] == {"k": "v"}


def test_codex_turn_lifecycle():
    assert _kinds(codex._translate({"type": "turn.completed", "usage": {}})) == ["turn_done"]
    assert codex._translate({"type": "turn.completed", "usage": {}})[0].data["stopReason"] == "end_turn"

    failed = codex._translate({"type": "turn.failed", "error": {"message": "rate limited"}})
    assert _kinds(failed) == ["error", "turn_done"]
    assert failed[0].data["message"] == "rate limited"
    assert failed[1].data["stopReason"] == "error"


def test_codex_reasoning_and_unknown_items():
    assert _kinds(codex._translate({"type": "item.started", "item": {"type": "reasoning"}})) == ["thinking"]
    assert codex._translate({"type": "thread.started", "thread_id": "abc"}) == []
    assert codex._translate({"type": "item.completed", "item": {"type": "web_search", "query": "x"}}) == []


def test_codex_detect_reports_missing_cli(monkeypatch):
    monkeypatch.setattr(codex, "probe_cli", lambda *_a, **_k: None)
    info = codex.detect()
    assert info.id == "codex" and info.available is False and "codex" in (info.note or "")


def test_codex_detect_available_when_cli_present(monkeypatch):
    monkeypatch.setattr(codex, "probe_cli", lambda *_a, **_k: "codex-cli 0.144.1")
    info = codex.detect()
    assert info.available is True and info.version == "codex-cli 0.144.1"


def test_codex_first_turn_prepends_system_prompt_then_resumes():
    import asyncio

    from services.assistant.providers.base import SessionSpec

    provider = codex.CodexProvider()
    spec = SessionSpec(system_prompt="SYS", mcp_url="http://h/mcp", mcp_token="tok", cwd="/work")
    asyncio.run(provider.start(spec))

    first = provider._build_args("hello")
    assert first[0] == "exec" and "resume" not in first
    assert first[-1] == "SYS\n\nhello"
    assert 'mcp_servers.netlab.url="http://h/mcp"' in first
    assert 'mcp_servers.netlab.bearer_token_env_var="NETLAB_APP_ASSISTANT_MCP_BEARER"' in first

    provider._thread_id = "uuid-123"
    resumed = provider._build_args("again")
    assert resumed[:3] == ["exec", "resume", "uuid-123"]
    assert resumed[-1] == "again"  # no system prompt re-sent


# ------------------------------------------------------------- openai_compat
def _bare_provider() -> OpenAICompatProvider:
    """An instance without the SDK client — enough to exercise history shaping."""
    provider = OpenAICompatProvider.__new__(OpenAICompatProvider)
    provider._history = []
    return provider


def test_openai_compat_history_round_trip():
    provider = _bare_provider()
    provider._append_user_message("hi")
    provider._append_assistant_turn(
        TurnResult(text="on it", tool_calls=[ToolCall(id="c1", name="add_node", arguments={"name": "r1"})])
    )
    provider._append_tool_result(ToolCall(id="c1", name="add_node", arguments={}), "ok", True)

    assert provider._history[0] == {"role": "user", "content": "hi"}
    assistant = provider._history[1]
    assert assistant["role"] == "assistant" and assistant["content"] == "on it"
    assert assistant["tool_calls"][0]["id"] == "c1"
    assert assistant["tool_calls"][0]["function"]["name"] == "add_node"
    tool_msg = provider._history[2]
    assert tool_msg == {"role": "tool", "tool_call_id": "c1", "content": "ok"}


def test_openai_compat_tool_error_is_labelled():
    provider = _bare_provider()
    provider._append_tool_result(ToolCall(id="c1", name="x", arguments={}), "nope", False)
    assert provider._history[-1]["content"] == "Error: nope"


def test_openai_compat_detect_requires_base_url_and_model(monkeypatch):
    import services.assistant.providers.openai_compat as mod

    monkeypatch.setattr(mod, "openai_compat_base_url", lambda: "")
    monkeypatch.setattr(mod, "openai_compat_model", lambda: "")
    info = mod.detect()
    assert info.id == "openai_compat" and info.available is False
    # The note only reaches the base-URL/model hint when the SDK is importable.
    if importlib.util.find_spec("openai") is not None:
        assert "base URL" in (info.note or "")


def test_openai_compat_detect_available_when_configured(monkeypatch):
    import services.assistant.providers.openai_compat as mod

    if importlib.util.find_spec("openai") is None:
        return  # SDK absent in this env; availability can't be reached
    monkeypatch.setattr(mod, "openai_compat_base_url", lambda: "http://localhost:11434/v1")
    monkeypatch.setattr(mod, "openai_compat_model", lambda: "llama3.1")
    info = mod.detect()
    assert info.available is True and info.version == "llama3.1"


# ------------------------------------------------- openai_compat vendor presets
def _use_settings(monkeypatch, stored):
    """Point the assistant settings store at an in-memory dict for the test."""
    import services.assistant.settings as settings

    monkeypatch.setattr(settings, "get", lambda pid: stored.get(pid, {}))


def test_presets_are_registered_and_configurable():
    if importlib.util.find_spec("mcp") is None:
        return
    from app.assistant.router import _CONFIGURABLE_PROVIDERS
    from services.assistant.providers import _MODEL_LISTERS, _REGISTRY
    from services.assistant.providers.openai_presets import PRESET_IDS

    assert set(PRESET_IDS) == {"grok", "deepseek", "kimi", "glm"}
    for pid in PRESET_IDS:
        assert pid in _REGISTRY
        assert pid in _MODEL_LISTERS
        assert pid in _CONFIGURABLE_PROVIDERS


def test_preset_detect_reports_missing_key(monkeypatch):
    from services.assistant.providers.openai_presets import _BUILT

    if importlib.util.find_spec("openai") is None:
        return  # SDK absent; the note stops at the import hint
    _use_settings(monkeypatch, {})
    detect = _BUILT["grok"][0]
    info = detect()
    assert info.id == "grok" and info.name == "Grok (xAI)" and info.available is False
    assert "API key" in (info.note or "")


def test_preset_detect_available_with_key_defaults_model(monkeypatch):
    from services.assistant.providers.openai_presets import _BUILT

    if importlib.util.find_spec("openai") is None:
        return
    _use_settings(monkeypatch, {"deepseek": {"apiKey": "sk-x"}})
    info = _BUILT["deepseek"][0]()
    # No model override → the baked-in default is what's advertised.
    assert info.available is True and info.version == "deepseek-chat"

    _use_settings(monkeypatch, {"deepseek": {"apiKey": "sk-x", "model": "deepseek-reasoner"}})
    assert _BUILT["deepseek"][0]().version == "deepseek-reasoner"


def test_preset_list_models_short_circuits_without_key(monkeypatch):
    from services.assistant.providers.openai_presets import _BUILT

    _use_settings(monkeypatch, {})
    # No key → no network call, empty list (picker falls back to free-form).
    assert _BUILT["kimi"][1]() == []


def test_preset_provider_pins_base_url_and_reads_own_slot(monkeypatch):
    from services.assistant.providers.openai_presets import _BUILT

    _use_settings(monkeypatch, {"glm": {"apiKey": "sk-z", "model": "glm-4.5"}})
    provider = _BUILT["glm"][2].__new__(_BUILT["glm"][2])  # no SDK client needed
    assert provider.provider_id == "glm"
    assert provider._base_url() == "https://api.z.ai/api/paas/v4"
    assert provider._api_key() == "sk-z"
    assert provider._model() == "glm-4.5"


# --------------------------------------------------------------- list_models
def test_list_models_empty_for_cli_and_unknown_providers():
    # Codex and Claude Code have no dynamic models command; fake/unknown return [].
    assert list_models("codex") == []
    assert list_models("claude") == []
    assert list_models("fake") == []
    assert list_models("nope") == []


def test_agy_list_models_parses_cli_output(monkeypatch):
    from services.assistant.providers import agy as agy_provider

    class FakeResult:
        returncode = 0
        stdout = "Gemini 3.6 Flash (High)\n\nClaude Sonnet 4.6 (Thinking)\n"

    monkeypatch.setattr(agy_provider.subprocess, "run", lambda *_args, **_kwargs: FakeResult())
    assert agy_provider.list_models() == ["Gemini 3.6 Flash (High)", "Claude Sonnet 4.6 (Thinking)"]


def test_agy_list_models_empty_when_cli_missing(monkeypatch):
    from services.assistant.providers import agy as agy_provider

    def _raise(*a, **k):
        raise FileNotFoundError

    monkeypatch.setattr(agy_provider.subprocess, "run", _raise)
    assert agy_provider.list_models() == []


def test_list_models_short_circuits_without_config(monkeypatch):
    import services.assistant.providers.gemini as gem
    import services.assistant.providers.openai_compat as compat

    # Unconfigured providers must not attempt a network call — they return [].
    monkeypatch.setattr(gem, "gemini_api_key", lambda: "")
    monkeypatch.setattr(compat, "openai_compat_base_url", lambda: "")
    assert gem.list_models() == []
    assert compat.list_models() == []


# ------------------------------------------------------------------ agy
def test_agy_detect_reports_missing_cli(monkeypatch):
    monkeypatch.setattr(agy, "probe_cli", lambda *_a, **_k: None)
    info = agy.detect()
    assert info.id == "agy" and info.available is False and "agy" in (info.note or "")


def test_agy_detect_available_when_cli_present(monkeypatch):
    monkeypatch.setattr(agy, "probe_cli", lambda *_a, **_k: "agy-cli 1.1.4")
    info = agy.detect()
    assert info.available is True and info.version == "agy-cli 1.1.4"


def test_agy_args_building(monkeypatch):
    from services.assistant.providers.base import SessionSpec

    provider = agy.AgyProvider()
    spec = SessionSpec(system_prompt="SYS", mcp_url="http://h/mcp", mcp_token="tok", cwd="/work")

    # Mock start and set spec
    provider._spec = spec

    first = provider._build_args("hello")
    assert "--output-format" in first
    assert "json" in first
    assert "--dangerously-skip-permissions" in first
    assert first[-1] == "SYS\n\nhello"

    provider._conversation_id = "conv-123"
    second = provider._build_args("hello")
    assert "--conversation" in second
    assert "conv-123" in second
    assert second[-1] == "hello"
