"""Fetch netlab documentation markdown from the upstream repo.

The pip ``networklab`` wheel ships plugin/device *code* but no docs, so the
Supported Platforms reference and per-plugin READMEs are fetched from the netlab
GitHub repo at the tag matching the *installed* version (e.g. ``release_26.05``).
Fetched docs are persisted to a per-version disk cache so a doc that has been
opened once keeps working offline; an in-memory cache on top avoids re-reading
the file (and negative-caches failed fetches for the process lifetime).
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote

from services.netlab import location

_RAW_BASE = "https://raw.githubusercontent.com/ipspace/netlab"
_TREE_API = "https://api.github.com/repos/ipspace/netlab/git/trees"

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


def _fetch_cached(version: str, cache_key: str, url: str, transform=lambda text: text) -> str | None:
    """Memory cache → disk cache → network, for one text resource at ``url``."""
    if url in _cache:
        return _cache[url]
    result = _read_disk_cache(version, cache_key)
    if result is None:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "netlab-gui"})
            with urllib.request.urlopen(request, timeout=10) as resp:
                result = transform(resp.read().decode("utf-8"))
        except (OSError, UnicodeError, ValueError):
            result = None
        if result is not None:
            _write_disk_cache(version, cache_key, result)
    _cache[url] = result
    return result


def _safe_path(path: str) -> str | None:
    clean_path = path.lstrip("/")
    if not clean_path or ".." in Path(clean_path).parts:
        return None
    return clean_path


def _tag(version: str) -> str:
    return f"release_{quote(version, safe='._-')}"


def fetch_doc(rel_path: str) -> str | None:
    """Fetch ``docs/<rel_path>`` from the netlab repo at the installed version's
    tag, cleaned for rendering. Successful fetches are persisted to a disk cache
    so the doc stays available offline afterwards. Returns None when netlab is
    absent or the doc has never been fetched and the network is unavailable."""
    version = netsim_version()
    clean_path = _safe_path(rel_path)
    if not version or not clean_path:
        return None
    url = f"{_RAW_BASE}/{_tag(version)}/docs/{quote(clean_path, safe='/._-')}"
    return _fetch_cached(version, rel_path, url, clean_markdown)


def fetch_repo_file(repo_path: str) -> str | None:
    """Fetch any file (e.g. ``tests/integration/ospf/01-areas.yml``) from the
    netlab repo at the installed version's tag, unmodified. Cached like
    :func:`fetch_doc`."""
    version = netsim_version()
    clean_path = _safe_path(repo_path)
    if not version or not clean_path:
        return None
    url = f"{_RAW_BASE}/{_tag(version)}/{quote(clean_path, safe='/._-')}"
    return _fetch_cached(version, "repo:" + clean_path, url)


def repo_paths() -> list[str] | None:
    """Every file path in the netlab repo at the installed version's tag (one
    GitHub API call, then cached per version). None when offline or netlab is
    absent."""
    version = netsim_version()
    if not version:
        return None
    url = f"{_TREE_API}/{_tag(version)}?recursive=1"

    def paths(text: str) -> str:
        tree = json.loads(text).get("tree") or []
        return "\n".join(entry["path"] for entry in tree if entry.get("type") == "blob")

    listing = _fetch_cached(version, "repo-tree", url, paths)
    return listing.splitlines() if listing else None
