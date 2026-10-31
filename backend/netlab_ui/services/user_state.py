"""Small per-user UI state that should follow the login, not the browser.

Pinned and recent labs and exercise progress used to live in the browser's
localStorage, so a second machine (or a cleared profile) started empty. They
are kept next to netlab's own registry instead, keyed by the authenticated
user; without authentication everything belongs to one shared anonymous user.

Only the keys in :data:`_VALIDATORS` are accepted, each with a size cap, so the
endpoint cannot be used as general storage. Per-browser display preferences
(theme, panel sizes, ...) deliberately stay in the browser.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

_lock = threading.Lock()
ANONYMOUS = ""

_MAX_ITEMS = 200
_MAX_TEXT = 512
_MAX_TOURS = 200


def _string_list(limit: int) -> Callable[[Any], list[str]]:
    def check(value: Any) -> list[str]:
        if not isinstance(value, list) or len(value) > limit:
            raise ValueError(f"expected a list of at most {limit} strings")
        if not all(isinstance(item, str) and len(item) <= _MAX_TEXT for item in value):
            raise ValueError("list items must be short strings")
        return list(dict.fromkeys(value))

    return check


def _progress(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict) or len(value) > _MAX_TOURS:
        raise ValueError("expected a mapping of tour to passed step ids")
    check = _string_list(_MAX_ITEMS)
    result: dict[str, list[str]] = {}
    for tour, steps in value.items():
        if not isinstance(tour, str) or len(tour) > _MAX_TEXT:
            raise ValueError("tour keys must be short strings")
        result[tour] = check(steps)
    return result


_VALIDATORS: dict[str, Callable[[Any], Any]] = {
    "pinnedLabs": _string_list(_MAX_ITEMS),
    "recentLabs": _string_list(12),
    "exerciseProgress": _progress,
}


def _file() -> Path:
    raw = os.environ.get("NETLAB_UI_USER_STATE_FILE", "~/.netlab/netlab-ui-user-state.json")
    return Path(raw).expanduser()


def _load() -> dict[str, Any]:
    try:
        data = json.loads(_file().read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data: dict[str, Any]) -> None:
    path = _file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def get_all(user: str | None) -> dict[str, Any]:
    with _lock:
        mine = _load().get(user or ANONYMOUS)
    if not isinstance(mine, dict):
        return {}
    return {key: mine[key] for key in _VALIDATORS if key in mine}


def put(user: str | None, key: str, value: Any) -> Any:
    """Store ``value`` under ``key`` for ``user``; raises KeyError for an
    unknown key and ValueError for a value that fails its validator."""
    clean = _VALIDATORS[key](value)
    with _lock:
        data = _load()
        mine = data.get(user or ANONYMOUS)
        if not isinstance(mine, dict):
            mine = data[user or ANONYMOUS] = {}
        mine[key] = clean
        _save(data)
    return clean
