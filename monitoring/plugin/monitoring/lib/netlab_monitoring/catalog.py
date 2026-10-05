"""The metrics the collector exports, and checks that user queries only use known ones.

The collector's ``FAMILIES`` table is the single source of truth (type + help text); this
module reads it without importing the collector package, so the plugin and the collector
stay independent.
"""

from __future__ import annotations

import importlib.util
import re
from functools import cache
from pathlib import Path

METRICS_PY = Path(__file__).resolve().parents[2] / "collector" / "nlmon" / "metrics.py"

# Labels every netlab metric can be sliced by; the rest depend on the metric.
COMMON_LABELS = {
    "lab": "Lab name",
    "node": "Node name from the netlab topology",
    "ifname": "Interface name (netlab names)",
    "link": "Link name from the topology",
    "peer_node": "Neighbor node, when the neighbor is a lab node",
}

_METRIC = re.compile(r"\bnetlab_[a-z0-9_]+")


@cache
def families() -> dict[str, tuple[str, str]]:
    """name -> (type, help) for every metric the collector exports."""
    spec = importlib.util.spec_from_file_location("_nlmon_metrics", METRICS_PY)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return dict(module.FAMILIES)


def listing(search: str = "") -> list[dict[str, str]]:
    """Catalog rows ``{name, type, help}``, optionally filtered by a substring of name or help."""
    needle = search.lower()
    return [
        {"name": name, "type": kind, "help": text}
        for name, (kind, text) in sorted(families().items())
        if not needle or needle in name.lower() or needle in text.lower()
    ]


def unknown_metrics(expr: str) -> list[str]:
    """netlab_* names in a PromQL expression that the collector does not export (typos, old names)."""
    known = families()
    return sorted({m for m in _METRIC.findall(expr) if m not in known})
