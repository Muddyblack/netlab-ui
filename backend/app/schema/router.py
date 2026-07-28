from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from ruamel.yaml import YAMLError

from app.contract.responses import DeviceEntry
from services.netlab import location

router = APIRouter(prefix="/api/schema", tags=["schema"])

_SCHEMA_PATH = Path(__file__).with_name("netlab.schema.json")

# Internal/meta device kinds that exist only as parent definitions and are not
# selectable in the UI.
_META_DEVICES = {"_common", "unknown", "none", "ios", "junos", "xr"}


def _load_devices_from_netsim() -> list[dict[str, str]] | None:
    """Read device kinds and descriptions from the installed netsim package."""
    try:
        from ruamel.yaml import YAML
    except ModuleNotFoundError:
        return None

    package_dir = location.netsim_package_dir()
    devices_dir = package_dir / "devices" if package_dir else None
    if not devices_dir or not devices_dir.is_dir():
        return None

    _yaml = YAML()
    results: list[dict[str, str]] = []
    for yml in sorted(devices_dir.glob("*.yml")):
        kind = yml.stem
        if kind in _META_DEVICES:
            continue
        try:
            data = _yaml.load(yml.read_text(encoding="utf-8")) or {}
        except (OSError, UnicodeError, YAMLError):
            continue
        label = data.get("description") or kind
        results.append({"kind": kind, "label": label})
    return results or None


@router.get("/netlab.json", response_model=dict[str, Any])
def get_netlab_schema() -> JSONResponse:
    with _SCHEMA_PATH.open("r", encoding="utf-8") as handle:
        schema = json.load(handle)
    return JSONResponse(schema)


@router.get("/devices", response_model=list[DeviceEntry])
def get_devices() -> JSONResponse:
    """Return the list of netlab device kinds for the node palette."""
    return JSONResponse(_load_devices_from_netsim() or [])
