"""Session-facing orchestration for the canonical Netlab Lens bundle."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from services.netlab import runner

from . import validation_results
from .analyzer import build_bundle


def _source_document(path: Path) -> dict[str, Any]:
    value = YAML(typ="safe").load(path.read_text())
    return value if isinstance(value, dict) else {}


async def bundle_for(topology_path: str, revision: int) -> dict[str, Any]:
    path = Path(topology_path)
    source_bytes = path.read_bytes()
    artifact = await runner.create(path)
    return build_bundle(
        artifact["snapshot"],
        revision=revision,
        source_hash=hashlib.sha256(source_bytes).hexdigest(),
        source=_source_document(path),
        validation_results=validation_results.current(topology_path),
    )
