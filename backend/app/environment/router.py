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
        # lgtm[py/path-injection] -- by design: this is a Settings-UI feature letting an
        # operator point the backend at any netlab install on the host, so there is no
        # workspace/root to contain it to. It's gated by is_file()/name/X_OK below and by
        # `_runs_as_netlab` actually invoking the binary before it's trusted.
        resolved = candidate.resolve() if candidate.is_file() else None
    else:
        found = shutil.which(path)
        resolved = Path(found).resolve() if found else None  # lgtm[py/path-injection] -- see rationale above
    if resolved is None or resolved.name.lower() not in {"netlab", "netlab.exe"}:
        return None
    if not os.access(resolved, os.X_OK):
        return None
    return str(resolved)


def _runs_as_netlab(binary: str) -> bool:
    """True if the selected install's ``netlab version`` command succeeds."""
    binary_dir = str(Path(binary).parent)
    child_path = os.pathsep.join([binary_dir, location.child_path()])
    try:
        proc = subprocess.run(
            ["netlab", "version"],
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "PATH": child_path},
            shell=False,
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

    location.set_configured_bin(resolved if path is not None else None)
    # The install may have changed — drop the process-lifetime version cache so
    # the response (and later health polls) reflect the newly configured netlab.
    runner.reset_version_cache()
    return _environment()
