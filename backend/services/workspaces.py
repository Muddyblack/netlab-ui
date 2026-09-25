"""Persistent workspace-path registry.

Workspace paths are stored in a JSON file (``~/.netlab_gui_workspaces.json``
by default; override via ``NETLAB_WORKSPACE_CONFIG`` env var). The file is
created on first write. Before it exists the default workspace
(``NETLAB_WORKSPACE``, defaulting to ``~/labs``) is returned as the sole entry.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def _config_path() -> Path:
    raw = os.environ.get("NETLAB_WORKSPACE_CONFIG", "~/.netlab_gui_workspaces.json")
    return Path(raw).expanduser()


def _default() -> str:
    raw = os.environ.get("NETLAB_WORKSPACE", "~/labs")
    return str(Path(raw).expanduser().resolve())


def shared() -> str | None:
    """The shared workspace (``NETLAB_UI_SHARED_WORKSPACE``): a folder every
    user of a multi-user installation works in. Always listed, never removed."""
    raw = os.environ.get("NETLAB_UI_SHARED_WORKSPACE", "").strip()
    return str(Path(raw).expanduser().resolve()) if raw else None


def _with_shared(paths: list[str]) -> list[str]:
    common = shared()
    return paths if not common or common in paths else [*paths, common]


def load() -> list[str]:
    """Return the list of configured workspace paths (always at least one)."""
    p = _config_path()
    if not p.exists():
        return _with_shared([_default()])
    try:
        data = json.loads(p.read_text())
        paths = [str(Path(ws).expanduser().resolve()) for ws in (data.get("workspaces") or [])]
        return _with_shared(paths if paths else [_default()])
    except (AttributeError, json.JSONDecodeError, OSError, TypeError):
        return _with_shared([_default()])


def save(workspaces: list[str]) -> None:
    p = _config_path()
    p.write_text(json.dumps({"workspaces": workspaces}, indent=2))


def add(path: str) -> list[str]:
    resolved = str(Path(path).expanduser().resolve())
    current = load()
    if resolved not in current:
        current.append(resolved)
        save(current)
    return current


def remove(path: str) -> list[str]:
    resolved = str(Path(path).expanduser().resolve())
    current = load()
    if resolved == shared():
        return current  # the shared workspace is configured by the operator
    updated = [w for w in current if w != resolved]
    if not updated:
        return current  # refuse to remove last workspace
    save(updated)
    return updated
