"""Persistence for guided-tour documents (saved alongside the topology)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
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


# --------------------------------------------------------------------------- #
# Exercise checks: steps name `netlab validate` tests that prove the task.
# --------------------------------------------------------------------------- #
_TEST_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
CHECK_TIMEOUT_S = 300.0


def validation_tests(transformed: dict[str, Any]) -> list[dict[str, Any]]:
    """The lab's ``validate:`` tests, for picking a step's checks. The YAML
    writes them as a mapping; netlab's transformed topology holds a list of
    tests with a ``name`` key — accept both."""
    raw = transformed.get("validate")
    if isinstance(raw, dict):
        items = [(name, body) for name, body in raw.items()]
    elif isinstance(raw, list):
        items = [(body.get("name"), body) for body in raw if isinstance(body, dict) and body.get("name")]
    else:
        return []
    result = []
    for name, body in items:
        body = body if isinstance(body, dict) else {}
        nodes = body.get("nodes") if isinstance(body.get("nodes"), list) else []
        result.append(
            {"name": str(name), "description": str(body.get("description") or ""), "nodes": [str(n) for n in nodes]}
        )
    return result


async def check(topology_path: str | Path, tests: list[str]) -> dict[str, Any]:
    """Run just ``tests`` with ``netlab validate``; a step passes when every
    one of them does."""
    from services.netlab import runner

    from . import validation_results

    names = [name for name in tests if _TEST_NAME.fullmatch(name)]
    if not names or len(names) != len(tests):
        raise ValueError("invalid validation test name")
    try:
        result = await asyncio.wait_for(
            runner.run_command(["validate", *names], cwd=Path(topology_path).parent), CHECK_TIMEOUT_S
        )
    except TimeoutError:
        return {"passed": False, "tests": [{"name": n, "state": "unknown", "evidence": "timed out"} for n in names]}
    output = result.stdout + result.stderr
    parsed = validation_results.parse(output, names)
    rows = []
    for name in names:
        entry = parsed.get(name, {"state": "unknown", "evidence": []})
        state = entry["state"]
        if state == "unknown":
            # netlab's summary is authoritative when a section had no verdict.
            state = "passed" if result.code == 0 else "failed"
        rows.append({"name": name, "state": state, "evidence": "\n".join(entry.get("evidence") or [])})
    passed = result.code == 0 and all(row["state"] == "passed" for row in rows)
    return {"passed": passed, "tests": rows, "output": output[-4000:]}
