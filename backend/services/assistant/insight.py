"""Read-only lab insight for an attached agent: netlab reports, config comparisons,
per-test validation results and a one-call picture of a node.

Everything here reads what netlab and the UI already produce (the reports dialog, the
running-config snapshots, the Validation dashboard); nothing changes the lab.
"""

from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Any

from services.assistant.tools import ToolError, _addr, _cap, _lab_name, _session, _untrusted
from services.lenses import reports, validation_results
from services.netlab import config_snapshots, node_configs, runner

MAX_ROWS = 80
# Per-module node/interface keys worth showing; the full data model is `netlab_inspect`.
_IF_KEYS = ("ospf", "isis", "bgp", "vlan", "vrf", "mpls", "vxlan", "evpn", "bfd", "ipv6", "ipv4")


# --------------------------------------------------------------------- reports
async def get_reports(report: str = "", lab: str | None = None) -> dict[str, Any]:
    """netlab's reports (addressing, BGP neighbors, OSPF, wiring...) as tables. Without
    ``report``: the catalog; with a report id: its tables, the same ones the Reports dialog shows."""
    session = _session(lab)
    try:
        catalog = await reports.catalog(session.topology_path)
    except runner.NetlabNotInstalled as exc:
        raise ToolError(str(exc)) from exc
    except runner.NetlabError as exc:
        raise ToolError(f"netlab cannot list reports: {_cap(str(exc), 800)}") from exc
    if not report:
        return {
            "reports": [{"id": r["id"], "name": r["name"], "description": r.get("description", "")} for r in catalog]
        }
    try:
        result = await reports.run(session.topology_path, session.revision, report)
    except KeyError:
        raise ToolError(f"unknown report {report!r} -- call without `report` for the list") from None
    except runner.NetlabError as exc:
        raise ToolError(f"report failed: {_cap(str(exc), 800)}") from exc
    tables = []
    for table in result.get("tables") or []:
        rows = table.get("rows") or []
        entry: dict[str, Any] = {
            "title": table.get("title", ""),
            "columns": table.get("columns") or [],
            "rows": rows[:MAX_ROWS],
        }
        if len(rows) > MAX_ROWS:
            entry["truncated"] = f"{len(rows)} rows, first {MAX_ROWS} shown"
        tables.append(entry)
    out: dict[str, Any] = {"lab": _lab_name(session), "report": report}
    if tables:
        out["tables"] = tables
    else:
        out["text"] = _untrusted(_cap(str(result.get("raw") or "")))
    return out


# --------------------------------------------------------------------- configs
async def compare_configs(
    node: str = "", snapshot: str = "", against: str = "live", lab: str | None = None
) -> dict[str, Any]:
    """Compare a node's configuration between two points: a snapshot (default: the newest) and
    ``against`` (``live``, or another snapshot id). Without ``node``: which running nodes
    differ from the snapshot, and by how much. Without a usable snapshot: the snapshots there are."""
    session = _session(lab)
    path = session.topology_path
    available = config_snapshots.list_snapshots(path)
    listing = [{"id": s["id"], "at": s.get("createdAt"), "reason": s.get("reason")} for s in available]
    if not available:
        return {
            "snapshots": [],
            "note": "no config snapshot yet -- one is taken after each deploy, or by the user in netlab-ui",
        }
    snapshot = snapshot or str(available[0]["id"])
    if snapshot not in {str(s["id"]) for s in available}:
        raise ToolError(f"no snapshot {snapshot!r}; available: {[s['id'] for s in available[:10]]}")
    if against != "live" and against not in {str(s["id"]) for s in available}:
        raise ToolError(f"`against` is 'live' or a snapshot id, not {against!r}")
    try:
        if not node:
            if against != "live":
                raise ToolError(
                    "a lab-wide comparison is against the live configs; name a node to compare two snapshots"
                )
            rows = await config_snapshots.drift(path, snapshot)
            return {
                "snapshot": snapshot,
                "changed": {r["node"]: f"+{r['added']} -{r['removed']}" for r in rows if r["status"] == "changed"},
                "unchanged": sorted(r["node"] for r in rows if r["status"] == "same"),
                "other": {r["node"]: r["status"] for r in rows if r["status"] not in ("changed", "same")},
                "snapshots": listing[:10],
            }
        old = config_snapshots.read_snapshot(path, snapshot, node)
        if against == "live":
            new = (await config_snapshots.fetch_running(path, [node])).get(node)
        else:
            new = config_snapshots.read_snapshot(path, against, node)
    except runner.NetlabError as exc:
        raise ToolError(f"lab status unavailable: {_cap(str(exc), 500)}") from exc
    if old is None or new is None:
        raise ToolError(f"no configuration for {node!r} on one side of the comparison (is the node running?)")
    diff = "".join(
        difflib.unified_diff(
            config_snapshots.normalize(old).splitlines(True),
            config_snapshots.normalize(new).splitlines(True),
            f"snapshot {snapshot}",
            against if against == "live" else f"snapshot {against}",
            n=2,
        )
    )
    return {
        "node": node,
        "snapshot": snapshot,
        "against": against,
        "diff": _untrusted(_cap(diff)) if diff else "(identical)",
    }


# ------------------------------------------------------------------ validation
async def get_validation_results(run: bool = False, lab: str | None = None) -> dict[str, Any]:
    """Per-test results of the lab's `validate:` tests (passed/failed/warning with the evidence
    netlab printed). ``run=True`` runs `netlab validate` now against the running lab (can take
    minutes; tests wait for convergence); otherwise the last run's results are returned."""
    session = _session(lab)
    path = session.topology_path
    if run:
        try:
            result = await runner.validate(path)
        except runner.NetlabNotInstalled as exc:
            raise ToolError(str(exc)) from exc
        output = f"{result.stdout}\n{result.stderr}"
        if "No validation tests defined" in output:
            return {"tests": {}, "note": "this lab defines no validation tests (no `validate:` section)"}
        from app.lab import lifecycle

        await lifecycle._store_validation_results(path, output)
    cached = validation_results.current(path)
    tests = cached.get("results") or {}
    if not tests:
        if run:  # netlab ran but its output named no known test: show it rather than nothing
            return {"tests": {}, "passed": result.code == 0, "output": _untrusted(_cap(output.strip()))}
        return {
            "tests": {},
            "hint": "no results yet: call with run=True (the lab must be running and define `validate:` tests)",
        }
    counts: dict[str, int] = {}
    for entry in tests.values():
        counts[entry["state"]] = counts.get(entry["state"], 0) + 1
    return {
        **({"passed": result.code == 0} if run else {}),
        "ranAt": cached.get("ranAt"),
        "counts": counts,
        "tests": {
            name: {"state": entry["state"], "evidence": _untrusted("\n".join(entry.get("evidence") or []))}
            if entry["state"] != "passed"
            else {"state": "passed"}
            for name, entry in tests.items()
        },
    }


# ----------------------------------------------------------------- explain_node
def _compact(value: Any, depth: int = 0) -> Any:
    """A module's settings without netlab's bulk: short scalars and shallow lists/dicts."""
    if isinstance(value, dict):
        if depth >= 2:
            return f"{{{len(value)} keys}}"
        return {k: _compact(v, depth + 1) for k, v in list(value.items())[:20]}
    if isinstance(value, list):
        return [_compact(v, depth + 1) for v in value[:12]] + ([f"…{len(value) - 12} more"] if len(value) > 12 else [])
    return value


async def explain_node(node: str, lab: str | None = None) -> dict[str, Any]:
    """Everything about one node in a single answer: what it is, the modules netlab configures on
    it (OSPF, BGP, VLANs...) with their settings, each interface with its address, neighbor and
    module attributes, its state, and the generated config files (read them with get_node_configs)."""
    session = _session(lab)
    try:
        artifact = await runner.create(session.topology_path)
    except runner.NetlabNotInstalled as exc:
        raise ToolError(str(exc)) from exc
    except runner.NetlabError as exc:
        raise ToolError(f"netlab create failed -- the topology has errors: {_cap(str(exc), 1500)}") from exc
    model = artifact.get("snapshot") if isinstance(artifact, dict) else None
    nodes = model.get("nodes") if isinstance(model, dict) else None
    if not isinstance(nodes, dict) or node not in nodes:
        raise ToolError(f"no such node {node!r}; nodes: {sorted(nodes or {})}")
    data = nodes[node]
    modules = [str(m) for m in data.get("module") or []]
    interfaces = []
    for iface in data.get("interfaces") or []:
        entry: dict[str, Any] = {"ifname": iface.get("ifname")}
        if address := _addr(iface):
            entry["ip"] = address
        if neighbors := iface.get("neighbors"):
            entry["to"] = ", ".join(f"{n.get('node')}:{n.get('ifname')}" for n in neighbors)
        if iface.get("type"):
            entry["type"] = iface["type"]
        for key in _IF_KEYS:
            if key in iface and key not in ("ipv4", "ipv6") and iface[key] not in (None, False, {}):
                entry[key] = _compact(iface[key])
        interfaces.append(entry)
    result: dict[str, Any] = {
        "lab": _lab_name(session),
        "node": node,
        "device": data.get("device"),
        "role": data.get("role"),
        "image": data.get("image"),
        "provider": data.get("provider") or (model or {}).get("provider"),
        "mgmt": _addr(data.get("mgmt")),
        "loopback": _addr(data.get("loopback")),
        "modules": {m: _compact(data.get(m)) for m in modules if data.get(m) not in (None, {})} or modules,
        "interfaces": interfaces,
    }
    for key in ("bgp", "vrfs", "vlans", "groups"):
        if key not in modules and data.get(key):
            result[key] = _compact(data[key])
    try:
        status = await runner.status_for(session.topology_path)
        info = ((status or {}).get("nodes") or {}).get(node) if isinstance(status, dict) else None
        if isinstance(info, dict):
            result["state"] = runner.normalize_node_state(info.get("status"))
    except (runner.NetlabError, OSError, json.JSONDecodeError):
        pass
    files = node_configs.list_files(Path(session.topology_path).parent, node)
    result["config_files"] = [f["name"] for f in files if f["group"] != "Node data"]
    result["next"] = "get_node_configs(node, file) reads a generated config; run_show_command checks the live state"
    return {k: v for k, v in result.items() if v not in (None, "", [], {})}
