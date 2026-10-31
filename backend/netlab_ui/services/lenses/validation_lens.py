"""Turn the transformed topology's ``validate:`` block into a structured test
suite for the Validation dashboard.

Netlab resolves each validation test (description, target nodes, wait/show/exec/
plugin action, custom messages, ordering) into ``topology["validate"]``. We
render that as cards without needing a deployed lab, then overlay live PASS /
FAIL / WARN outcomes from :mod:`services.lenses.validation_results` when a
``netlab validate`` run is available.
"""

from __future__ import annotations

from typing import Any


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _test_kind(test: dict[str, Any]) -> str:
    if test.get("wait") is not None or test.get("wait_msg"):
        return "wait"
    if test.get("plugin"):
        return "plugin"
    if test.get("exec"):
        return "exec"
    if test.get("show"):
        return "show"
    if test.get("valid"):
        return "valid"
    return "custom"


def _action(test: dict[str, Any], kind: str) -> str:
    if kind == "plugin":
        return str(test.get("plugin"))
    if kind == "exec":
        return str(test.get("exec"))
    if kind == "show":
        return str(test.get("show"))
    if kind == "wait":
        return f"wait up to {test.get('wait')}s"
    if kind == "valid":
        return str(test.get("valid"))
    return ""


def build_validation(transformed: dict[str, Any], results: dict[str, Any]) -> dict[str, Any]:
    raw_tests = _list(transformed.get("validate"))
    node_names = set(_dict(transformed.get("nodes")).keys())
    result_map = _dict(results.get("results"))
    tests: list[dict[str, Any]] = []
    summary = {"total": 0, "passed": 0, "failed": 0, "warning": 0, "unknown": 0}

    for index, raw in enumerate(raw_tests):
        test = _dict(raw)
        name = str(test.get("name") or f"test-{index + 1}")
        # netlab may target nodes as a list or a single string; keep only nodes
        # that exist so canvas refs never dangle.
        targets_raw = test.get("nodes")
        targets = [targets_raw] if isinstance(targets_raw, str) else [str(node) for node in _list(targets_raw)]
        targets = [node for node in targets if node in node_names]
        kind = _test_kind(test)
        outcome = _dict(result_map.get(name))
        state = str(outcome.get("state") or "unknown")
        object_refs = [f"node:{node}" for node in targets] + [f"validation:{name}"]
        # A test can be softened to a warning via ``level: warning``; surface it
        # so the UI can down-rank a failure to amber.
        level = str(test.get("level") or "normal")
        if state == "failed" and level == "warning":
            state = "warning"
        summary["total"] += 1
        summary[state if state in summary else "unknown"] += 1
        tests.append(
            {
                "id": f"validation:{name}",
                "name": name,
                "description": str(test.get("description") or ""),
                "nodes": targets,
                "kind": kind,
                "action": _action(test, kind),
                "waitSeconds": test.get("wait") if isinstance(test.get("wait"), int) else None,
                "waitMessage": str(test.get("wait_msg")) if test.get("wait_msg") else None,
                "stopOnError": bool(test.get("stop_on_error")),
                "level": level,
                "state": state,
                "evidence": [str(line) for line in _list(outcome.get("evidence"))],
                "objectRefs": object_refs,
                "order": index + 1,
            }
        )

    return {
        "available": bool(raw_tests),
        "hasRun": bool(result_map),
        "ranAt": results.get("ranAt"),
        "tests": tests,
        "summary": summary,
    }
