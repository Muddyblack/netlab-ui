"""Shared helpers for the lab routers (files / images / lifecycle)."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from app.sessions.store import store
from services import workspaces as ws_store

# SSE headers: disable proxy/browser buffering so lines render as they happen.
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def workspace() -> Path:
    """Primary workspace directory (first in the workspace list)."""
    workspaces = ws_store.load()
    path = Path(workspaces[0])
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_workspace_path(path: str) -> Path:
    """Resolve ``path`` and require it to live inside a configured workspace."""
    target = Path(path).expanduser().resolve()
    allowed = [Path(ws).expanduser().resolve() for ws in ws_store.load()]
    if not any(target == ws or target.is_relative_to(ws) for ws in allowed):
        raise HTTPException(403, "path is outside the configured workspaces")
    return target


def session_path(session_id: str) -> str:
    try:
        return store.require(session_id).topology_path
    except KeyError as exc:
        raise HTTPException(404, "unknown session") from exc


# Artifacts netlab (and our own sidecars) generate next to topology sources.
# The file explorer groups these under a collapsed "generated" node per
# directory so the tree shows the user's actual sources first.
GENERATED_FILES = {
    "clab.yml",
    "hosts.yml",
    "ansible.cfg",
    "Vagrantfile",
    "netlab.snapshot.yml",
    "netlab.snapshot.pickle",
    "netlab.lock",
    "ansible-inventory.yml",
    "nornir-simple-inventory.yml",
}
GENERATED_DIRS = {
    "clab_files",
    "node_files",
    "group_vars",
    "host_vars",
    ".vagrant",
    "__pycache__",
    "monitoring",
    "grafana",
}
GENERATED_SUFFIXES = (".clab.yml", ".netlab-ui.json", ".log")


def is_generated(entry: Path, is_dir: bool) -> bool:
    if is_dir:
        return entry.name in GENERATED_DIRS
    return entry.name in GENERATED_FILES or entry.name.endswith(GENERATED_SUFFIXES)


def topology_candidates(workspace_path: Path) -> list[Path]:
    """Find candidate lab topology YAML files in a workspace, applying the
    same filtering used by the explorer (skip generated artifacts, hidden and
    vendored directories, dedupe by resolved path)."""
    seen: set[Path] = set()
    candidates: list[Path] = []
    for path in workspace_path.rglob("*"):
        if not (path.is_file() and path.suffix in (".yml", ".yaml")):
            continue
        if path.name == "docker-compose.yml":
            continue
        # Skip netlab-generated artifacts (provider files, Ansible inventory):
        # they are YAML but not lab topologies, and listing them as
        # "Undeployed Labs" bloats the explorer. They remain reachable under
        # the file explorer's per-directory "generated" group.
        parts = path.parts
        if is_generated(path, is_dir=False) or any(p in GENERATED_DIRS for p in parts):
            continue
        if any(p.startswith(".") for p in parts):
            continue
        if any(p in ("node_modules", "dist", ".git", "__pycache__") for p in parts):
            continue
        # Workspace unit library: real topologies, but they belong to the Units
        # panel (which opens them on demand), not the "Undeployed Labs" list.
        if "units" in path.relative_to(workspace_path).parts[:-1]:
            continue
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            candidates.append(path)
    return candidates
