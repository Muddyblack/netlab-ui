"""Netlab groups (config) + netlab-native link authoring endpoints.

Unlike canvas groups (sidecar view-state, see commands._set_node_group_*),
these are real netlab ``groups:`` in the YAML — node sets that share modules
and attributes via netlab's inheritance. They are written straight to the
topology file inside the host transaction so the canvas/snapshot stay in sync.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from app.contract import commands
from app.contract.responses import GroupsResult, NetlabLinkResult
from app.contract.router._shared import router, session_or_404
from services.netlab import link_authoring


def _groups_payload(session) -> dict[str, Any]:
    topo = commands.load_topology(session.topology_path)
    groups = [
        {
            "name": g.name,
            "members": list(g.members),
            "module": list(g.module),
            "attrs": dict(g.attrs),
        }
        for g in topo.groups
    ]
    return {"groups": groups, "nodes": [n.name for n in topo.nodes]}


class GroupPut(BaseModel):
    name: str
    members: list[str] = []
    module: list[str] = []
    attrs: dict[str, Any] = {}


_GROUP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def _groups_have_cycle(groups) -> bool:
    names = {group.name for group in groups}
    graph = {group.name: [member for member in group.members if member in names] for group in groups}
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(name: str) -> bool:
        if name in visiting:
            return True
        if name in visited:
            return False
        visiting.add(name)
        if any(visit(member) for member in graph.get(name, [])):
            return True
        visiting.remove(name)
        visited.add(name)
        return False

    return any(visit(name) for name in graph)


class NetlabLinkPut(BaseModel):
    kind: link_authoring.LinkKind
    nodes: list[str] = []
    name: str = ""
    bridge: str = ""
    hostInterface: str = ""
    bridgeType: str = "bridge"


@router.get("/groups", response_model=GroupsResult)
def get_groups(sessionId: str):
    session = session_or_404(sessionId)
    return _groups_payload(session)


@router.post("/groups", response_model=GroupsResult)
def save_group(sessionId: str, body: GroupPut):
    """Upsert a netlab group by name (create if new, replace members/module/attrs
    if it exists)."""
    session = session_or_404(sessionId)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    if not _GROUP_NAME_RE.fullmatch(name):
        raise HTTPException(400, "group names may contain letters, numbers, dot, dash, and underscore")
    from services.model.topology import Group

    topo = commands.load_topology(session.topology_path)
    group = topo.group(name)
    if group is None and topo.node(name) is not None:
        raise HTTPException(400, f"a node named {name!r} already exists")
    if group is None:
        group = Group(name=name)
        topo.groups.append(group)
    members = list(dict.fromkeys(member.strip() for member in body.members if member.strip()))
    known_members = {node.name for node in topo.nodes} | {item.name for item in topo.groups}
    unknown = [member for member in members if member not in known_members]
    if unknown:
        raise HTTPException(400, f"unknown group members: {', '.join(unknown)}")
    group.members = members
    group.module = list(dict.fromkeys(body.module))
    group.attrs = dict(body.attrs)
    if _groups_have_cycle(topo.groups):
        raise HTTPException(400, "nested groups cannot contain themselves directly or indirectly")
    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return _groups_payload(session)


@router.delete("/groups/{name}", response_model=GroupsResult)
def delete_group(sessionId: str, name: str):
    session = session_or_404(sessionId)
    topo = commands.load_topology(session.topology_path)
    topo.groups = [g for g in topo.groups if g.name != name]
    for group in topo.groups:
        group.members = [member for member in group.members if member != name]
    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return _groups_payload(session)


@router.post("/netlab-links", response_model=NetlabLinkResult)
def save_netlab_link(sessionId: str, body: NetlabLinkPut):
    """Create a netlab-native stub/LAN/uplink or select clab's bridge backend."""
    session = session_or_404(sessionId)
    topo = commands.load_topology(session.topology_path)
    try:
        link_authoring.apply(
            topo,
            body.kind,
            body.nodes,
            name=body.name,
            bridge=body.bridge,
            host_interface=body.hostInterface,
            bridge_type=body.bridgeType,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    with session.host.transaction():
        commands.save_topology(session.topology_path, topo)
    return {"ok": True, "revision": session.revision}
