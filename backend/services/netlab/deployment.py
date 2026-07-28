"""In-memory registry for recent deployment runs.

Only compact node state and a bounded event ring are retained. Runs are keyed
by topology path and the registry is capped so a long-lived backend cannot grow
without bound as users open many labs.
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from threading import RLock

from services.netlab.progress import DeploymentProgressTracker

_MAX_RUNS = 32
_runs: OrderedDict[str, DeploymentProgressTracker] = OrderedDict()
_lock = RLock()


def _key(topology_path: str | Path) -> str:
    return str(Path(topology_path).resolve())


def start(topology_path: str | Path, action: str, nodes: list[str]) -> DeploymentProgressTracker:
    tracker = DeploymentProgressTracker(action, nodes)
    with _lock:
        key = _key(topology_path)
        _runs[key] = tracker
        _runs.move_to_end(key)
        while len(_runs) > _MAX_RUNS:
            _runs.popitem(last=False)
    return tracker


def get(topology_path: str | Path) -> DeploymentProgressTracker | None:
    with _lock:
        key = _key(topology_path)
        tracker = _runs.get(key)
        if tracker is not None:
            _runs.move_to_end(key)
        return tracker


def overview(topology_path: str | Path) -> dict[str, object]:
    tracker = get(topology_path)
    return tracker.payload() if tracker else {"available": False}


def node_detail(topology_path: str | Path, node: str) -> dict[str, object]:
    tracker = get(topology_path)
    return tracker.node_detail(node) if tracker else {"available": False, "node": node}


def log(topology_path: str | Path) -> dict[str, object]:
    tracker = get(topology_path)
    return tracker.log_payload() if tracker else {"available": False, "lines": []}
