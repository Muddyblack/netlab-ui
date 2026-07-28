"""Where netlab lives — read and configure the netlab install the backend drives.

The backend ships without netlab/ansible, so it must be pointed at an install
(on PATH, a pipx env, or a separate virtualenv). This endpoint backs the
Settings UI (set the path) and the Info tab (show the resolved environment).

* ``GET  /api/environment/netlab`` — the resolved environment + version/providers
* ``PUT  /api/environment/netlab`` — set/clear the configured path (validated)
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.contract.responses import NetlabEnvironment, SetNetlabPathRequest
from services.netlab import location, runner

router = APIRouter(prefix="/api/environment", tags=["environment"])


def _environment() -> dict:
    info = location.environment_info()
    version = runner.cached_version() if info["found"] else None
    info.update(
        {
            "netlabVersion": version,
            "netlabVersionSupported": runner.version_at_least(version) if version else None,
            "minNetlabVersion": runner.MIN_NETLAB_VERSION,
            "containerlab": runner.is_containerlab_installed(),
            "libvirt": runner.is_libvirt_installed(),
        }
    )
    return info


def _resolve_candidate(path: str) -> str | None:
    """Absolute path to a netlab binary for a user-supplied value (bare name via
    PATH, or an explicit/relative/absolute path), or ``None`` if it isn't there."""
    if os.path.sep in path or (os.altsep and os.altsep in path):
        candidate = Path(path).expanduser()
        return str(candidate) if candidate.is_file() else None
    return shutil.which(path)


def _runs_as_netlab(binary: str) -> bool:
    """True if ``<binary> version`` runs and looks like netlab — a guard so a
    typo'd or wrong path is rejected before it breaks every lab."""
    try:
        proc = subprocess.run(
            [binary, "version"],
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "PATH": location.child_path()},
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


@router.get("/netlab", response_model=NetlabEnvironment)
async def get_netlab_environment() -> dict:
    return _environment()


@router.put("/netlab", response_model=NetlabEnvironment)
async def set_netlab_path(body: SetNetlabPathRequest) -> dict:
    raw = (body.path or "").strip()
    path = raw or None

    if path is not None:
        resolved = _resolve_candidate(path)
        if not resolved:
            raise HTTPException(status_code=400, detail=f"No netlab binary found at {path!r}.")
        if not _runs_as_netlab(resolved):
            raise HTTPException(
                status_code=400,
                detail=f"{path!r} was found but `netlab version` did not run successfully.",
            )

    location.set_configured_bin(path)
    # The install may have changed — drop the process-lifetime version cache so
    # the response (and later health polls) reflect the newly configured netlab.
    runner.reset_version_cache()
    return _environment()
