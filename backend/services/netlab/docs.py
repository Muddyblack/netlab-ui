"""Fetch netlab documentation markdown from the upstream repo.

The pip ``networklab`` wheel ships plugin/device *code* but no docs, so the
Supported Platforms reference and per-plugin READMEs are fetched from the netlab
GitHub repo at the tag matching the *installed* version (e.g. ``release_26.05``).
Fetched docs are persisted to a per-version disk cache so a doc that has been
opened once keeps working offline; an in-memory cache on top avoids re-reading
the file (and negative-caches failed fetches for the process lifetime).
"""

from __future__ import annotations

import os
import re
import urllib.request
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote

from services.netlab import location

_RAW_BASE = "https://raw.githubusercontent.com/ipspace/netlab"

# url -> cleaned markdown, or None when the fetch failed (negative-cached so we
# don't retry a missing/offline doc on every dialog open).
_cache: dict[str, str | None] = {}


def _cache_dir(version: str) -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    version_key = sha256(version.encode()).hexdigest()
    return Path(base).expanduser().resolve() / "netlab-gui" / "docs" / version_key


def _disk_cache_path(version: str, rel_path: str) -> Path:
    filename = sha256(rel_path.encode()).hexdigest() + ".md"
    return _cache_dir(version) / filename


def _read_disk_cache(version: str, rel_path: str) -> str | None:
    try:
        return _disk_cache_path(version, rel_path).read_text(encoding="utf-8")
    except OSError:
        return None


def _write_disk_cache(version: str, rel_path: str, markdown: str) -> None:
    try:
        path = _disk_cache_path(version, rel_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding="utf-8")
    except OSError:
        pass  # cache is best-effort; serving the doc matters more


def netsim_version() -> str | None:
    """Version of the installed netlab package (``netsim.__version__``), or None
    when netlab isn't importable."""
    return location.netsim_version()


def clean_markdown(md: str) -> str:
    """Drop MkDocs/MyST-only artifacts so an upstream doc renders as plain
    markdown: ``(anchor)=`` reference labels and ```` ```eval_rst ```` blocks."""
    md = re.sub(r"^\([\w-]+\)=\s*$\n?", "", md, flags=re.MULTILINE)
    md = re.sub(r"```eval_rst.*?```\s*", "", md, flags=re.DOTALL)
    return md.strip()


def fetch_doc(rel_path: str) -> str | None:
    """Fetch ``docs/<rel_path>`` from the netlab repo at the installed version's
    tag, cleaned for rendering. Successful fetches are persisted to a disk cache
    so the doc stays available offline afterwards. Returns None when netlab is
    absent or the doc has never been fetched and the network is unavailable."""
    version = netsim_version()
    if not version:
        return None
    clean_path = rel_path.lstrip("/")
    if not clean_path or ".." in Path(clean_path).parts:
        return None
    url = f"{_RAW_BASE}/release_{quote(version, safe='._-')}/docs/{quote(clean_path, safe='/._-')}"
    if url in _cache:
        return _cache[url]

    result = _read_disk_cache(version, rel_path)
    if result is None:
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                result = clean_markdown(resp.read().decode("utf-8"))
        except (OSError, UnicodeError):
            result = None
        if result is not None:
            _write_disk_cache(version, rel_path, result)
    _cache[url] = result
    return result
