"""Who deployed which lab, for multi-user installations.

netlab's own registry (``~/.netlab/status.yaml``) records *where* a lab runs,
not *who* started it. netlab-ui keeps that next to it, keyed by lab directory,
so every user sees the owner of a running lab; the entry is dropped when the
lab is shut down. Without authentication there is no user and nothing is
recorded.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_lock = threading.Lock()


def _registry() -> Path:
    raw = os.environ.get("NETLAB_UI_OWNERS_FILE", "~/.netlab/netlab-ui-owners.json")
    return Path(raw).expanduser()


def _load() -> dict[str, Any]:
    try:
        data = json.loads(_registry().read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _key(lab_dir: str | Path) -> str:
    return str(Path(lab_dir).expanduser().resolve())


def _save(data: dict[str, Any]) -> None:
    path = _registry()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def record(lab_dir: str | Path, user: str | None, expires_at: str | None = None) -> None:
    """Remember who deployed the lab in ``lab_dir`` (and, with a lease
    configured, when it expires — see services/lab_limits.py)."""
    if not user and not expires_at:
        return
    entry: dict[str, Any] = {"user": user, "since": datetime.now(UTC).isoformat(timespec="seconds")}
    if expires_at:
        entry["expiresAt"] = expires_at
    with _lock:
        data = _load()
        data[_key(lab_dir)] = entry
        _save(data)


def update(lab_dir: str | Path, **fields: Any) -> bool:
    """Change fields of a recorded lab; False when the lab isn't recorded."""
    with _lock:
        data = _load()
        entry = data.get(_key(lab_dir))
        if not isinstance(entry, dict):
            return False
        entry.update(fields)
        _save(data)
        return True


def entries() -> dict[str, Any]:
    return _load()


def forget(lab_dir: str | Path) -> None:
    with _lock:
        data = _load()
        if data.pop(_key(lab_dir), None) is not None:
            _save(data)


def annotate(status: Any) -> Any:
    """Add ``owner`` / ``ownerSince`` / ``expiresAt`` to every running lab of
    a ``netlab status --all`` dict whose directory is recorded."""
    if not isinstance(status, dict):
        return status
    data = _load()
    if not data:
        return status
    out: dict[str, Any] = {}
    for key, lab in status.items():
        entry = data.get(_key(lab["dir"])) if isinstance(lab, dict) and lab.get("dir") else None
        if entry:
            extra = {"owner": entry.get("user"), "ownerSince": entry.get("since"), "expiresAt": entry.get("expiresAt")}
            out[key] = {**lab, **{name: value for name, value in extra.items() if value}}
        else:
            out[key] = lab
    return out
