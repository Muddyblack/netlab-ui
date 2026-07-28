"""Provider registry.

Adding a provider is: write an adapter module with ``detect()`` and a class
implementing :class:`~services.assistant.providers.base.AgentProvider`, then add
one row here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from services.assistant.config import fake_provider_enabled
from services.assistant.providers import agy, claude, codex, fake, gemini, openai, openai_compat, openai_presets
from services.assistant.providers.base import AgentProvider, ProviderInfo

_Factory = Callable[[], Any]

_REGISTRY: dict[str, tuple[Callable[[], ProviderInfo], _Factory]] = {
    "claude": (claude.detect, claude.ClaudeProvider),
    "codex": (codex.detect, codex.CodexProvider),
    "agy": (agy.detect, agy.AgyProvider),
    "gemini": (gemini.detect, gemini.GeminiProvider),
    "openai": (openai.detect, openai.OpenAIProvider),
    "openai_compat": (openai_compat.detect, openai_compat.OpenAICompatProvider),
    # Grok, DeepSeek, Kimi, GLM — OpenAI-compatible vendors behind fixed URLs.
    **openai_presets.registry_rows(),
    "fake": (fake.detect, fake.FakeProvider),
}


def _visible(provider_id: str) -> bool:
    return provider_id != "fake" or fake_provider_enabled()


def detect_providers() -> list[ProviderInfo]:
    """Which agent CLIs this host can actually drive."""
    return [detect() for provider_id, (detect, _) in _REGISTRY.items() if _visible(provider_id)]


# Providers that can enumerate their own models. The direct-API ones
# enumerate live; agy shells out to its `models` subcommand.
_MODEL_LISTERS: dict[str, Callable[[], list[str]]] = {
    "gemini": gemini.list_models,
    "openai": openai.list_models,
    "openai_compat": openai_compat.list_models,
    "agy": agy.list_models,
    **openai_presets.model_listers(),
}


def list_models(provider_id: str) -> list[str]:
    """Model ids a provider advertises, or ``[]`` if it can't enumerate them."""
    lister = _MODEL_LISTERS.get(provider_id)
    return lister() if lister is not None else []


def create(provider_id: str) -> AgentProvider:
    entry = _REGISTRY.get(provider_id)
    if entry is None or not _visible(provider_id):
        raise KeyError(provider_id)
    detect, factory = entry
    info = detect()
    if not info.available:
        raise RuntimeError(info.note or f"{info.name} is not available on this host")
    return factory()


def register(provider_id: str, detect: Callable[[], ProviderInfo], factory: _Factory) -> None:
    """Test hook: install an extra provider for the duration of a test."""
    _REGISTRY[provider_id] = (detect, factory)
