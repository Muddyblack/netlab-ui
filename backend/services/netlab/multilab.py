"""Parallel lab instances through netlab's ``multilab`` plugin.

netlab tracks running labs by *instance id* — ``defaults.multilab.id``, or
``default`` when unset — so a second lab started from another directory fails
with "lab instance 'default' is already running". netlab's supported answer is
the multilab plugin: ``netlab up --plugin multilab -s defaults.multilab.id=N``
renames the lab to ``ml-N`` and moves its management network to
``192.168.N.0/24``, so both labs can run side by side.

This module detects that conflict before deploying and suggests a free id.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ruamel.yaml import YAML, YAMLError

# 192.168.121.0/24 is netlab's default management subnet (instance "default");
# a multilab id of 121 would put a second lab on the same network.
_RESERVED_IDS = {121}
_MAX_ID = 254


def configured_instance_id(topology_path: str | Path) -> str | None:
    """``defaults.multilab.id`` from the topology file, in any of the spellings
    netlab accepts (nested, dotted, or a top-level dotted key)."""
    try:
        data = YAML(typ="safe").load(Path(topology_path).read_text())
    except (OSError, YAMLError):
        return None
    if not isinstance(data, dict):
        return None
    candidates: list[Any] = [data.get("defaults.multilab.id")]
    defaults = data.get("defaults")
    if isinstance(defaults, dict):
        candidates.append(defaults.get("multilab.id"))
        multilab = defaults.get("multilab")
        if isinstance(multilab, dict):
            candidates.append(multilab.get("id"))
    for value in candidates:
        if value not in (None, "", {}):
            return str(value)
    return None


def multilab_args(multilab_id: int) -> list[str]:
    return ["--plugin", "multilab", "-s", f"defaults.multilab.id={multilab_id}"]


def free_id(status: dict[str, Any]) -> int:
    used = {str(key) for key in status}
    for candidate in range(1, _MAX_ID + 1):
        if candidate not in _RESERVED_IDS and str(candidate) not in used:
            return candidate
    raise ValueError("no free multilab id")


def plan(topology_path: str | Path, status: dict[str, Any]) -> dict[str, Any]:
    """Whether deploying ``topology_path`` would collide with another running
    lab instance, and the multilab id to use instead."""
    lab_dir = str(Path(topology_path).resolve().parent)
    configured = configured_instance_id(topology_path)
    instance_id = configured or "default"
    running = status.get(instance_id) if isinstance(status, dict) else None
    conflict = None
    if isinstance(running, dict):
        other_dir = str(running.get("dir") or "")
        if other_dir and str(Path(other_dir).resolve()) != lab_dir:
            conflict = {"instanceId": instance_id, "directory": other_dir, "name": running.get("name")}
    return {
        "instanceId": instance_id,
        "configured": configured is not None,
        "conflict": conflict,
        "suggestedMultilabId": free_id(status) if conflict and not configured else None,
    }
