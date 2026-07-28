"""Persistence for guided-tour documents (saved alongside the topology)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def document_path(topology_path: str | Path) -> Path:
    path = Path(topology_path)
    return path.with_name(f"{path.stem}.netlab-teaching.json")


def _revision(document: dict[str, Any]) -> str:
    payload = {**document, "revision": ""}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:16]


def empty_document() -> dict[str, Any]:
    document = {
        "schemaVersion": 2,
        "id": "default",
        "title": "Guided tour",
        "revision": "",
        "steps": [],
    }
    document["revision"] = _revision(document)
    return document


def _is_current(value: Any) -> bool:
    # Tolerate (and discard) documents written by the pre-capture task/reveal
    # schema — they have no `view` on their steps and can't be replayed.
    if not isinstance(value, dict) or value.get("schemaVersion") != 2:
        return False
    return isinstance(value.get("steps"), list)


def load(topology_path: str | Path) -> dict[str, Any]:
    path = document_path(topology_path)
    if not path.exists():
        return empty_document()
    try:
        value = json.loads(path.read_text())
    except json.JSONDecodeError:
        return empty_document()
    if not _is_current(value):
        return empty_document()
    value["revision"] = _revision(value)
    return value


def save(topology_path: str | Path, document: dict[str, Any]) -> dict[str, Any]:
    value = dict(document)
    value["schemaVersion"] = 2
    value["revision"] = _revision(value)
    target = document_path(topology_path)
    temporary = target.with_suffix(f"{target.suffix}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True))
    temporary.replace(target)
    return value
