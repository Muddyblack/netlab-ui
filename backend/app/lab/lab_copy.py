"""Copy a lab into a workspace — "fork" a shared lab into your own, publish
yours to the shared folder, or duplicate it to try something out.

A lab that owns its directory (the ``<lab>/topology.yml`` layout) is copied
whole — custom templates, config snippets, units — minus everything netlab
or the UI generated (``clab.yml``, ``node_files/``, ``netlab.lock``, config
snapshots…). A topology that shares its directory with other labs is copied
with its own sidecar files only, so unrelated labs don't come along.

The copy gets its own directory (netlab keeps per-lab state there) and its
top-level ``name:`` becomes the new name, so the original and the copy can
run side by side.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.lab import common
from app.sessions.store import store
from services import events
from services import workspaces as ws_store
from services.netlab import runner

# Files the UI keeps next to a topology, named after it.
SIDECAR_SUFFIXES = (".netlab-ui.json", ".netlab-teaching.json", ".netlab-ui-scripts.json")
_NAME_LINE = re.compile(r"^name:[ \t]*\S.*$", re.MULTILINE)
_SKIP_NAMES = {"netlab.lock", ".git", ".netlab-ui", "__pycache__"}


def _is_own_directory(topology: Path) -> bool:
    """True when ``topology`` is the only lab topology in its directory."""
    others = [
        entry
        for entry in topology.parent.iterdir()
        if entry.is_file()
        and entry.suffix in (".yml", ".yaml")
        and entry != topology
        and not common.is_generated(entry, is_dir=False)
        and entry.name != "docker-compose.yml"
    ]
    return not others


def _ignore(directory: str, names: list[str]) -> set[str]:
    skipped = set()
    for name in names:
        if name.endswith((*SIDECAR_SUFFIXES, ".annotations.json")):
            continue  # positions, tours, scripts: the user's work, not netlab's
        path = Path(directory) / name
        is_dir = path.is_dir()
        if name in _SKIP_NAMES or common.is_generated(path, is_dir=is_dir) or name.endswith((".tmp", ".log")):
            skipped.add(name)
    return skipped


def _sidecars(topology: Path) -> list[Path]:
    names = [f"{topology.stem}{suffix}" for suffix in SIDECAR_SUFFIXES] + [f"{topology.name}.annotations.json"]
    return [topology.parent / name for name in names if (topology.parent / name).is_file()]


def rename_lab(text: str, name: str) -> str:
    """Set the top-level ``name:`` (if the topology has one)."""
    return _NAME_LINE.sub(f"name: {name}", text, count=1)


def copy_lab(topology: Path, target_dir: Path, name: str) -> Path:
    """Copy the lab behind ``topology`` into the new ``target_dir``; returns
    the copy's topology path. ``target_dir`` must not exist yet."""
    if _is_own_directory(topology):
        shutil.copytree(topology.parent, target_dir, ignore=_ignore, symlinks=True)
    else:
        target_dir.mkdir(parents=True)
        shutil.copy2(topology, target_dir / topology.name)
        for sidecar in _sidecars(topology):
            shutil.copy2(sidecar, target_dir / sidecar.name)
    copied = target_dir / topology.name
    copied.write_text(rename_lab(copied.read_text(), name))
    return copied


router = APIRouter()
_LAB_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class CopyLabRequest(BaseModel):
    topologyPath: str
    name: str
    # A configured workspace root; the primary workspace when omitted.
    targetWorkspace: str | None = None


class CopyLabResult(BaseModel):
    path: str
    topologyRef: dict[str, str]


def _target_workspace(requested: str | None) -> Path:
    if not requested:
        return common.workspace()
    wanted = os.path.normpath(os.path.realpath(os.path.expanduser(requested)))
    for workspace in ws_store.load():
        if os.path.normpath(os.path.realpath(os.path.expanduser(workspace))) == wanted:
            return Path(wanted)
    raise HTTPException(400, "target is not a configured workspace")


@router.post("/copy", response_model=CopyLabResult)
def copy_lab_endpoint(body: CopyLabRequest):
    source = common.resolve_workspace_path(body.topologyPath)
    if not source.is_file():
        raise HTTPException(404, "topology not found")
    if not _LAB_NAME_RE.fullmatch(body.name.strip()):
        raise HTTPException(400, "use letters, digits, - and _ for the lab name")
    target = common.resolve_within(_target_workspace(body.targetWorkspace), body.name.strip())
    if target.exists():
        raise HTTPException(409, f"{target} already exists")
    copied = copy_lab(source, target, body.name.strip())
    events.hub.publish({"type": "files"})
    path = str(copied.resolve())
    return {
        "path": path,
        "topologyRef": {
            "topologyId": f"standalone:local::{path}",
            "labName": body.name.strip(),
            "yamlPath": path,
            "source": "standalone",
        },
    }


class DeleteLabRequest(BaseModel):
    topologyPath: str
    # Only report what would be deleted (the confirmation dialog shows it).
    dryRun: bool = False


class DeleteLabResult(BaseModel):
    # What goes (or went) off the disk: the lab's folder, or just its topology file.
    deleted: str
    kind: Literal["folder", "file"]


def _delete_target(topology: Path) -> tuple[Path, Literal["folder", "file"]]:
    """A lab that is the `topology.yml` of its own folder owns that folder; a lone
    `<name>.yml` (e.g. labs/sample.yml) owns only itself. A workspace root is never a lab folder."""
    roots = {Path(os.path.realpath(os.path.expanduser(ws))) for ws in ws_store.load()}
    parent = topology.parent
    if topology.stem == "topology" and parent not in roots:
        return parent, "folder"
    return topology, "file"


@router.post("/delete", response_model=DeleteLabResult)
async def delete_lab_endpoint(body: DeleteLabRequest):
    topology = common.resolve_workspace_path(body.topologyPath)
    if not topology.is_file():
        raise HTTPException(404, "topology not found")
    abs_path = str(topology.resolve())
    running: dict = {}
    if runner.is_installed():
        try:
            running = await runner.status_cached()
        except Exception:  # noqa: BLE001 — without a status the on-disk state is all we can go by
            running = {}
    try:
        lab_name = commands.load_topology(abs_path).name or topology.stem
    except Exception:  # noqa: BLE001 — an unparseable YAML is still deletable
        lab_name = topology.stem
    if common.is_lab_running(abs_path, lab_name, topology.stem, running):
        raise HTTPException(409, "the lab is deployed — destroy it before deleting")
    target, kind = _delete_target(topology)
    if not body.dryRun:
        for session in list(store._sessions.values()):
            if Path(session.topology_path).resolve().is_relative_to(target):
                store.delete(session.id)
        if kind == "folder":
            await asyncio.to_thread(shutil.rmtree, target)
        else:
            topology.unlink()
        events.hub.publish({"type": "files"})
    return {"deleted": str(target), "kind": kind}
