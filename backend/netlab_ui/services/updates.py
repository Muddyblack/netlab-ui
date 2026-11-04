"""Is a newer netlab-ui release out? Asks PyPI at most once every few hours.

The answer feeds a dismissible notice in the UI. Only plain release versions (``0.0.3``, ``v0.0.3``) are compared:
a source checkout, a ``git describe`` string or a pre-release has nothing sensible to compare, so it never nags.
``NETLAB_UI_UPDATE_CHECK=off`` stops the lookup altogether (nothing is sent anywhere).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request

PACKAGE = "netlab-ui"
PYPI_URL = f"https://pypi.org/pypi/{PACKAGE}/json"
RELEASES_URL = "https://github.com/Muddyblack/netlab-ui/releases"
_TTL = 6 * 3600.0  # a successful lookup
_RETRY = 15 * 60.0  # after PyPI could not be reached
_VERSION = re.compile(r"v?(\d+(?:\.\d+)*)")

_cache: tuple[float, str | None] | None = None


def enabled() -> bool:
    return os.environ.get("NETLAB_UI_UPDATE_CHECK", "on").strip().lower() not in {"off", "0", "false", "no"}


def parse(version: str | None) -> tuple[int, ...] | None:
    """``(0, 0, 3)`` for ``0.0.3`` or ``v0.0.3``; None for anything that is not a plain release."""
    match = _VERSION.fullmatch((version or "").strip())
    return tuple(int(part) for part in match.group(1).split(".")) if match else None


def is_newer(latest: str | None, current: str | None) -> bool:
    a, b = parse(latest), parse(current)
    if a is None or b is None:
        return False
    width = max(len(a), len(b))
    return a + (0,) * (width - len(a)) > b + (0,) * (width - len(b))


def _fetch_latest() -> str | None:
    try:
        with urllib.request.urlopen(PYPI_URL, timeout=5) as res:
            return str(json.load(res)["info"]["version"])
    except (OSError, ValueError, KeyError):
        return None


def latest_release() -> str | None:
    """The newest version on PyPI, cached; None when it cannot be reached."""
    global _cache
    now = time.monotonic()
    if _cache and now - _cache[0] < (_TTL if _cache[1] else _RETRY):
        return _cache[1]
    _cache = (now, _fetch_latest())
    return _cache[1]


def status(current: str, how_to_upgrade: list[str] | None) -> dict:
    """What the UI shows: ``available`` only when a newer release exists and the lookup is allowed."""
    latest = latest_release() if enabled() and parse(current) else None
    return {
        "current": current,
        "latest": latest,
        "available": is_newer(latest, current),
        "releaseUrl": f"{RELEASES_URL}/tag/v{latest}" if latest else RELEASES_URL,
        "upgradeCommand": " ".join(how_to_upgrade) if how_to_upgrade else None,
    }
