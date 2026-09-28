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


def record(lab_dir: str | Path, user: str | None) -> None:
    if not user:
        return
    with _lock:
        data = _load()
        data[_key(lab_dir)] = {"user": user, "since": datetime.now(UTC).isoformat(timespec="seconds")}
        path = _registry()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))


def forget(lab_dir: str | Path) -> None:
    with _lock:
        data = _load()
        if data.pop(_key(lab_dir), None) is not None:
            _registry().write_text(json.dumps(data, indent=2))


def annotate(status: Any) -> Any:
    """Add ``owner`` / ``ownerSince`` to every running lab of a
    ``netlab status --all`` dict whose directory has a recorded owner."""
    if not isinstance(status, dict):
        return status
    data = _load()
    if not data:
        return status
    out: dict[str, Any] = {}
    for key, lab in status.items():
        entry = data.get(_key(lab["dir"])) if isinstance(lab, dict) and lab.get("dir") else None
        out[key] = {**lab, "owner": entry.get("user"), "ownerSince": entry.get("since")} if entry else lab
    return out
