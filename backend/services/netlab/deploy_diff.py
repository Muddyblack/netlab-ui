"""Persist and compare the topology source used by the last successful deploy."""

from __future__ import annotations

import difflib
from datetime import UTC, datetime
from pathlib import Path

from services import annotations as ann_store

BASELINE_KEY = "deploymentBaseline"


def record(topology_path: str | Path) -> None:
    path = str(topology_path)
    annotations = ann_store.load(path)
    annotations[BASELINE_KEY] = {
        "yaml": Path(path).read_text(),
        "recordedAt": datetime.now(UTC).isoformat(),
    }
    ann_store.save(path, annotations)


def compare(topology_path: str | Path) -> dict:
    path = str(topology_path)
    current = Path(path).read_text()
    baseline = ann_store.load(path).get(BASELINE_KEY)
    previous = baseline.get("yaml") if isinstance(baseline, dict) else None
    recorded_at = baseline.get("recordedAt") if isinstance(baseline, dict) else None
    if not isinstance(previous, str):
        return {
            "changed": True,
            "baselineExists": False,
            "recordedAt": None,
            "diff": "",
        }
    diff = "".join(
        difflib.unified_diff(
            previous.splitlines(keepends=True),
            current.splitlines(keepends=True),
            fromfile="last-deployed.yml",
            tofile=Path(path).name,
        )
    )
    return {
        "changed": previous != current,
        "baselineExists": True,
        "recordedAt": recorded_at,
        "diff": diff,
    }
