"""Build the canonical read-only data used by Netlab Lenses.

The input is the full JSON topology produced by ``netlab create``. Netlab has
already resolved address pools, inherited module values and protocol sessions,
so this module normalizes those results for visualization instead of trying to
reimplement Netlab's derivation rules.

The addressing and control-plane passes are the bulk of the work and live in
``_addressing.py`` / ``_routing.py``; this module is just the orchestrator.
"""

from __future__ import annotations

from typing import Any

from services.lenses._addressing import build_addressing
from services.lenses._routing import build_routing


def build_bundle(
    transformed: dict[str, Any],
    *,
    revision: int,
    source_hash: str,
    source: dict[str, Any] | None = None,
    validation_results: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return one versioned Lens bundle from a transformed Netlab topology."""
    from .derivation import build_derivation
    from .path_explorer import build_reachability
    from .service_explorer import build_service_explorer
    from .validation_lens import build_validation

    addressing, addressing_meta = build_addressing(transformed, source)
    control_plane, services = build_routing(transformed, addressing_meta)
    validation = build_validation(transformed, validation_results or {})
    service_explorer = build_service_explorer(transformed)
    reachability = build_reachability(transformed)
    derivation = build_derivation(transformed, source)
    return {
        "schemaVersion": 1,
        "revision": revision,
        "sourceHash": source_hash,
        "netlabVersion": str(transformed.get("_netlab_version")) if transformed.get("_netlab_version") else None,
        "addressing": addressing,
        "controlPlane": control_plane,
        "services": services,
        "serviceExplorer": service_explorer,
        "validation": validation,
        "reachability": reachability,
        "derivation": derivation,
    }
