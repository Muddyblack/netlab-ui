"""Running-configuration snapshots of a lab's nodes, and drift against them.

A snapshot is every running node's ``show running-config`` (through
``netlab connect --show``, so each device answers in its own CLI) saved under
``<lab dir>/.netlab-ui/configs/<topology stem>/<snapshot id>/<node>.cfg``.
The UI takes one after every successful ``netlab up`` / ``netlab initial``,
and on demand; comparing the live configuration with one answers "what did
I (or that command) change on the devices?".

Only the newest ``KEEP`` snapshots are kept per lab.
"""

from __future__ import annotations

import asyncio
import contextlib
import difflib
import json
import re
import shutil
import time
from pathlib import Path
from typing import Any

from services.netlab import runner

KEEP = 20
MAX_PARALLEL = 8
TIMEOUT_S = 30.0
_ID_RE = re.compile(r"^\d{8}-\d{6}(-\d+)?$")
# Lines that change without anyone changing the configuration.
_VOLATILE = re.compile(
    r"^(Building configuration|Current configuration|! (Last configuration change|NVRAM config last updated|Time:)"
    r"|ntp clock-period|! Command: show running-config)",
    re.IGNORECASE,
)


def snapshots_root(topology_path: str | Path) -> Path:
    path = Path(topology_path)
    return path.parent / ".netlab-ui" / "configs" / path.stem


def normalize(config: str) -> str:
    """Drop volatile header/timestamp lines and trailing whitespace."""
    lines = [line.rstrip() for line in config.splitlines() if not _VOLATILE.match(line.strip())]
    return "\n".join(lines).strip() + "\n"


async def _running_config(topology_path: str | Path, node: str) -> str | None:
    args = ["connect", "-q", node, "--show", "running-config"]
    proc = await runner.spawn_command(args, cwd=Path(topology_path).parent)
    try:
        out, _err = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_S)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()
        return None
    text = out.decode(errors="replace")
    first = text.strip().splitlines()[0].lower() if text.strip() else ""
    # Linux hosts and devices without that command answer with an error.
    if not text.strip() or first.startswith(("%", "error", "bash:", "sh:")) or "command not found" in first:
        return None
    return text


async def running_nodes(topology_path: str | Path) -> list[str]:
    status = await runner.status_for(topology_path)
    nodes = status.get("nodes") if isinstance(status, dict) else None
    return [
        str(name)
        for name, info in (nodes or {}).items()
        if isinstance(info, dict) and runner.normalize_node_state(info.get("status")) == "running"
    ]


async def fetch_running(topology_path: str | Path, nodes: list[str]) -> dict[str, str | None]:
    limiter = asyncio.Semaphore(MAX_PARALLEL)

    async def one(node: str) -> tuple[str, str | None]:
        async with limiter:
            return node, await _running_config(topology_path, node)

    return dict(await asyncio.gather(*(one(node) for node in nodes)))


def _meta(directory: Path) -> dict[str, Any] | None:
    try:
        value = json.loads((directory / "meta.json").read_text())
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def list_snapshots(topology_path: str | Path) -> list[dict[str, Any]]:
    root = snapshots_root(topology_path)
    if not root.is_dir():
        return []
    snapshots = [
        meta for child in root.iterdir() if child.is_dir() and _ID_RE.match(child.name) and (meta := _meta(child))
    ]
    return sorted(snapshots, key=lambda meta: str(meta.get("id")), reverse=True)


async def take_snapshot(topology_path: str | Path, reason: str) -> dict[str, Any]:
    nodes = await running_nodes(topology_path)
    configs = await fetch_running(topology_path, nodes)
    root = snapshots_root(topology_path)
    snapshot_id = time.strftime("%Y%m%d-%H%M%S")
    directory = root / snapshot_id
    suffix = 1
    while directory.exists():
        suffix += 1
        directory = root / f"{snapshot_id}-{suffix}"
    directory.mkdir(parents=True)
    saved = []
    for node, config in configs.items():
        if config is not None:
            (directory / f"{node}.cfg").write_text(config)
            saved.append(node)
    meta = {
        "id": directory.name,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "reason": reason[:200],
        "nodes": sorted(saved),
        "skipped": sorted(node for node, config in configs.items() if config is None),
    }
    (directory / "meta.json").write_text(json.dumps(meta, indent=2))
    for old in list_snapshots(topology_path)[KEEP:]:
        shutil.rmtree(root / str(old["id"]), ignore_errors=True)
    return meta


def read_snapshot(topology_path: str | Path, snapshot_id: str, node: str) -> str | None:
    if not _ID_RE.match(snapshot_id) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", node):
        return None
    path = snapshots_root(topology_path) / snapshot_id / f"{node}.cfg"
    try:
        return path.read_text()
    except OSError:
        return None


def diff_counts(old: str, new: str) -> tuple[int, int]:
    added = removed = 0
    for line in difflib.unified_diff(normalize(old).splitlines(), normalize(new).splitlines(), lineterm="", n=0):
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed


async def drift(topology_path: str | Path, snapshot_id: str) -> list[dict[str, Any]]:
    """Per running node: how the live configuration differs from the snapshot."""
    nodes = await running_nodes(topology_path)
    live = await fetch_running(topology_path, nodes)
    rows = []
    for node in sorted(nodes):
        saved = read_snapshot(topology_path, snapshot_id, node)
        current = live.get(node)
        if current is None:
            rows.append({"node": node, "status": "unavailable", "added": 0, "removed": 0})
        elif saved is None:
            rows.append({"node": node, "status": "not-in-snapshot", "added": 0, "removed": 0})
        else:
            added, removed = diff_counts(saved, current)
            rows.append(
                {"node": node, "status": "changed" if added or removed else "same", "added": added, "removed": removed}
            )
    return rows
