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


def load() -> list[str]:
    """Return the list of configured workspace paths (always at least one)."""
    p = _config_path()
    if not p.exists():
        return [_default()]
    try:
        data = json.loads(p.read_text())
        paths = [str(Path(ws).expanduser().resolve()) for ws in (data.get("workspaces") or [])]
        return paths if paths else [_default()]
    except (AttributeError, json.JSONDecodeError, OSError, TypeError):
        return [_default()]


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
    updated = [w for w in current if w != resolved]
    if not updated:
        return current  # refuse to remove last workspace
    save(updated)
    return updated
