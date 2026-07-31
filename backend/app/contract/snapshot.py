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
import copy
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from services import annotations as ann_store
from services import events
from services.model import serialize
from services.model.edge_ids import EdgeIdCounter, edge_id
from services.model.topology import Topology
from services.netlab import runner
from services.netlab import validation as validation_store

# Where a canvas projection came from — and, for the previews, why it is only an
# approximation of the real ``netlab create`` transform. This reaches the UI in
# the snapshot's ``projection.source``, so "why does the canvas look like that?"
# is answerable instead of guesswork.
ProjectionSource = Literal[
    # The real `netlab create -o clab` transform.
    "clab",
    # Derived from the netlab model because the lab is deployed and
    # `netlab create` refuses to run in a locked directory.
    "locked-preview",
    # Derived from the netlab model because `netlab create` failed.
    "failed-preview",
    # The live blend served while a transform runs: the model's element set over
    # the previous real projection's bodies (see `_merge_projections`).
    "blended",
    # Straight off the netlab model, with no real projection to blend onto —
    # a lab that has never been transformed, or netlab not installed at all.
    "model",
]


@dataclass(frozen=True, slots=True)
class _CachedProjection:
    """A canvas projection plus the provenance that decides when it goes stale."""

    yaml_hash: str
    nodes: list[dict]
    edges: list[dict]
    source: ProjectionSource

    def is_fresh(self, yaml_hash: str, *, locked: bool) -> bool:
        """Whether this entry can still be served as-is.

        A ``locked-preview`` is only a stand-in for a transform that could not
        run. Once the lock clears the real transform has to happen, so matching
        the YAML hash is not enough to keep serving it — otherwise the canvas
        stays on the preview forever after the lab is torn down.

        A ``failed-preview`` *does* stay valid while the hash matches: the YAML
        on disk is what broke `netlab create`, so re-running it on every
        snapshot request would just be a retry storm.
        """
        if not yaml_hash or self.yaml_hash != yaml_hash:
            return False
        return self.source != "locked-preview" or locked


# Cache clab projection results by (topology_path, yaml_md5) so we only call
# `runner.create()` when the YAML actually changes.  Position moves and other
# annotation-only commands never touch the YAML, so they get a free snapshot.
# The cache is process-wide; the bounded dict prevents unbounded memory growth.
_MAX_CACHE = 32
_clab_cache: dict[str, _CachedProjection] = {}

# In-flight background `netlab create` transforms, keyed by topology path.
# A cache miss serves the fast blended projection immediately (the UI stays
# usable) and warms the cache here; the snapshot carries ``projection.pending``
# so the frontend knows to pick the result up.
_transform_tasks: dict[str, asyncio.Task] = {}

# Last `netlab create` failure per topology path, as ``(yaml_hash, message)``.
# A failed transform still caches a usable projection (see `_schedule_transform`),
# so without this the canvas just quietly swaps renderers and the user is left
# guessing why the topology looks wrong. Keyed by hash so the error clears itself
# as soon as the YAML that caused it is edited.
_transform_errors: dict[str, tuple[str, str]] = {}


def _is_locked(topology_path: str) -> bool:
    """True while netlab holds the lab directory, i.e. the lab is deployed.

    ``netlab create`` refuses to run in a locked directory, so this gates both
    the background transform and cache validity. Deliberately read fresh at each
    call site rather than passed around: the lock can appear or clear between a
    snapshot request and the background transform that request scheduled, and
    each decision wants the state as it is at *its* moment.
    """
    return (Path(topology_path).parent / "netlab.lock").exists()


def _store_cache(
    topology_path: str,
    yaml_hash: str,
    nodes: list[dict],
    edges: list[dict],
    source: ProjectionSource,
) -> None:
    if not yaml_hash:
        return
    if len(_clab_cache) >= _MAX_CACHE:
        _clab_cache.pop(next(iter(_clab_cache)))
    _clab_cache[topology_path] = _CachedProjection(yaml_hash, nodes, edges, source)


def _schedule_transform(topology_path: str, yaml_hash: str, fallback: tuple[list[dict], list[dict]]) -> None:
    """Warm the clab-projection cache in the background (deduped per path).

    On `netlab create` failure the model-derived ``fallback`` is cached instead
    so the failing command is not retried until the YAML changes."""
    task = _transform_tasks.get(topology_path)
    if task and not task.done():
        return

    async def _work() -> None:
        try:
            try:
                # ``isolated=True`` runs the transform from a scratch directory
                # with an absolute topology path. netlab still resolves
                # lab-relative plugins and templates (its ``topology:`` search
                # path), so the transform is faithful, but nothing is written to
                # the lab directory — and it works on a *deployed* lab, because
                # netlab's locked-directory refusal is against the cwd. A
                # deployed lab's pending edits therefore get a real clab
                # projection instead of the model-derived preview this used to
                # fall back to.
                result = await runner.create(topology_path, isolated=True)
                clab = result.get("clab")
                nodes, edges = _nodes_edges_from_clab(clab) if clab else fallback
                source: ProjectionSource = "clab" if clab else "failed-preview"
                _transform_errors.pop(topology_path, None)
            except (runner.NetlabError, runner.NetlabNotInstalled) as exc:
                # Record the failure before choosing a fallback projection.
                # Every branch below still produces a renderable canvas, so this
                # message is the only signal the user gets that what they are
                # looking at is not the real transform.
                _transform_errors[topology_path] = (
                    yaml_hash,
                    (exc.stderr or str(exc)) if isinstance(exc, runner.NetlabError) else str(exc),
                )
                if isinstance(exc, runner.NetlabError):
                    validation_store.store_failure(topology_path, exc.stderr or str(exc))
                if _is_locked(topology_path):
                    # The isolated transform is expected to work while the lab is
                    # deployed, but deployment state is still the most likely
                    # reason for it not to. Classify it as a locked preview
                    # rather than a YAML failure so it is retried as soon as the
                    # lab is torn down, instead of waiting for an edit that may
                    # never come.
                    nodes, edges = fallback
                    source = "locked-preview"
                elif topology_path not in _clab_cache:
                    # Never built successfully for this path yet (e.g. right
                    # after a backend restart, before any snapshot request has
                    # run `netlab create`). Use the clab.yml written at the last
                    # deploy so the canvas isn't blank — vital for
                    # plugin-generated topologies whose raw YAML has no nodes.
                    clab = runner.read_existing_clab(topology_path)
                    nodes, edges = _nodes_edges_from_clab(clab) if clab else fallback
                    source = "clab" if clab else "failed-preview"
                else:
                    # We've built successfully before, so this failure means the
                    # edit that was just made is what broke `netlab create` (e.g.
                    # a bad interface assignment on a new link). Silently
                    # substituting the old deployed projection would drop that
                    # edit's node/link from the canvas with no indication
                    # anything is wrong — keep serving the live model-derived
                    # fallback instead (it at least reflects the edit) and
                    # surface the real error.
                    nodes, edges = fallback
                    source = "failed-preview"
            _store_cache(topology_path, yaml_hash, nodes, edges, source)
        except Exception as exc:  # noqa: BLE001
            # A transform can fail in ways `runner.create` does not wrap — an
            # unparseable JSON dump, an unreadable clab.yml, a disappearing lab
            # directory. Left unhandled these vanish into the asyncio task and
            # nothing is ever cached, so every snapshot re-runs the failing
            # transform forever. Cache the fallback and report the error.
            _transform_errors[topology_path] = (yaml_hash, str(exc))
            _store_cache(topology_path, yaml_hash, *fallback, "failed-preview")
        finally:
            _transform_tasks.pop(topology_path, None)
            # Tell the UI the projection is ready instead of making it poll for
            # it. A blind poll pays its full interval even when the transform
            # took 400 ms, which is the bulk of the lag between an edit and the
            # canvas settling. The frontend keeps a slow timer as a backstop for
            # a dropped SSE connection.
            events.hub.publish({"type": "transform", "path": topology_path})

    _transform_tasks[topology_path] = asyncio.create_task(_work())


def _nodes_edges_from_clab(clab: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    topo = (clab or {}).get("topology", {})
    nodes = [
        {"id": name, "kind": (body or {}).get("kind"), "data": body or {}}
        for name, body in (topo.get("nodes") or {}).items()
    ]
    edges = []
    seen: EdgeIdCounter = {}
    for link in topo.get("links") or []:
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
                    "id": edge_id(source_node, target_node, seen),
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
    seen: EdgeIdCounter = {}

    for link in topo.links:
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
                    "id": edge_id(source, target, seen),
                    "source": source,
                    "target": target,
                    "data": {
                        "sourceEndpoint": ifname_by_node.get(source, "") or "",
                        "targetEndpoint": ifname_by_node.get(target, "") or "",
                    },
                }
            )
    return nodes, edges


def _merge_projections(
    model: tuple[list[dict], list[dict]], base: tuple[list[dict], list[dict]]
) -> tuple[list[dict], list[dict]]:
    """Element *set* from the live model, element *bodies* from a real clab
    projection wherever the ids match.

    This is what the canvas gets while a background ``netlab create`` is still
    running. Serving the raw model projection there means every node and edge
    is momentarily re-described by a different source — kinds, interface labels
    and link styling all change and then change back a second later, which
    reads as the canvas glitching. Serving the previous clab projection
    unchanged is worse: an edit the user just made (a new link, a deleted node)
    would vanish until the transform lands.

    Taking the set from the model and the bodies from clab gives both: the edit
    shows up immediately, and everything that already existed keeps the exact
    description it is already being rendered with, so nothing flickers. Ids are
    endpoint-derived (see ``services.model.edge_ids``), which is what lets the
    two projections recognise each other's elements at all.

    Elements the clab transform synthesizes and the model has no name for
    (bridge nodes for multi-access links, say) are not carried over — the model
    is authoritative about what exists, otherwise deletions would not stick.
    Those reappear when the transform completes, exactly as they do today.
    """
    model_nodes, model_edges = model
    base_nodes, base_edges = base
    base_by_node = {n.get("id"): n for n in base_nodes}
    base_by_edge = {e.get("id"): e for e in base_edges}
    # Deep-copied: `build()` reconciles these dicts in place, and the base ones
    # are still owned by `_clab_cache`.
    nodes = [copy.deepcopy(base_by_node[n["id"]]) if n["id"] in base_by_node else n for n in model_nodes]
    edges = [copy.deepcopy(base_by_edge[e["id"]]) if e["id"] in base_by_edge else e for e in model_edges]
    return nodes, edges


def _existing_clab_projection(topology_path: str) -> tuple[list[dict], list[dict]] | None:
    """The clab projection written to disk by the last deploy, if any.

    Used as the blend base the first time a lab is opened, when nothing is
    cached yet. That is the moment the source swap is most visible — the canvas
    paints, then repaints — and a previously deployed lab already has the real
    transform sitting in its ``clab.yml``, so it can open in its final form and
    skip the repaint entirely.
    """
    try:
        clab = runner.read_existing_clab(topology_path)
    except Exception:  # noqa: BLE001 — a missing/unreadable clab.yml just means no base
        return None
    if not clab:
        return None
    nodes, edges = _nodes_edges_from_clab(clab)
    return (nodes, edges) if nodes else None


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
    transform_error: str | None = None
    # Nothing installed / nothing cached yet means the canvas is coming straight
    # off the netlab model; the branches below refine this.
    projection_source: ProjectionSource = "model"
    if runner.is_installed():
        try:
            # Hash the YAML to avoid re-running `netlab create` on every snapshot
            # request (e.g. position moves don't change the YAML).
            try:
                yaml_hash = hashlib.md5(Path(topology_path).read_bytes()).hexdigest()
            except OSError:
                yaml_hash = ""

            failure = _transform_errors.get(topology_path)
            # Only report a failure that belongs to the YAML on disk right now —
            # an edit that changes the hash is assumed to be the user's fix.
            if failure and failure[0] == yaml_hash and yaml_hash:
                transform_error = failure[1]

            cached = _clab_cache.get(topology_path)
            if cached and cached.is_fresh(yaml_hash, locked=_is_locked(topology_path)):
                # Deep-copied because the reconciliation pass below mutates
                # these dicts and they belong to the cache.
                nodes, edges = copy.deepcopy(cached.nodes), copy.deepcopy(cached.edges)
                projection_source = cached.source
            else:
                # Serve the fast model-derived projection right away and run
                # the (potentially slow) `netlab create` transform in the
                # background — opening a lab must never block on netlab.
                #
                # Blend it over the most recent real clab projection so only
                # what actually changed looks different (see
                # `_merge_projections`); without a base to blend onto the whole
                # canvas visibly re-renders from a different source and then
                # re-renders back.
                nodes, edges = _nodes_edges_from_model(topo)
                base = (cached.nodes, cached.edges) if cached else _existing_clab_projection(topology_path)
                if base:
                    nodes, edges = _merge_projections((nodes, edges), base)
                    projection_source = "blended"
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
            # ``kind`` from a clab projection is the containerlab kind (FRR,
            # for example, projects to ``linux``). clab-ui sends this field
            # back when duplicating a node, so expose the *resolved netlab*
            # device here instead; otherwise Ctrl+D silently turns an FRR
            # node into an explicit Linux node. Keep the projection's outer
            # ``kind`` untouched for rendering.
            netlab_device = source_node.device or topo.defaults.get("device")
            if netlab_device:
                node["data"]["device"] = netlab_device
                node["data"]["kind"] = netlab_device
            # Round-trip the *entire* declarative node (module config, mgmt,
            # any custom attribute) through duplicate/copy-paste, not just
            # device. clab-ui's own payload only forwards a fixed field
            # whitelist, so stash a full copy here under extraData — it
            # survives clab-ui's node.data spread untouched — and
            # `_add_node` unpacks it back onto the clone. Generic by
            # construction: nothing here names a specific attribute.
            if source_node.attrs:
                node["data"].setdefault("extraData", {})["netlabAttrs"] = copy.deepcopy(source_node.attrs)
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
        # Everything the UI needs to know about *what* the nodes/edges above
        # actually are. One object rather than loose flags, because these three
        # describe a single state and were previously easy to read in isolation
        # and get wrong (a failed transform clears `pending` too, so `pending:
        # false` alone never meant "this is the real transform").
        #   source  — see ProjectionSource; "clab" is the real transform, the
        #             *-preview values say why it is only an approximation.
        #   pending — a background `netlab create` is running; the frontend picks
        #             the result up from the `transform` push event.
        #   error   — the last `netlab create` failure for this exact YAML.
        "projection": {
            "source": projection_source,
            "pending": transform_pending,
            "error": transform_error,
        },
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
