"""Docker image endpoints backing clab-ui's Image Manager."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.contract.responses import (
    DockerImage,
    ImageOpResult,
    KindImageReference,
)
from app.lab import common
from services import workspaces as ws_store
from services.netlab import location

router = APIRouter()


class PullImageRequest(BaseModel):
    image: str
    kind: str | None = None
    endpointId: str | None = None


class RemoveImageRequest(BaseModel):
    reference: str
    endpointId: str | None = None


async def list_docker_images() -> list[dict[str, Any]]:
    if shutil.which("docker") is None:
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "images",
            "--format",
            "{{json .}}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await proc.communicate()
        if proc.returncode != 0:
            return []
        images = []
        for line in stdout.decode().strip().split("\n"):
            if not line:
                continue
            try:
                raw = json.loads(line)
                tag = raw.get("Tag")
                repo = raw.get("Repository")
                repo_tag = f"{repo}:{tag}" if tag and repo else repo
                images.append(
                    {
                        "id": raw.get("ID", ""),
                        "repoTags": [repo_tag] if repo_tag else [],
                        "repoDigests": [],
                        "size": raw.get("Size", ""),
                    }
                )
            except Exception:  # noqa: BLE001 — one malformed `docker images` line must not break the list
                pass
        return images
    except Exception:  # noqa: BLE001 — docker unavailable/erroring returns an empty list, not a 500
        return []


@router.get("/images", response_model=list[DockerImage])
async def get_images():
    images = await list_docker_images()
    return images


@router.get("/images/references", response_model=list[str])
async def get_image_references():
    """Flat list of locally available ``repository:tag`` image references.

    Powers the Image/Version autocomplete in the node-template editor
    (clab-ui's ``useDockerImages`` reads these via ``window.__DOCKER_IMAGES__``).
    """
    references: list[str] = []
    seen: set[str] = set()
    for image in await list_docker_images():
        for ref in image.get("repoTags", []):
            if ref and ref != "<none>:<none>" and ref not in seen:
                seen.add(ref)
                references.append(ref)
    return references


def _netsim_clab_devices() -> dict[str, dict[str, str]]:
    """Per netlab device kind: its clab default image, containerlab kind, and
    human label — read from the installed netsim package's device data."""
    try:
        from ruamel.yaml import YAML
    except ModuleNotFoundError:
        return {}

    package_dir = location.netsim_package_dir()
    devices_dir = package_dir / "devices" if package_dir else None
    if not devices_dir or not devices_dir.is_dir():
        return {}

    _yaml = YAML()
    devices: dict[str, dict[str, str]] = {}
    for yml in sorted(devices_dir.glob("*.yml")):
        try:
            data = _yaml.load(yml.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001 — one malformed device file must not break the catalog
            continue
        clab = data.get("clab") or {}
        image = clab.get("image")
        if not image:
            continue
        node = clab.get("node") or {}
        devices[yml.stem] = {
            "image": str(image),
            "clab_kind": str(node.get("kind") or yml.stem),
            "label": str(data.get("description") or yml.stem),
        }
    return devices


def _topology_node_references(devices: dict[str, dict[str, str]]) -> list[dict]:
    """kind->image references for every node used in workspace topologies,
    resolved via netsim device data (no ``netlab create`` run — this is called
    on every Image Manager open and must stay cheap)."""
    try:
        from ruamel.yaml import YAML
    except ModuleNotFoundError:
        return []

    _yaml = YAML()
    references: list[dict] = []
    for ws_path_str in ws_store.load():
        ws_path = Path(ws_path_str)
        if not ws_path.exists():
            continue
        for topo_path in common.topology_candidates(ws_path):
            try:
                data = _yaml.load(topo_path.read_text(encoding="utf-8")) or {}
            except Exception:  # noqa: BLE001 — one malformed topology file must not break the scan
                continue
            if not isinstance(data, dict):
                continue
            default_device = data.get("defaults", {}).get("device") if isinstance(data.get("defaults"), dict) else None
            nodes = data.get("nodes")
            if isinstance(nodes, list):
                nodes = {n: {} for n in nodes if isinstance(n, str)}
            if not isinstance(nodes, dict):
                continue
            for node_name, node_data in nodes.items():
                node_data = node_data if isinstance(node_data, dict) else {}
                device = node_data.get("device") or data.get("device") or default_device
                if not isinstance(device, str) or device not in devices:
                    continue
                info = devices[device]
                image = node_data.get("image")
                references.append(
                    {
                        "kind": info["clab_kind"],
                        "image": str(image) if isinstance(image, str) else info["image"],
                        "source": "topology-node",
                        "label": f"{node_name} in {topo_path.name}",
                        "endpointId": "local",
                        "path": str(topo_path.resolve()),
                        "nodeName": str(node_name),
                    }
                )
    return references


@router.get("/images/kind-references", response_model=list[KindImageReference])
async def get_kind_image_references():
    """Kind -> image pairings for clab-ui's Image Manager catalog.

    Merges two sources: netsim's built-in device defaults (one entry per
    supported kind, source ``topology-defaults``) and every node actually
    used across all workspaces' lab topologies (source ``topology-node``),
    resolved via the same netsim device data rather than running
    ``netlab create`` (kept cheap enough to call on every dialog open).
    """

    def build() -> list[dict]:
        devices = _netsim_clab_devices()
        references = [
            {
                "kind": info["clab_kind"],
                "image": info["image"],
                "source": "topology-defaults",
                "label": f"{info['label']} default",
                "endpointId": "local",
            }
            for info in devices.values()
        ]
        references.extend(_topology_node_references(devices))
        return references

    # Workspace scans + YAML parsing are blocking I/O; keep them off the loop.
    return await run_in_threadpool(build)


@router.post("/images/pull", response_model=ImageOpResult)
async def pull_image(body: PullImageRequest):
    if shutil.which("docker") is None:
        raise HTTPException(503, "Docker CLI is not available on the backend.")
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "pull",
            body.image,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return {"success": False, "output": stderr.decode()}
        return {"success": True, "message": f"Successfully pulled {body.image}"}
    except Exception as e:  # noqa: BLE001 — surface any docker failure to the panel instead of a 500
        return {"success": False, "output": str(e)}


@router.post("/images/remove", response_model=ImageOpResult)
async def remove_image(body: RemoveImageRequest):
    if shutil.which("docker") is None:
        raise HTTPException(503, "Docker CLI is not available on the backend.")
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "rmi",
            body.reference,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return {"success": False, "output": stderr.decode()}
        return {"success": True, "message": f"Successfully removed {body.reference}"}
    except Exception as e:  # noqa: BLE001 — surface any docker failure to the panel instead of a 500
        return {"success": False, "output": str(e)}
