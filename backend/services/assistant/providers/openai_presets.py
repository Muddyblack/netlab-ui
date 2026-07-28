"""First-class OpenAI-compatible vendors: Grok, DeepSeek, Kimi, GLM.

Each speaks the OpenAI **Chat Completions** wire protocol at a fixed base URL,
so they reuse :class:`~services.assistant.providers.openai_compat.OpenAICompatProvider`
verbatim — the only per-vendor differences are the base URL, the display name,
the default model, and which settings slot the API key lives in. Where the
generic ``openai_compat`` provider asks the user for a base URL, these present
as named providers you just paste a key into (like Gemini and OpenAI).

Config for each lives under its own provider id in
:mod:`services.assistant.settings`: an ``apiKey`` and an optional ``model``
override, with ``NETLAB_APP_<ID>_API_KEY`` / ``NETLAB_APP_<ID>_MODEL`` env
escape hatches (see that module's ``_ENV_OVERRIDES``).

Adding another OpenAI-compatible vendor is one row in :data:`PRESETS` — the
registry, model listing, settings, and UI pick it up from there.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import ClassVar

from services.assistant.providers.base import AgentProvider, ProviderInfo
from services.assistant.providers.mcp_agent import require_mcp
from services.assistant.providers.openai_compat import OpenAICompatProvider


@dataclass(frozen=True)
class Preset:
    id: str
    name: str
    base_url: str
    default_model: str
    console: str  # where to get an API key, surfaced in the "not configured" note
    api_key_url: str


PRESETS: tuple[Preset, ...] = (
    Preset("grok", "Grok (xAI)", "https://api.x.ai/v1", "grok-4", "console.x.ai", "https://console.x.ai/"),
    Preset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat", "platform.deepseek.com", "https://platform.deepseek.com/api_keys"),
    Preset("kimi", "Kimi (Moonshot)", "https://api.moonshot.ai/v1", "kimi-k2-0905-preview", "platform.moonshot.ai", "https://platform.moonshot.cn/console/api-keys"),
    Preset("glm", "GLM (Z.ai)", "https://api.z.ai/api/paas/v4", "glm-4.6", "z.ai/manage-apikey", "https://z.ai/manage-apikey"),
)

PRESET_IDS: frozenset[str] = frozenset(preset.id for preset in PRESETS)


def _key_for(preset: Preset) -> str:
    from services.assistant import settings

    return settings.get(preset.id).get("apiKey", "")


def _model_for(preset: Preset) -> str:
    from services.assistant import settings

    return settings.get(preset.id).get("model") or preset.default_model


def _make_detect(preset: Preset) -> Callable[[], ProviderInfo]:
    def detect() -> ProviderInfo:
        try:
            import openai  # noqa: F401
        except ImportError:
            return ProviderInfo(
                id=preset.id,
                name=preset.name,
                available=False,
                note=f"install the assistant extra (openai) to use {preset.name}",
                configurable=True,
                takes_model=True,
                api_key_url=preset.api_key_url,
            )
        if (missing := require_mcp(preset.id, preset.name)) is not None:
            return missing
        # Hosted vendors always need a key (unlike local openai_compat runtimes),
        # so that is what makes the provider concrete. A model is always present
        # via the baked-in default.
        if not _key_for(preset):
            return ProviderInfo(
                id=preset.id,
                name=preset.name,
                available=False,
                note=f"add your {preset.name} API key (from {preset.console}) in AI provider settings",
                configurable=True,
                takes_model=True,
                api_key_url=preset.api_key_url,
            )
        return ProviderInfo(
            id=preset.id,
            name=preset.name,
            available=True,
            version=_model_for(preset),
            configurable=True,
            takes_model=True,
            api_key_url=preset.api_key_url,
        )

    return detect


def _make_list_models(preset: Preset) -> Callable[[], list[str]]:
    def list_models() -> list[str]:
        """Model ids this key can call, straight from the vendor's ``/models``.

        Best-effort: an unset key or an endpoint that doesn't serve ``/models``
        just yields ``[]`` and the picker falls back to the free-form field.
        """
        key = _key_for(preset)
        if not key:
            return []
        from openai import OpenAI

        client = OpenAI(base_url=preset.base_url, api_key=key, timeout=10)
        return sorted(model.id for model in client.models.list().data)

    return list_models


def _make_provider(preset: Preset) -> type[OpenAICompatProvider]:
    class PresetProvider(OpenAICompatProvider):
        provider_id: ClassVar[str] = preset.id

        def _base_url(self) -> str:
            return preset.base_url

        def _api_key(self) -> str:
            return _key_for(preset)

        def _model(self) -> str:
            return _model_for(preset)

    PresetProvider.__name__ = PresetProvider.__qualname__ = f"{preset.id.title()}Provider"
    return PresetProvider


# Built once at import: id -> (detect, list_models, provider factory), ready for
# the registry and model-lister maps in ``providers/__init__``.
_BUILT: dict[str, tuple[Callable[[], ProviderInfo], Callable[[], list[str]], type[OpenAICompatProvider]]] = {
    preset.id: (_make_detect(preset), _make_list_models(preset), _make_provider(preset)) for preset in PRESETS
}


def registry_rows() -> dict[str, tuple[Callable[[], ProviderInfo], Callable[[], AgentProvider]]]:
    return {pid: (detect, provider) for pid, (detect, _list, provider) in _BUILT.items()}


def model_listers() -> dict[str, Callable[[], list[str]]]:
    return {pid: list_models for pid, (_detect, list_models, _provider) in _BUILT.items()}
