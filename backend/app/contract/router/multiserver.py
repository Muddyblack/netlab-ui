"""Netlab multiserver plugin endpoints.

Read-side logic (placement discovery, panel payload) lives in
``services.multiserver``; the endpoints here only own the HTTP surface and the
write path (assembling the ``multiserver`` block from the request body).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.contract import commands
from app.contract.responses import MultiserverResult, MultiserverVxlan, WorkerInfo
from app.contract.router._shared import router, session_or_404
from services import multiserver


def _multiserver_payload(session) -> dict[str, Any]:
    topo = commands.load_topology(session.topology_path)
    return multiserver.payload(session.topology_path, topo)


class MultiserverPut(BaseModel):
    enabled: bool = True
    assignment: str = "explicit"
    servers: list[WorkerInfo] = []
    vxlan: MultiserverVxlan = MultiserverVxlan()


@router.get("/multiserver", response_model=MultiserverResult)
def get_multiserver(sessionId: str):
    session = session_or_404(sessionId)
    return _multiserver_payload(session)


@router.put("/multiserver", response_model=MultiserverResult)
def save_multiserver(sessionId: str, body: MultiserverPut):
    """Replace the whole ``multiserver`` block and sync ``plugin:``. Writing an
    ordered dict for ``servers`` keeps YAML diffs stable; empty/default fields are
    omitted so we don't clutter the topology with plugin defaults."""
    session = session_or_404(sessionId)

    topo = commands.load_topology(session.topology_path)

    if body.enabled:
        block: dict[str, Any] = {"assignment": body.assignment}
        servers: dict[str, Any] = {}
        for w in body.servers:
            if not w.name:
                continue
            entry: dict[str, Any] = {}
            if w.host:
                entry["host"] = w.host
            if w.weight and w.weight != 1:
                entry["weight"] = w.weight
            if w.vxlan_dev:
                entry["vxlan_dev"] = w.vxlan_dev
            if w.groups:
                entry["groups"] = list(w.groups)
            if w.members:
                entry["members"] = list(w.members)
            servers[w.name] = entry
        if servers:
            block["servers"] = servers
        vxlan: dict[str, Any] = {}
        if body.vxlan.vni_base and body.vxlan.vni_base != 10000:
            vxlan["vni_base"] = body.vxlan.vni_base
        if body.vxlan.dstport and body.vxlan.dstport != 4789:
            vxlan["dstport"] = body.vxlan.dstport
        if body.vxlan.dev:
            vxlan["dev"] = body.vxlan.dev
        if vxlan:
            block["vxlan"] = vxlan
        topo.attrs["multiserver"] = block

        plugins = multiserver.plugin_list(topo)
        if "multiserver" not in plugins:
            plugins.append("multiserver")
        topo.attrs["plugin"] = plugins
    else:
        topo.attrs.pop("multiserver", None)
        plugins = [p for p in multiserver.plugin_list(topo) if p != "multiserver"]
        if plugins:
            topo.attrs["plugin"] = plugins
        else:
            topo.attrs.pop("plugin", None)

    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return _multiserver_payload(session)
