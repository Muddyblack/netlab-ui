"""Build the ``TopologySnapshot`` that ``@srl-labs/clab-ui`` renders.

clab-ui's integrator contract (INTEGRATORS.md) expects a snapshot shaped roughly
as::

    { nodes, edges, annotations, yaml, revision, deploymentState }

We assemble it from three sources:
  * **nodes/edges** — the clab projection produced by ``netlab create -o clab``
    (rendering the netlab→clab transform means clab-ui's own clab schema/icons
    "just work"); falls back to the netlab snapshot's own node/link data.
  * **annotations** — node positions etc. from the sidecar store (never the YAML).
  * **deploymentState** — per-node running state from ``netlab status``.

When netlab is not installed we serve a small static fixture so the UI and the
clab-ui integration can be developed end-to-end locally with zero setup.
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Any

from services import annotations as ann_store
from services.model import serialize
from services.model.topology import Topology
from services.netlab import runner
from services.netlab import validation as validation_store

# Cache clab projection results by (topology_path, yaml_md5) so we only call
# `runner.create()` when the YAML actually changes.  Position moves and other
# annotation-only commands never touch the YAML, so they get a free snapshot.
# The cache is process-wide; the bounded dict prevents unbounded memory growth.
_MAX_CACHE = 32
_clab_cache: dict[str, tuple[str, list[dict], list[dict]]] = {}

# In-flight background `netlab create` transforms, keyed by topology path.
# A cache miss serves the fast model-derived projection immediately (the UI
# stays usable) and warms the cache here; the snapshot carries
# ``transformPending: true`` so the frontend knows to re-request later.
_transform_tasks: dict[str, asyncio.Task] = {}


def _store_cache(topology_path: str, yaml_hash: str, nodes: list[dict], edges: list[dict]) -> None:
    if not yaml_hash:
        return
    if len(_clab_cache) >= _MAX_CACHE:
        _clab_cache.pop(next(iter(_clab_cache)))
    _clab_cache[topology_path] = (yaml_hash, nodes, edges)


def _schedule_transform(topology_path: str, yaml_hash: str, fallback: tuple[list[dict], list[dict]]) -> None:
    """Warm the clab-projection cache in the background (deduped per path).

    On `netlab create` failure the model-derived ``fallback`` is cached instead
    so the failing command is not retried until the YAML changes."""
    task = _transform_tasks.get(topology_path)
    if task and not task.done():
        return

    async def _work() -> None:
        try:
            locked = (Path(topology_path).parent / "netlab.lock").exists()
            if locked:
                # `netlab create` refuses to run while the lab is deployed, and
                # `runner.create()` transparently substitutes `netlab inspect`
                # (the *running* instance) instead of raising. That reflects
                # containers as deployed, not the edit that was just made but
                # not yet redeployed — caching it here would overwrite the
                # correct, just-edited `fallback` a few seconds later and make
                # in-progress edits appear to silently revert. Keep serving the
                # model-derived fallback until the lab is redeployed (new
                # netlab.lock state) or torn down.
                nodes, edges = fallback
            else:
                try:
                    result = await runner.create(topology_path)
                    clab = result.get("clab")
                    nodes, edges = _nodes_edges_from_clab(clab) if clab else fallback
                except (runner.NetlabError, runner.NetlabNotInstalled) as exc:
                    if topology_path not in _clab_cache:
                        # Never built successfully for this path yet (e.g. right
                        # after a backend restart, before any snapshot request
                        # has run `netlab create`). Use the clab.yml written at
                        # the last deploy so the canvas isn't blank — vital for
                        # plugin-generated topologies whose raw YAML has no
                        # nodes.
                        clab = runner.read_existing_clab(topology_path)
                        nodes, edges = _nodes_edges_from_clab(clab) if clab else fallback
                    else:
                        # We've built successfully before, so this failure means
                        # the edit that was just made is what broke `netlab
                        # create` (e.g. a bad interface assignment on a new
                        # link). Silently substituting the old deployed
                        # projection would drop that edit's node/link from the
                        # canvas with no indication anything is wrong — keep
                        # serving the live model-derived fallback instead (it at
                        # least reflects the edit) and surface the real error.
                        nodes, edges = fallback
                        if isinstance(exc, runner.NetlabError):
                            validation_store.store_failure(topology_path, exc.stderr or str(exc))
            _store_cache(topology_path, yaml_hash, nodes, edges)
        finally:
            _transform_tasks.pop(topology_path, None)

    _transform_tasks[topology_path] = asyncio.create_task(_work())


def _nodes_edges_from_clab(clab: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    topo = (clab or {}).get("topology", {})
    nodes = [
        {"id": name, "kind": (body or {}).get("kind"), "data": body or {}}
        for name, body in (topo.get("nodes") or {}).items()
    ]
    edges = []
    for i, link in enumerate(topo.get("links") or []):
        eps = link.get("endpoints") or []
        # Extract node names and interface names
        source_parts = eps[0].split(":") if len(eps) > 0 and isinstance(eps[0], str) else ["", ""]
        target_parts = eps[1].split(":") if len(eps) > 1 and isinstance(eps[1], str) else ["", ""]

        source_node = (
            source_parts[0]
            if len(eps) > 0 and isinstance(eps[0], str)
            else (eps[0].get("node") if len(eps) > 0 and isinstance(eps[0], dict) else "")
        )
        target_node = (
            target_parts[0]
            if len(eps) > 1 and isinstance(eps[1], str)
            else (eps[1].get("node") if len(eps) > 1 and isinstance(eps[1], dict) else "")
        )
        source_iface = source_parts[1] if len(source_parts) > 1 else ""
        target_iface = target_parts[1] if len(target_parts) > 1 else ""

        if source_node and target_node:
            edges.append(
                {
                    "id": f"e{i}",
                    "source": source_node,
                    "target": target_node,
                    "data": {"sourceEndpoint": source_iface or "", "targetEndpoint": target_iface or ""},
                }
            )
    return nodes, edges


def _nodes_edges_from_model(topo: Topology) -> tuple[list[dict], list[dict]]:
    """Build edges from netlab model. Since netlab links don't have explicit interface
    names (those are assigned during 'netlab create'), we use empty strings to avoid
    displaying misleading interface labels. The links will render on canvas without
    endpoint text until actual deployment."""
    nodes = [{"id": n.name, "kind": n.device, "data": dict(n.attrs)} for n in topo.nodes]
    edges = []

    for i, link in enumerate(topo.links):
        if len(link.endpoints) >= 2:
            source = link.endpoints[0]
            target = link.endpoints[1]

            # Surface any interface names the user pinned via the Link Editor
            # (stored as ``ifname`` on the explicit ``interfaces:`` form) so they
            # survive a snapshot refresh instead of reverting to empty.
            ifname_by_node = {
                iface.get("node"): iface.get("ifname", "")
                for iface in (link.attrs.get("interfaces") or [])
                if isinstance(iface, dict)
            }

            edges.append(
                {
                    "id": f"e{i}",
                    "source": source,
                    "target": target,
                    "data": {
                        "sourceEndpoint": ifname_by_node.get(source, "") or "",
                        "targetEndpoint": ifname_by_node.get(target, "") or "",
                    },
                }
            )
    return nodes, edges


def _apply_scope(
    nodes: list[dict], edges: list[dict], topo: Topology, scope: dict | None
) -> tuple[list[dict], list[dict]]:
    """Level-of-detail: collapse the named groups into single super-nodes so the
    canvas never has to render a huge flat graph. ``scope`` is
    ``{"collapsed": [group, ...]}``."""
    collapsed = set((scope or {}).get("collapsed", []))
    if not collapsed:
        return nodes, edges
    # Map each collapsed group's members (recursively) to the super-node id.
    member_to_super: dict[str, str] = {}
    for gname in collapsed:
        for member in _flatten_members(topo, gname):
            member_to_super[member] = f"group:{gname}"

    def remap(nid: str) -> str:
        return member_to_super.get(nid, nid)

    kept_nodes = {remap(n["id"]): n for n in nodes if n["id"] not in member_to_super}
    for gname in collapsed:
        kept_nodes[f"group:{gname}"] = {"id": f"group:{gname}", "kind": "group", "data": {"group": gname}}
    new_edges = []
    seen = set()
    for e in edges:
        s, t = remap(e["source"]), remap(e["target"])
        if s == t:
            continue
        key = tuple(sorted((s, t)))
        if key in seen:
            continue
        seen.add(key)
        new_edges.append({"id": f"{s}__{t}", "source": s, "target": t})
    return list(kept_nodes.values()), new_edges


def _flatten_members(topo: Topology, group_name: str) -> list[str]:
    """Resolve a group's members to leaf node names, descending into nested
    member groups."""
    group = topo.group(group_name)
    if group is None:
        return []
    leaves: list[str] = []
    for m in group.members:
        if topo.group(m) is not None:
            leaves.extend(_flatten_members(topo, m))
        else:
            leaves.append(m)
    return leaves


async def build(
    topology_path: str,
    topo: Topology,
    revision: int,
    scope: dict | None = None,
    mode: str = "edit",
    can_undo: bool = False,
    can_redo: bool = False,
) -> dict[str, Any]:
    import json

    annotations = ann_store.load(topology_path)
    deployment_state: dict[str, Any] = {}

    nodes: list[dict]
    edges: list[dict]
    lab_registered = False
    transform_pending = False
    if runner.is_installed():
        try:
            # Hash the YAML to avoid re-running `netlab create` on every snapshot
            # request (e.g. position moves don't change the YAML).
            try:
                yaml_hash = hashlib.md5(Path(topology_path).read_bytes()).hexdigest()
            except OSError:
                yaml_hash = ""

            cached = _clab_cache.get(topology_path)
            if cached and cached[0] == yaml_hash and yaml_hash:
                nodes, edges = cached[1], cached[2]
            else:
                # Serve the fast model-derived projection right away and run
                # the (potentially slow) `netlab create` transform in the
                # background — opening a lab must never block on netlab.
                nodes, edges = _nodes_edges_from_model(topo)
                if yaml_hash:
                    transform_pending = True
                    _schedule_transform(topology_path, yaml_hash, (nodes, edges))
        except runner.NetlabNotInstalled:
            nodes, edges = _nodes_edges_from_model(topo)
        try:
            # status_cached: the SSE poller refreshes status every 5 s anyway;
            # re-running the CLI here would add ~4 s to every snapshot.
            deployment_state = _state_from_status(await runner.status_for(topology_path), topo.name)
        except (runner.NetlabError, runner.NetlabNotInstalled):
            deployment_state = {}
        lab_registered = await _has_instance_record(topology_path)
    else:
        nodes, edges = _nodes_edges_from_model(topo)

    nodes, edges = _apply_scope(nodes, edges, topo, scope)
    validation_issues = validation_store.current(topology_path)
    node_issues: dict[str, list[dict[str, Any]]] = {}
    link_issues: dict[frozenset[str], list[dict[str, Any]]] = {}
    for issue in validation_issues:
        payload = issue.as_dict()
        if issue.entity_type == "node" and issue.entity_id:
            node_issues.setdefault(issue.entity_id, []).append(payload)
        elif issue.entity_type == "link" and issue.entity_id:
            link_issues.setdefault(frozenset(issue.entity_id.split("--", 1)), []).append(payload)

    # Sidecar view-state, applied back onto the canvas nodes so drags/icons/
    # group membership actually persist across reloads (the YAML stays clean).
    node_view: dict[str, dict[str, Any]] = {
        n["id"]: n for n in (annotations.get("nodeAnnotations") or []) if isinstance(n, dict) and n.get("id")
    }

    # Reconcile node fields for the canvas
    for node in nodes:
        node_id = node["id"]
        node["type"] = "topology-node"
        saved_pos = node_view.get(node_id, {}).get("position")
        if isinstance(saved_pos, dict) and "x" in saved_pos and "y" in saved_pos:
            node["position"] = {"x": saved_pos["x"], "y": saved_pos["y"]}
        elif "position" not in node:
            node["position"] = {"x": 0, "y": 0}
        if "data" not in node or not isinstance(node["data"], dict):
            node["data"] = {}
        # clab provider projections focus on runtime/container fields. Merge
        # the source model back in so custom editor tabs see the declarative
        # netlab modules and attributes the user actually authored.
        source_node = topo.node(node_id)
        if source_node is not None:
            node["data"].update(source_node.attrs)
            if source_node.device:
                node["data"]["device"] = source_node.device
        if "label" not in node["data"]:
            node["data"]["label"] = node_id
        if "role" not in node["data"]:
            # The netlab device name (e.g. "frr") vs. its clab projection's
            # kind (e.g. "linux" — see test_kind_image_references.py) diverge
            # for many devices. Deriving the default icon from whichever
            # projection happens to be active makes it flip when the
            # background `netlab create` transform swaps the fallback
            # rendering for the real one. Anchor it to the stable netlab
            # device name instead so the icon never changes across that swap.
            node["data"]["role"] = (source_node.device if source_node else None) or node.get("kind") or "router"
        saved_icon = node_view.get(node_id, {}).get("icon")
        if saved_icon:
            node["data"]["topoViewerRole"] = saved_icon
            node["data"]["role"] = saved_icon
        saved_group = node_view.get(node_id, {}).get("groupId")
        if saved_group:
            node["data"]["groupId"] = saved_group
            node["data"]["group"] = saved_group
        node["data"]["state"] = deployment_state.get(node_id, "undeployed")
        if node_id in node_issues:
            node["data"].setdefault("extraData", {})["validationIssues"] = node_issues[node_id]
            # clab-ui's public node data contract exposes iconColor; use it to
            # make invalid nodes visibly badged without replacing its renderer.
            node["data"]["iconColor"] = "#d32f2f"

    # Reconcile edge fields for the canvas. clab-ui renders edges with the custom
    # "topology-edge" React Flow type (thick status-coloured links); without this
    # type React Flow falls back to its built-in default edge — a thin grey 1px
    # line. Locally-created edges already carry the type, so an untyped snapshot
    # makes links flip to thin lines on the next refresh. Tag every edge here so
    # the type survives every reload, mirroring node["type"] above.
    for edge in edges:
        edge["type"] = "topology-edge"
        if "data" not in edge or not isinstance(edge["data"], dict):
            edge["data"] = {"sourceEndpoint": "", "targetEndpoint": ""}
        issues = link_issues.get(frozenset((edge.get("source", ""), edge.get("target", ""))))
        if issues:
            edge["data"].setdefault("extraData", {})["validationIssues"] = issues
            edge["data"]["linkStatus"] = "down"

    # A lab counts as deployed while netlab holds an instance record for its
    # directory — even if every container is gone (e.g. a `netlab up` that
    # crashed mid-deploy). Destroy/cleanup must stay available in that state,
    # otherwise the stale record can never be cleared from the UI.
    is_deployed = (
        "deployed" if lab_registered or any(n == "running" for n in deployment_state.values()) else "undeployed"
    )
    # Serve the raw file content so the YAML tab always mirrors what's on disk
    # exactly (not a parse→re-serialize round-trip which would drop formatting).
    try:
        yaml_content = Path(topology_path).read_text()
    except Exception:  # noqa: BLE001 — any read failure falls back to a re-serialized YAML
        yaml_content = serialize.to_yaml(topo)

    return {
        "revision": revision,
        "nodes": nodes,
        "edges": edges,
        "annotations": annotations,
        "yamlFileName": Path(topology_path).name,
        "annotationsFileName": f"{Path(topology_path).name}.annotations.json",
        "yamlContent": yaml_content,
        # This string feeds clab-ui's read/edit source tab. Keep it human-readable;
        # the structured ``annotations`` value remains the source of truth.
        "annotationsContent": json.dumps(annotations, indent=2),
        "labName": topo.name,
        "mode": mode,
        "deploymentState": is_deployed,
        "canUndo": can_undo,
        "canRedo": can_redo,
        # True while a background `netlab create` is warming the projection
        # cache; the frontend re-requests the snapshot until this clears.
        "transformPending": transform_pending,
        "validationIssues": [issue.as_dict() for issue in validation_issues],
    }


async def _has_instance_record(topology_path: str) -> bool:
    """True when ``netlab status --all`` lists an instance whose lab directory
    contains ``topology_path``. Instance summaries only carry ``dir`` (no lab
    name, no topology path), so the directory is the one reliable join key."""
    try:
        instances = await runner.status_cached()
    except (runner.NetlabError, runner.NetlabNotInstalled):
        return False
    if not isinstance(instances, dict):
        return False
    lab_dir = str(Path(topology_path).resolve().parent)
    return any(
        isinstance(lab, dict) and str(Path(str(lab["dir"])).resolve()) == lab_dir
        for lab in instances.values()
        if isinstance(lab, dict) and lab.get("dir")
    )


def _state_from_status(status: Any, lab_name: str) -> dict[str, Any]:
    """Flatten ``netlab status --format json`` into ``{node: state}`` for the
    lab named ``lab_name`` only — two labs can both have an ``r1``, so merging
    every running lab's nodes would cross-contaminate deployment state."""
    out: dict[str, Any] = {}
    if isinstance(status, dict) and isinstance(status.get("nodes"), dict):
        return {node: runner.normalize_node_state((info or {}).get("status")) for node, info in status["nodes"].items()}
    labs = status if isinstance(status, dict) else {}
    for key, lab in labs.items():
        if not isinstance(lab, dict):
            continue
        if lab_name and key != lab_name and lab.get("name") != lab_name:
            continue
        for node, info in (lab.get("nodes") or {}).items():
            out[node] = runner.normalize_node_state((info or {}).get("status"))
    return out


STATIC_FIXTURE: dict[str, Any] = {
    "revision": 0,
    "nodes": [
        {
            "id": "r1",
            "type": "topology-node",
            "kind": "frr",
            "position": {"x": 0, "y": 0},
            "data": {"label": "r1", "role": "router", "state": "undeployed", "device": "frr"},
        },
        {
            "id": "r2",
            "type": "topology-node",
            "kind": "frr",
            "position": {"x": 240, "y": 0},
            "data": {"label": "r2", "role": "router", "state": "undeployed", "device": "frr"},
        },
    ],
    "edges": [
        {
            "id": "e0",
            "source": "r1",
            "target": "r2",
            "type": "topology-edge",
            "data": {"sourceEndpoint": "", "targetEndpoint": ""},
        }
    ],
    "annotations": {
        "nodeAnnotations": [{"id": "r1", "position": {"x": 0, "y": 0}}, {"id": "r2", "position": {"x": 240, "y": 0}}]
    },
    "yamlFileName": "lab.yml",
    "annotationsFileName": "lab.yml.annotations.json",
    "yamlContent": "name: spike\nnodes:\n  r1:\n    device: frr\n  r2:\n    device: frr\nlinks:\n  - r1-r2\n",
    "annotationsContent": (
        '{"nodeAnnotations": [{"id": "r1", "position": {"x": 0, "y": 0}}, '
        '{"id": "r2", "position": {"x": 240, "y": 0}}]}'
    ),
    "labName": "spike",
    "mode": "edit",
    "deploymentState": "undeployed",
    "canUndo": False,
    "canRedo": False,
}
