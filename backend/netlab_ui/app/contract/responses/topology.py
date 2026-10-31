"""Topology contract / authoring response models (sessions, commands, units,
groups, multiserver workers)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class SnapshotResponse(BaseModel):
    snapshot: dict[str, Any]


class CreateSessionResult(BaseModel):
    sessionId: str
    topologyRef: str
    mode: str


class CommandAck(BaseModel):
    """clab-ui topology-host ack/error envelope returned by ``/command``."""

    type: str
    protocolVersion: int
    requestId: str
    revision: int | None = None
    snapshot: dict[str, Any] | None = None
    error: str | None = None


class InstantiateResult(BaseModel):
    ok: bool
    revision: int
    yaml: str


class TemplatesResult(BaseModel):
    templates: list[dict[str, Any]]


class UnitExportBundle(BaseModel):
    """A portable, shareable unit (topology + canvas view-state)."""

    schemaVersion: int = 1
    kind: str = "netlab-unit"
    unit: dict[str, Any]


class UnitImportRequest(BaseModel):
    sessionId: str
    bundle: dict[str, Any]
    overwrite: bool = False


class UnitImportResult(BaseModel):
    name: str
    templates: list[dict[str, Any]]


class UnitInstance(BaseModel):
    """One placed unit instance and how it compares to the unit's current
    version (for the "instance is out of date" badge)."""

    instance: str
    unit: str
    version: int
    currentVersion: int | None = None
    exists: bool = True
    outdated: bool = False
    orphaned: bool = False


class UnitInstancesResult(BaseModel):
    instances: list[UnitInstance] = []


class GroupInfo(BaseModel):
    """One netlab ``groups:`` entry. ``members`` may name nodes or other groups
    (netlab nests groups by listing group names as members)."""

    name: str
    members: list[str] = []
    module: list[str] = []
    attrs: dict[str, Any] = {}


class GroupsResult(BaseModel):
    """Existing netlab groups plus the node/group names available as members,
    so the authoring panel can offer a picker without a second round-trip."""

    groups: list[GroupInfo]
    nodes: list[str]


class NetlabLinkResult(BaseModel):
    """Result of one netlab-native visual link mutation."""

    ok: bool
    revision: int


class WorkerInfo(BaseModel):
    """One ``multiserver.servers`` entry — a deployment target for a slice of the
    topology. ``members``/``groups`` are the *declared* pins; ``resolvedNodes`` is
    the actual placement recovered from the generated ``server-*/`` directory
    after ``netlab create`` (populated for both explicit and auto modes, empty
    before the first create)."""

    name: str
    host: str = ""
    weight: int = 1
    vxlan_dev: str | None = None
    members: list[str] = []
    groups: list[str] = []
    resolvedNodes: list[str] = []


class MultiserverVxlan(BaseModel):
    """Global ``multiserver.vxlan`` settings. ``dev`` is required by the plugin
    (the default interface VXLAN tunnels bind to)."""

    vni_base: int = 10000
    dstport: int = 4789
    dev: str = ""


class MultiserverResult(BaseModel):
    """The topology's ``multiserver`` block plus the node/group names available
    for assignment, so the Workers panel can offer pickers without a second
    round-trip. ``enabled`` reflects whether ``multiserver`` is listed in
    ``plugin:``."""

    enabled: bool
    assignment: str = "explicit"
    servers: list[WorkerInfo] = []
    vxlan: MultiserverVxlan = MultiserverVxlan()
    nodes: list[str] = []
    groups: list[str] = []
    # Why the per-worker ``resolvedNodes`` may be empty, so the panel can guide
    # the user instead of showing a blank: "not_created" (no generated worker
    # dirs yet), "stale" (topology edited since the last create), "ready".
    placementStatus: Literal["ready", "stale", "not_created"] = "not_created"


class CustomNodesResult(BaseModel):
    customNodes: list[dict[str, Any]]
    defaultNode: str
