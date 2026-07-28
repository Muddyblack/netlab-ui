"""Read-side logic for the netlab multiserver plugin.

The multiserver plugin (docs/plugins/multiserver.md) splits one topology
across worker hosts, keyed by ``multiserver.servers``. This block is a plain
top-level mapping, so it lives in ``topo.attrs["multiserver"]`` and round-trips
through serialize like any unmodeled key. The Workers panel edits it; this
module recovers the *resolved* node→worker placement from the directories the
plugin generates during ``netlab create`` and assembles the panel payload.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from services.model.topology import Topology


def plugin_list(topo: Topology) -> list[str]:
    raw = topo.attrs.get("plugin")
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return [str(p) for p in raw]
    return []


def _worker_server_ids(servers_raw: dict[str, Any]) -> dict[str, int]:
    """Reproduce the plugin's per-worker ``server_id`` assignment so we can expand
    ``output_dir`` templates that use ``{server_id}``. The plugin honors an
    explicit ``id`` and auto-assigns the rest from a monotonic counter (starting
    at 1); we mirror that by giving unspecified workers the next free id in
    declaration order, skipping ids already claimed explicitly."""
    ids: dict[str, int] = {}
    taken: set[int] = set()
    for name, entry in servers_raw.items():
        if isinstance(entry, dict) and isinstance(entry.get("id"), int):
            ids[str(name)] = entry["id"]
            taken.add(entry["id"])
    counter = 1
    for name in servers_raw:
        if str(name) in ids:
            continue
        while counter in taken:
            counter += 1
        ids[str(name)] = counter
        taken.add(counter)
        counter += 1
    return ids


def _worker_dir_names(ms: dict[str, Any], topo_name: str) -> dict[str, str]:
    """Map each declared worker name to the directory the plugin generates for it,
    honoring a custom ``multiserver.output_dir`` template (default
    ``server-{server_name}``). Supports the ``{server_name}``, ``{server_id}`` and
    ``{name}`` placeholders the plugin exposes, so placement discovery works for
    any topology config, not just the default layout."""
    servers_raw = ms.get("servers")
    if not isinstance(servers_raw, dict):
        return {}
    out_tpl = str(ms.get("output_dir", "server-{server_name}"))
    ids = _worker_server_ids(servers_raw)
    dirs: dict[str, str] = {}
    for name in servers_raw:
        sname = str(name)
        try:
            dirs[sname] = out_tpl.format(name=topo_name, server_name=sname, server_id=ids.get(sname, 1))
        except (KeyError, IndexError):
            # Unknown placeholder in a user template — fall back to the default.
            dirs[sname] = f"server-{sname}"
    return dirs


def resolved_placement(
    topology_path: str, ms: dict[str, Any], topo_name: str
) -> tuple[dict[str, list[str]], float | None]:
    """Recover the actual node→worker map from the directories the multiserver
    plugin generates during ``netlab create``. Each worker directory ships a
    filtered ``clab.yml`` listing only that worker's nodes. Directory names are
    resolved from the (possibly customized) ``output_dir`` template rather than a
    fixed ``server-*`` glob, so any topology config is handled. Best-effort:
    returns an empty map before the first create.

    Returns ``(placement, newest_mtime)`` keyed by *worker name*; ``newest_mtime``
    is the most recent worker ``clab.yml`` mtime (``None`` if none exist), used to
    detect stale placement against the topology."""
    from ruamel.yaml import YAML

    yaml = YAML(typ="safe")
    base = Path(topology_path).parent
    placement: dict[str, list[str]] = {}
    newest_mtime: float | None = None
    for worker_name, dir_name in _worker_dir_names(ms, topo_name).items():
        clab = base / dir_name / "clab.yml"
        if not clab.exists():
            continue
        try:
            newest_mtime = max(newest_mtime or 0.0, clab.stat().st_mtime)
            data = yaml.load(clab.read_text()) or {}
        except Exception:  # noqa: BLE001 — malformed generated file is non-fatal
            continue
        topology = data.get("topology") or {}
        raw_nodes = topology.get("nodes") or {}
        nodes = list(raw_nodes.keys()) if isinstance(raw_nodes, dict) else []
        placement[worker_name] = nodes
    return placement, newest_mtime


def placement_status(topology_path: str, newest_mtime: float | None) -> str:
    """Classify why placement chips may be empty, so the panel can tell the user
    what to do instead of showing a blank:

    * ``not_created`` — no ``server-*/`` directories yet (run ``netlab create``).
    * ``stale`` — the topology YAML was edited after the last create, so the
      generated placement no longer reflects the current topology.
    * ``ready`` — generated directories exist and are up to date.
    """
    if newest_mtime is None:
        return "not_created"
    try:
        topo_mtime = Path(topology_path).stat().st_mtime
    except OSError:
        return "ready"
    return "stale" if topo_mtime > newest_mtime else "ready"


def payload(topology_path: str, topo: Topology) -> dict[str, Any]:
    """The Workers panel's full multiserver view for one topology."""
    ms = topo.attrs.get("multiserver")
    ms = dict(ms) if isinstance(ms, dict) else {}
    placement, newest_mtime = resolved_placement(topology_path, ms, topo.name)

    servers_raw = ms.get("servers")
    servers: list[dict[str, Any]] = []
    if isinstance(servers_raw, dict):
        for name, entry in servers_raw.items():
            entry = dict(entry) if isinstance(entry, dict) else {}
            servers.append(
                {
                    "name": str(name),
                    "host": str(entry.get("host", "")),
                    "weight": int(entry.get("weight", 1) or 1),
                    "vxlan_dev": entry.get("vxlan_dev"),
                    "members": [str(m) for m in (entry.get("members") or [])],
                    "groups": [str(g) for g in (entry.get("groups") or [])],
                    "resolvedNodes": placement.get(str(name), []),
                }
            )

    vxlan_raw = ms.get("vxlan") if isinstance(ms.get("vxlan"), dict) else {}
    vxlan = {
        "vni_base": int(vxlan_raw.get("vni_base", 10000) or 10000),
        "dstport": int(vxlan_raw.get("dstport", 4789) or 4789),
        "dev": str(vxlan_raw.get("dev", "")),
    }

    return {
        "enabled": "multiserver" in plugin_list(topo),
        "assignment": str(ms.get("assignment", "explicit")),
        "servers": servers,
        "vxlan": vxlan,
        "nodes": [n.name for n in topo.nodes],
        "groups": [g.name for g in topo.groups],
        "placementStatus": placement_status(topology_path, newest_mtime),
    }
