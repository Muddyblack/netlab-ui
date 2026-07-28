"""Persistent assistant provider settings (API keys, model overrides).

Stored in a JSON file (``~/.netlab_gui_assistant.json`` by default; override
via ``NETLAB_APP_ASSISTANT_CONFIG``) written with ``0600`` permissions, since
it holds API keys. Follows the same on-disk convention as
:mod:`services.workspaces`.

Env vars (``NETLAB_APP_GEMINI_API_KEY``, …) still work and take precedence —
they are the escape hatch for anyone who would rather not have a key on disk
at all — but the values set here are what the UI's provider settings dialog
reads and writes.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import TypedDict

_ENV_OVERRIDES = {
    "gemini": {"apiKey": "NETLAB_APP_GEMINI_API_KEY", "model": "NETLAB_APP_GEMINI_MODEL"},
    "openai": {"apiKey": "NETLAB_APP_OPENAI_API_KEY", "model": "NETLAB_APP_OPENAI_MODEL"},
    "openai_compat": {
        "apiKey": "NETLAB_APP_OPENAI_COMPAT_API_KEY",
        "model": "NETLAB_APP_OPENAI_COMPAT_MODEL",
        "baseUrl": "NETLAB_APP_OPENAI_COMPAT_BASE_URL",
    },
}

# OpenAI-compatible vendor presets (Grok, DeepSeek, Kimi, GLM in
# ``providers.openai_presets``) each store an apiKey + optional model override
# under their own id, with matching ``NETLAB_APP_<ID>_*`` env escape hatches.
# Their base URL is fixed in code, so — unlike ``openai_compat`` — there is none
# to override here.
for _pid in ("grok", "deepseek", "kimi", "glm"):
    _ENV_OVERRIDES[_pid] = {
        "apiKey": f"NETLAB_APP_{_pid.upper()}_API_KEY",
        "model": f"NETLAB_APP_{_pid.upper()}_MODEL",
    }

# CLI agents (Claude Code, Codex, agy) authenticate themselves and have no key
# stored here, but their model override follows the same env escape hatch.
for _pid in ("claude", "codex", "agy"):
    _ENV_OVERRIDES[_pid] = {"model": f"NETLAB_APP_{_pid.upper()}_MODEL"}


class ProviderSettings(TypedDict, total=False):
    apiKey: str
    model: str
    baseUrl: str


def _config_path() -> Path:
    raw = os.environ.get("NETLAB_APP_ASSISTANT_CONFIG", "~/.netlab_gui_assistant.json")
    return Path(raw).expanduser()


def _load_stored() -> dict[str, ProviderSettings]:
    p = _config_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        providers = data.get("providers") or {}
        return {k: v for k, v in providers.items() if isinstance(v, dict)}
    except (AttributeError, json.JSONDecodeError, OSError, TypeError):
        return {}


def _save_stored(providers: dict[str, ProviderSettings]) -> None:
    p = _config_path()
    p.write_text(json.dumps({"providers": providers}, indent=2))
    p.chmod(stat.S_IRUSR | stat.S_IWUSR)


def get(provider_id: str) -> ProviderSettings:
    """Effective settings for a provider: env vars win over the stored file."""
    stored = dict(_load_stored().get(provider_id, {}))
    for field, env_var in _ENV_OVERRIDES.get(provider_id, {}).items():
        value = os.environ.get(env_var, "").strip()
        if value:
            stored[field] = value
    return stored


def set(provider_id: str, values: ProviderSettings) -> ProviderSettings:
    """Persist settings for a provider to disk, merging with what's there."""
    providers = _load_stored()
    current = dict(providers.get(provider_id, {}))
    for key, value in values.items():
        if value:
            current[key] = value
        else:
            current.pop(key, None)
    providers[provider_id] = current
    _save_stored(providers)
    return get(provider_id)


def clear(provider_id: str) -> None:
    providers = _load_stored()
    if providers.pop(provider_id, None) is not None:
        _save_stored(providers)


def env_locked(provider_id: str) -> list[str]:
    """Fields for this provider that an env var is currently overriding."""
    return [
        field for field, env_var in _ENV_OVERRIDES.get(provider_id, {}).items() if os.environ.get(env_var, "").strip()
    ]
