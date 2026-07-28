"""Workspace, lab-file, icon and filesystem endpoints, plus the push-event
SSE stream the frontend subscribes to instead of interval-polling."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.contract import commands
from app.contract.responses import (
    ExampleLab,
    ExampleLabListResult,
    FileDocument,
    FileTreeResult,
    FsBrowseResult,
    IconListResult,
    LabFileEntry,
    OkMessageResult,
    WorkspaceListResult,
)
from app.lab import common
from services import annotations as ann_store
from services import events
from services import icons as icon_store
from services import workspaces as ws_store
from services.netlab import runner

router = APIRouter()
logger = logging.getLogger(__name__)


def _count_labs(workspace_path: Path) -> int:
    """Lightweight lab count for a workspace (no topology parsing)."""
    if not workspace_path.exists():
        return 0
    return len(common.topology_candidates(workspace_path))


def _workspace_entries() -> list[dict]:
    """Workspace list with existence + lab counts for the manage dialog."""
    out = []
    for p in ws_store.load():
        path = Path(p)
        out.append({"path": p, "exists": path.exists(), "labCount": _count_labs(path)})
    return out


def _scan_workspace(workspace_path: Path, running_status: dict) -> list[dict]:
    """Scan one workspace directory and return LabFileEntry dicts."""
    entries = []
    workspace_path.mkdir(parents=True, exist_ok=True)
    candidates = common.topology_candidates(workspace_path)

    for path in candidates:
        try:
            topo = commands.load_topology(str(path))
            lab_name = topo.name or path.stem
        except Exception:  # noqa: BLE001 — an unparseable YAML falls back to the filename
            lab_name = path.stem

        abs_path = str(path.resolve())
        # A lab file counts as deployed while a netlab instance record exists
        # for it — matched by lab name or by directory, since `netlab status
        # --all` summaries only carry `dir`. Container state is deliberately
        # not required: a crashed deploy must still read as deployed so the
        # UI offers destroy/cleanup instead of a second deploy.
        is_running = False
        if running_status:
            for k, lab_info in running_status.items():
                lab_dir = str(lab_info.get("dir") or "")
                if (
                    k == lab_name
                    or lab_info.get("name") == lab_name
                    or k == path.stem
                    or (lab_dir != "" and abs_path.startswith(f"{lab_dir}/"))
                ):
                    is_running = True
                    break
        entries.append(
            {
                "endpointId": "local",
                "filename": path.name,
                "path": abs_path,
                "hasAnnotations": ann_store.sidecar_path(abs_path).exists(),
                "labName": lab_name,
                "deploymentState": "deployed" if is_running else "undeployed",
                "workspace": str(workspace_path.resolve()),
                "topologyRef": {
                    "topologyId": f"standalone:local::{abs_path}",
                    "labName": lab_name,
                    "yamlPath": abs_path,
                    "source": "standalone",
                },
            }
        )
    return entries


@router.get("/files", response_model=list[LabFileEntry])
async def list_files():
    running_status: dict = {}
    if runner.is_installed():
        try:
            running_status = await runner.status_cached()
        except Exception:  # noqa: BLE001 — a status-lookup failure shouldn't block the file listing
            running_status = {}

    def scan() -> list[dict]:
        entries = []
        seen_paths: set[str] = set()
        for ws_path_str in ws_store.load():
            for entry in _scan_workspace(Path(ws_path_str), running_status):
                if entry["path"] not in seen_paths:
                    seen_paths.add(entry["path"])
                    entries.append(entry)
        return entries

    # Workspace scans walk + parse YAML: blocking I/O, keep it off the loop.
    return await run_in_threadpool(scan)


@router.get("/events/stream")
async def lab_events_stream():
    """SSE stream of backend push events (``{"type": "files" | "workspaces"}``).

    Fed by the watchfiles workspace watcher and by mutating endpoints; the
    frontend refreshes its file/workspace lists on each event instead of
    polling. A comment frame every 25 s keeps proxies from closing the stream.
    """

    async def gen():
        q = events.hub.subscribe()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            events.hub.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=common.SSE_HEADERS)


@router.get("/icons", response_model=IconListResult)
def list_icons():
    return icon_store.list_custom_icons()


@router.post("/icons/upload", response_model=OkMessageResult)
async def upload_icon(request: Request):
    try:
        upload = icon_store.extract_multipart_icon_upload(
            request.headers.get("content-type", ""),
            await request.body(),
        )
        filename = icon_store.save_uploaded_icon(upload)
    except icon_store.IconUploadError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, f"failed to save icon: {exc}") from exc
    return {"ok": True, "message": f"uploaded {filename}"}


@router.delete("/icons/{name}", response_model=OkMessageResult)
def delete_icon(name: str):
    try:
        deleted = icon_store.delete_custom_icon(name)
    except icon_store.IconDeleteError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, f"failed to delete icon: {exc}") from exc
    return {"ok": True, "message": f"deleted {', '.join(deleted)}"}


def _list_dir_sync(target: Path) -> list[dict]:
    children = sorted(target.iterdir(), key=lambda c: (c.is_file(), c.name.lower()))
    entries = []
    for child in children:
        if child.name.startswith("."):
            continue
        try:
            is_dir = child.is_dir()
        except OSError:
            continue
        entries.append(
            {
                "name": child.name,
                "path": str(child),
                "kind": "dir" if is_dir else "file",
                "generated": common.is_generated(child, is_dir),
            }
        )
    return entries


@router.get("/files/tree", response_model=FileTreeResult)
async def lab_files_tree(path: str):
    """List one directory level for the file explorer (lazy tree expansion).

    ``path`` must be inside a configured workspace."""
    target = common.resolve_workspace_path(path)
    if not target.is_dir():
        raise HTTPException(404, f"not a directory: {target}")

    try:
        # Directory iteration is blocking disk I/O; run it in a thread so a
        # burst of tree-expansion requests (e.g. opening a large cloned repo)
        # doesn't serialize on uvicorn's single event loop and stall every
        # other in-flight request (status polls, snapshots, other tree calls).
        entries = await run_in_threadpool(_list_dir_sync, target)
    except PermissionError:
        raise HTTPException(403, f"permission denied: {target}") from None
    return {"entries": entries}


class NewFolderRequest(BaseModel):
    # Parent directory (must be inside a configured workspace) and the new
    # folder's name.
    path: str
    name: str


@router.post("/files/mkdir", response_model=OkMessageResult)
def make_folder(body: NewFolderRequest):
    parent = common.resolve_workspace_path(body.path)
    if not parent.is_dir():
        raise HTTPException(404, f"not a directory: {parent}")
    name = body.name.strip().strip("/\\")
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise HTTPException(400, "invalid folder name")
    target = parent / name
    if target.exists():
        raise HTTPException(409, f"{name} already exists")
    target.mkdir(parents=True)
    events.hub.publish({"type": "files"})
    return {"ok": True, "message": f"created {target}"}


# The frontend's file editor tabs read/save via this runtime contract (the
# path clab-ui's host expects); it works for any file inside a workspace, not
# just topologies.
runtime_files_router = APIRouter(prefix="/api/runtime/file-explorer", tags=["runtime-files"])


@runtime_files_router.get("/file", response_model=FileDocument)
async def read_workspace_file(path: str):
    target = common.resolve_workspace_path(path)
    if not target.is_file():
        raise HTTPException(404, f"not a file: {target}")
    try:
        return {"path": str(target), "content": target.read_text()}
    except UnicodeDecodeError:
        raise HTTPException(415, "binary files cannot be opened in the editor") from None


@runtime_files_router.put("/file", response_model=OkMessageResult)
async def write_workspace_file(body: FileDocument):
    target = common.resolve_workspace_path(body.path)
    if target.is_dir():
        raise HTTPException(400, f"is a directory: {target}")
    target.write_text(body.content)
    return {"ok": True, "message": f"saved {target}"}


# Filesystem browser for the "Add Folder" workspace picker. Unlike the file
# explorer (scoped to configured workspaces), this lets the user navigate the
# server's directory tree to choose a *new* workspace root — so it deliberately
# is not workspace-restricted. It only ever lists directories, never file
# contents.
fs_router = APIRouter(prefix="/api/fs", tags=["fs"])


@fs_router.get("/browse", response_model=FsBrowseResult)
def browse_filesystem(path: str | None = None):
    target = Path(path).expanduser() if path else Path.home()
    target = target.resolve()
    if not target.is_dir():
        raise HTTPException(404, f"not a directory: {target}")

    entries = []
    try:
        for child in sorted(target.iterdir(), key=lambda c: c.name.lower()):
            if child.name.startswith("."):
                continue
            try:
                is_dir = child.is_dir()
            except OSError:
                continue
            if not is_dir:
                continue
            entries.append({"name": child.name, "path": str(child), "isDir": True})
    except PermissionError:
        raise HTTPException(403, f"permission denied: {target}") from None

    parent = str(target.parent) if target.parent != target else None
    return {"path": str(target), "parent": parent, "entries": entries}


class WorkspaceRequest(BaseModel):
    path: str


class NewLabRequest(BaseModel):
    name: str


@router.get("/workspaces", response_model=WorkspaceListResult)
def list_workspaces():
    return {"workspaces": _workspace_entries()}


@router.post("/workspaces", response_model=WorkspaceListResult)
def add_workspace(body: WorkspaceRequest):
    p = Path(body.path).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    ws_store.add(str(p))
    events.poke_watcher()
    events.hub.publish({"type": "workspaces"})
    return {"workspaces": _workspace_entries()}


@router.delete("/workspaces", response_model=WorkspaceListResult)
def remove_workspace(body: WorkspaceRequest):
    ws_store.remove(body.path)
    events.poke_watcher()
    events.hub.publish({"type": "workspaces"})
    return {"workspaces": _workspace_entries()}


@router.post("/new", response_model=dict)
async def new_lab(body: NewLabRequest):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in name)
    workspace = common.workspace()
    path = workspace / f"{safe}.yml"
    if path.exists():
        raise HTTPException(409, f"{safe}.yml already exists")
    path.write_text(f"name: {safe}\nnodes:\nlinks:\n")
    events.hub.publish({"type": "files"})
    abs_path = str(path.resolve())
    return {
        "path": abs_path,
        "topologyRef": {
            "topologyId": f"standalone:local::{abs_path}",
            "labName": safe,
            "yamlPath": abs_path,
            "source": "standalone",
        },
    }


# Curated netlab-relevant example repositories, surfaced by the explorer's
# "Example Labs" picker so users can clone a working lab in one click without
# hunting for a Git URL. Mirrors containerlab-app's popular-repos pattern.
_EXAMPLE_LABS: list[dict[str, Any]] = [
    {
        "name": "netlab-examples",
        "repoUrl": "https://github.com/ipspace/netlab-examples",
        "description": "Official collection of netlab example topologies and tutorials.",
        "stars": 230,
    },
    {
        "name": "BGP labs",
        "repoUrl": "https://github.com/bgplabs/netlab",
        "description": "Hands-on BGP lab exercises built on netlab.",
        "stars": 120,
    },
    {
        "name": "netlab-tools/netlab",
        "repoUrl": "https://github.com/netlab-tools/netlab",
        "description": "The netlab source repo — its tests/ tree holds many ready-to-run topologies.",
        "stars": 700,
    },
]


class CloneRepoAction(BaseModel):
    repoUrl: str
    # Optional workspace root to clone into. Must be a configured workspace;
    # falls back to the primary workspace when omitted.
    targetWorkspace: str | None = None


@router.get("/examples", response_model=ExampleLabListResult)
def list_example_labs():
    return {"labs": [ExampleLab(**lab) for lab in _EXAMPLE_LABS]}


@router.post("/clone", response_model=OkMessageResult)
async def clone_repo(body: CloneRepoAction):
    if shutil.which("git") is None:
        raise HTTPException(503, "Git is not installed on the backend.")
    try:
        repo_name = Path(urlparse(body.repoUrl).path.rstrip("/")).name
        if repo_name.endswith(".git"):
            repo_name = repo_name[:-4]
        allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
        if not repo_name or repo_name in {".", ".."} or any(char not in allowed for char in repo_name):
            raise HTTPException(400, "Repository URL has an invalid destination name.")

        # Clone into the chosen workspace (validated) or the primary one — never
        # the process CWD, which would leave the repo outside any workspace.
        dest_root = common.resolve_workspace_path(body.targetWorkspace) if body.targetWorkspace else common.workspace()
        dest_root = dest_root.resolve()
        dest_path = (dest_root / repo_name).resolve(strict=False)
        if dest_path.parent != dest_root:
            raise HTTPException(400, "Repository destination is outside the workspace.")
        if dest_path.exists():
            if dest_path.is_dir():
                shutil.rmtree(dest_path)
            else:
                dest_path.unlink()

        proc = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            body.repoUrl,
            str(dest_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise HTTPException(500, f"Git clone failed: {stderr.decode()}")
        events.hub.publish({"type": "files"})
        return {"ok": True, "message": f"Successfully cloned into {repo_name}"}
    except HTTPException:
        raise  # don't re-wrap the 403/validation errors as a generic 500
    except Exception as exc:
        logger.exception("Git clone failed")
        raise HTTPException(500, "Git clone failed.") from exc
