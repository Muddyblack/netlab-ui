"""Netlab Lenses response models — addressing, control-plane, services, paths,
validation, derivation."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class LensWarning(BaseModel):
    id: str
    severity: Literal["info", "warning", "error"]
    kind: str
    message: str
    objectRefs: list[str] = []


class LensEndpoint(BaseModel):
    node: str
    interface: str = ""
    ipv4: str | None = None
    ipv6: str | None = None
    objectRefs: list[str] = []


class LensSegment(BaseModel):
    id: str
    nodeIds: list[str]
    physicalEdgeIds: list[str] = []
    endpoints: list[LensEndpoint]
    prefixes: dict[str, str] = {}
    pools: dict[str, str] = {}
    assignmentOrigin: Literal["automatic", "manual", "named-prefix", "unnumbered", "link-local"] = "automatic"
    vrf: str | None = None
    vlan: str | None = None
    role: str | None = None
    colorKey: str
    yamlPaths: list[str] = []
    warnings: list[str] = []


class LensLoopback(BaseModel):
    id: str
    node: str
    interface: str
    ipv4: str | None = None
    ipv6: str | None = None
    pools: dict[str, str] = {}


class LensAddressAssignment(BaseModel):
    id: str
    family: Literal["ipv4", "ipv6"]
    address: str
    node: str
    interface: str
    kind: Literal["interface", "loopback", "management"]
    pool: str | None = None
    segmentId: str | None = None
    origin: Literal["automatic", "manual", "named-prefix", "unnumbered", "link-local"] = "automatic"
    objectRefs: list[str] = []


class LensAddressPool(BaseModel):
    id: str
    name: str
    family: Literal["ipv4", "ipv6"]
    network: str
    allocationPrefix: int | None = None
    usedSubnets: str
    freeSubnets: str
    subnetCapacity: str
    assignedAddresses: str
    addressCapacity: str
    utilization: float
    exhausted: bool


class AddressingLens(BaseModel):
    families: list[Literal["ipv4", "ipv6"]] = []
    segments: list[LensSegment] = []
    loopbacks: list[LensLoopback] = []
    assignments: list[LensAddressAssignment] = []
    pools: list[LensAddressPool] = []
    warnings: list[LensWarning] = []
    duplicateCount: int = 0
    manualAssignmentCount: int = 0


class LensNodeDomain(BaseModel):
    node: str
    bgpAs: str | None = None
    routeReflector: bool = False
    ospfAreas: list[str] = []
    ospfAbr: bool = False
    isisArea: str | None = None
    isisLevel: str | None = None
    services: list[str] = []


class ProtocolAdjacency(BaseModel):
    id: str
    protocol: Literal["bgp", "ospf", "isis", "bfd", "evpn"]
    nodeIds: list[str]
    source: str | None = None
    target: str | None = None
    physicalEdgeIds: list[str] = []
    segmentId: str | None = None
    sessionType: str | None = None
    addressFamilies: list[str] = []
    sourceAs: str | None = None
    targetAs: str | None = None
    sourceInterface: str | None = None
    targetInterface: str | None = None
    sourceAddress: str | None = None
    targetAddress: str | None = None
    area: str | None = None
    level: str | None = None
    status: Literal["configured", "up", "down", "unknown"] = "configured"
    routeReflectorNodes: list[str] = []
    colorKey: str
    explanation: list[str] = []
    settings: dict[str, Any] = {}
    yamlPaths: list[str] = []
    resolvedYaml: str = ""


class ProtocolMarker(BaseModel):
    id: str
    protocol: Literal["ospf", "isis", "bfd", "bgp", "evpn"]
    kind: str
    node: str
    interface: str | None = None
    label: str
    objectRefs: list[str] = []


class ControlPlaneLens(BaseModel):
    nodes: list[LensNodeDomain] = []
    adjacencies: list[ProtocolAdjacency] = []
    markers: list[ProtocolMarker] = []
    warnings: list[LensWarning] = []
    availableLayers: list[Literal["bgp", "ospf", "isis", "bfd", "evpn"]] = []


class LensServiceNode(BaseModel):
    node: str
    services: list[str] = []
    vrfs: list[str] = []
    vlans: list[str] = []


class ValidationTest(BaseModel):
    id: str
    name: str
    description: str = ""
    nodes: list[str] = []
    kind: Literal["wait", "plugin", "exec", "show", "valid", "custom"] = "custom"
    action: str = ""
    waitSeconds: int | None = None
    waitMessage: str | None = None
    stopOnError: bool = False
    level: Literal["normal", "warning"] = "normal"
    state: Literal["passed", "failed", "warning", "unknown"] = "unknown"
    evidence: list[str] = []
    objectRefs: list[str] = []
    order: int


class ValidationSummary(BaseModel):
    total: int = 0
    passed: int = 0
    failed: int = 0
    warning: int = 0
    unknown: int = 0


class ValidationLens(BaseModel):
    available: bool = False
    hasRun: bool = False
    ranAt: str | None = None
    tests: list[ValidationTest] = []
    summary: ValidationSummary = ValidationSummary()


class ServiceVlanEvpn(BaseModel):
    evi: int | None = None
    rd: str | None = None
    importTargets: list[str] = []
    exportTargets: list[str] = []


class ServiceVlanEdge(BaseModel):
    edgeIds: list[str] = []
    mode: Literal["access", "trunk"] = "access"
    nodes: list[str] = []


class ServiceVlan(BaseModel):
    name: str
    id: int | None = None
    vni: int | None = None
    mode: str = "bridge"
    prefix: str | None = None
    vrf: str | None = None
    evpn: ServiceVlanEvpn | None = None
    nodeIds: list[str] = []
    sviNodeIds: list[str] = []
    physicalEdgeIds: list[str] = []
    edges: list[ServiceVlanEdge] = []
    colorKey: str
    objectRefs: list[str] = []


class ServiceVrf(BaseModel):
    name: str
    id: int | None = None
    rd: str | None = None
    importTargets: list[str] = []
    exportTargets: list[str] = []
    evpnTransitVni: int | None = None
    nodeIds: list[str] = []
    vlans: list[str] = []
    colorKey: str
    objectRefs: list[str] = []


class ServiceVtep(BaseModel):
    node: str
    address: str
    interface: str = "lo"
    vlans: list[str] = []


class ServiceTunnel(BaseModel):
    source: str
    target: str
    vlans: list[str] = []
    colorKey: str = "vxlan:tunnel"


class ServiceEvpnSummary(BaseModel):
    enabled: bool = False
    sessions: list[str] = []
    transport: str | None = None
    vlans: list[str] = []
    vrfs: list[str] = []


class ServiceExplorerLens(BaseModel):
    available: bool = False
    vlans: list[ServiceVlan] = []
    vrfs: list[ServiceVrf] = []
    vteps: list[ServiceVtep] = []
    tunnels: list[ServiceTunnel] = []
    evpn: ServiceEvpnSummary = ServiceEvpnSummary()


class ReachabilityLens(BaseModel):
    available: bool = False
    families: list[Literal["ipv4", "ipv6"]] = []
    vrfs: list[str] = []
    nodes: list[str] = []


class PathHop(BaseModel):
    order: int
    fromNode: str
    toNode: str
    egressInterface: str = ""
    egressAddress: str | None = None
    ingressInterface: str = ""
    ingressAddress: str | None = None
    subnet: str | None = None
    protocol: str = "connected"
    cost: int = 1
    edgeIds: list[str] = []
    objectRefs: list[str] = []


class PathResult(BaseModel):
    source: str
    target: str
    family: Literal["ipv4", "ipv6"] = "ipv4"
    vrf: str = "default"
    reachable: bool = False
    hopCount: int = 0
    summary: str = ""
    protocols: list[str] = []
    hops: list[PathHop] = []
    blockage: str | None = None
    explanation: list[str] = []
    objectRefs: list[str] = []


class DerivationField(BaseModel):
    path: str
    label: str
    value: str
    origin: Literal["authored", "inherited", "computed"]
    source: str | None = None


class DerivationNode(BaseModel):
    node: str
    fields: list[DerivationField] = []
    authored: int = 0
    inherited: int = 0
    computed: int = 0
    groups: list[str] = []


class DerivationLens(BaseModel):
    available: bool = False
    nodes: list[DerivationNode] = []


class LensBundleResult(BaseModel):
    schemaVersion: int = 1
    revision: int
    sourceHash: str
    netlabVersion: str | None = None
    addressing: AddressingLens
    controlPlane: ControlPlaneLens
    services: list[LensServiceNode] = []
    serviceExplorer: ServiceExplorerLens = ServiceExplorerLens()
    validation: ValidationLens = ValidationLens()
    reachability: ReachabilityLens = ReachabilityLens()
    derivation: DerivationLens = DerivationLens()
