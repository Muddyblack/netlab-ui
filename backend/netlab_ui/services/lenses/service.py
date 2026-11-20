"""Session-facing orchestration for the canonical Netlab Lens bundle."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from netlab_ui.services.netlab import runner

from . import validation_results
from .analyzer import build_bundle


def _source_document(path: Path) -> dict[str, Any]:
    value = YAML(typ="safe").load(path.read_text())
    return value if isinstance(value, dict) else {}


async def bundle_for(topology_path: str, revision: int) -> dict[str, Any]:
    path = Path(topology_path)
    source_bytes = path.read_bytes()
    source = _source_document(path)
    if not source.get("nodes"):
        # A new, empty lab: netlab refuses a topology without nodes, which the canvas showed as a failed
        # request. There is nothing to analyse yet, so the lenses are simply empty.
        transformed: dict[str, Any] = {"name": source.get("name") or path.parent.name, "nodes": {}, "links": []}
    else:
        transformed = (await runner.create(path))["snapshot"]
    return build_bundle(
        transformed,
        revision=revision,
        source_hash=hashlib.sha256(source_bytes).hexdigest(),
        source=source,
        validation_results=validation_results.current(topology_path),
    )
