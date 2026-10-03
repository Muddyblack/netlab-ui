"""Build the collection plan from netlab's transformed topology.

The plan is plain JSON: which nodes to collect, how (profile method), the netlab names
of every interface (for labels), address/router-id maps to name protocol peers, and the
adjacencies/sessions the topology expects. It is the only contract between netlab and
the collector, so the collector never needs netlab's Python code.
"""

from __future__ import annotations

import typing

PROTOCOLS = ("ospf", "isis", "bgp", "bfd")
# Not a netlab module to ask for: a node speaks VXLAN when netlab gave it VNIs.
VXLAN = "vxlan"
COMPONENT_FLAG = "_monitoring_component"


def get(data: typing.Any, path: str, default: typing.Any = None) -> typing.Any:
    """Dotted-path lookup that works for dicts and Boxes."""
    for key in path.split("."):
        if not isinstance(data, dict) or key not in data:
            return default
        data = data[key]
    return data


def resolve_profile(profiles: dict, device: str) -> dict:
    """Profile for a device, following 'use:' inheritance (child keys win)."""
    chain: list[dict] = []
    seen: set[str] = set()
    name: str | None = device
    while name and name not in seen and isinstance(profiles.get(name), dict):
        seen.add(name)
        chain.append(dict(profiles[name]))
        name = profiles[name].get("use")
    result: dict = {}
    for entry in reversed(chain):
        for key, value in entry.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = {**result[key], **value}
            else:
                result[key] = value
    result.pop("use", None)
    return result or {"method": "host"}


def container_name(topology: dict, node: str) -> str:
    """containerlab container name (same rules as the clab.yml 'prefix' netlab writes)."""
    lab = str(topology.get("name"))
    prefix = get(topology, "defaults.providers.clab.lab_prefix", "clab")
    if prefix is None or prefix == "":
        return node
    if prefix == "__lab-name":
        return f"{lab}-{node}"
    return f"{prefix}-{lab}-{node}"


def domain_name(topology: dict, node: str) -> str:
    """libvirt domain name netlab (vagrant-libvirt) gives a node."""
    return f"{str(topology.get('name')).split('.')[0]}_{node}"


def _addr(value: typing.Any) -> str | None:
    return value.split("/")[0] if isinstance(value, str) and value else None


def selected_nodes(topology: dict) -> list[str]:
    """Nodes to monitor: 'monitoring.nodes' (nodes or groups) if set, minus opted-out nodes."""
    nodes = topology.get("nodes") or {}
    wanted = get(topology, "monitoring.nodes") or []
    if wanted:
        groups = topology.get("groups") or {}
        names: set[str] = set()
        for item in wanted:
            if item in nodes:
                names.add(item)
            elif item in groups:
                names.update(get(groups[item], "members", []) or [])
        candidates = [n for n in nodes if n in names]
    else:
        candidates = list(nodes)
    return [
        n
        for n in candidates
        if not nodes[n].get(COMPONENT_FLAG) and get(nodes[n], "monitoring.enabled", True) is not False
    ]


def _link_names(topology: dict) -> dict[int, str]:
    """linkindex -> readable link name ('r1-r2', 'r1-r2#2' for parallel links, bridge for LANs)."""
    names: dict[int, str] = {}
    used: dict[str, int] = {}
    for link in topology.get("links") or []:
        index = link.get("linkindex")
        if index is None:
            continue
        members = [i.get("node") for i in link.get("interfaces") or []]
        if len(members) == 2 and link.get("type") != "lan":
            base = "-".join(members)
        else:
            base = str(link.get("bridge") or f"lan{index}")
        used[base] = used.get(base, 0) + 1
        names[index] = base if used[base] == 1 else f"{base}#{used[base]}"
    return names


def build(topology: dict) -> dict:
    cfg = topology.get("monitoring") or {}
    profiles = cfg.get("profiles") or {}
    all_nodes = topology.get("nodes") or {}
    monitored = selected_nodes(topology)
    monitored_set = set(monitored)
    link_names = _link_names(topology)
    lab_provider = topology.get("provider")

    addresses: dict[str, str] = {}
    router_ids: dict[str, str] = {}
    for name, node in all_nodes.items():
        for af in ("ipv4", "ipv6"):
            if a := _addr(get(node, f"loopback.{af}")):
                addresses[a] = name
            for intf in node.get("interfaces") or []:
                if a := _addr(intf.get(af)):
                    addresses.setdefault(a, name)
        for path in ("ospf.router_id", "bgp.router_id", "isis.system_id"):
            if rid := get(node, path):
                router_ids[str(rid)] = name

    plan_nodes: dict[str, dict] = {}
    exporters: list[dict] = []
    for name in monitored:
        node = all_nodes[name]
        device = str(node.get("device"))
        provider = node.get("provider") or lab_provider
        profile = resolve_profile(profiles, device)
        method = get(node, "monitoring.method") or profile.get("method", "host")
        methods: list[str] = []
        if provider in ("clab", "libvirt"):
            methods.append("host")
        if method == "frr" and provider != "clab":
            method = "host"  # vty sockets are reachable only for containers
        if method != "host":
            methods.append(method)

        interfaces = []
        nic = 0
        for intf in node.get("interfaces") or []:
            if intf.get("type") == "loopback" or intf.get("virtual_interface"):
                continue
            nic += 1
            neighbors = intf.get("neighbors") or []
            entry = {
                "ifname": intf.get("ifname"),
                "dev": get(intf, "clab.name") or intf.get("ifname"),
                "link": link_names.get(intf.get("linkindex"), ""),
                "nic": nic,
            }
            if len(neighbors) == 1:
                entry["peer_node"] = neighbors[0].get("node")
                entry["peer_ifname"] = neighbors[0].get("ifname")
            interfaces.append(entry)

        mgmt = node.get("mgmt") or {}
        plan_node: dict = {
            "device": device,
            "provider": provider,
            "role": node.get("role") or "router",
            "methods": methods,
            "interfaces": interfaces,
            "mgmt": {
                # clab always gives the container eth0 for management, whatever the NOS calls it
                "dev": "eth0" if provider == "clab" else mgmt.get("ifname"),
                "ifname": mgmt.get("ifname"),
                "ipv4": mgmt.get("ipv4"),
                "ipv6": mgmt.get("ipv6"),
            },
        }
        if provider == "clab":
            plan_node["container"] = container_name(topology, name)
        elif provider == "libvirt":
            plan_node["domain"] = domain_name(topology, name)
        if method == "frr":
            plan_node["frr"] = {
                "protocols": [m for m in node.get("module") or [] if m in PROTOCOLS]
                + ([VXLAN] if vxlan_vnis(node) else []),
                "socket_dirs": get(profile, "frr.socket_dirs") or ["run/frr", "var/run/frr"],
            }
        elif method in ("gnmi", "snmp"):
            plan_node[method] = {**(profile.get(method) or {})}
        plan_nodes[name] = plan_node

        for exp in get(node, "monitoring.exporters") or []:
            target = mgmt.get("ipv4") or mgmt.get("ipv6")
            if target:
                exporters.append(
                    {
                        "node": name,
                        "target": f"{target}:{exp['port']}",
                        "path": exp.get("path") or "/metrics",
                        "job": exp.get("job") or "exporter",
                    }
                )

    return {
        "version": 1,
        "lab": str(topology.get("name")),
        "interval": int(cfg.get("interval") or 15),
        "workers": int(cfg.get("workers") or 2),
        "nodes": plan_nodes,
        "links": _links(topology, link_names, monitored_set),
        "addresses": addresses,
        "router_ids": router_ids,
        "expected": _expected(topology, monitored_set, plan_nodes),
        "exporters": exporters,
    }


def _links(topology: dict, link_names: dict[int, str], monitored: set[str]) -> list[dict]:
    result = []
    for link in topology.get("links") or []:
        ends = [i for i in link.get("interfaces") or [] if i.get("node") in monitored]
        if not ends:
            continue
        entry = {"link": link_names.get(link.get("linkindex"), ""), "type": link.get("type") or "p2p"}
        for tag, end in zip(("a", "b"), ends[:2], strict=False):
            entry[f"{tag}_node"] = end.get("node")
            entry[f"{tag}_ifname"] = end.get("ifname")
        result.append(entry)
    return result


def _peer_interface(nodes: dict, peer: str, linkindex: typing.Any) -> dict:
    for intf in nodes.get(peer, {}).get("interfaces") or []:
        if intf.get("linkindex") == linkindex:
            return intf
    return {}


def vxlan_vnis(node: dict) -> list[dict]:
    """The VNIs netlab configured on a node: one per VXLAN VLAN (type l2) and per
    symmetric-IRB VRF (type l3)."""
    found: list[dict] = []
    for vlan in get(node, "vxlan.vlans", []) or []:
        if vni := get(node, f"vlans.{vlan}.vni"):
            found.append({"vni": str(vni), "type": "l2", "vlan": vlan})
    for vrf in get(node, "vxlan.l3vnis", []) or []:
        if vni := get(node, f"vrfs.{vrf}.evpn.transit_vni"):
            found.append({"vni": str(vni), "type": "l3", "vrf": vrf})
    return found


def _expected(topology: dict, monitored: set[str], plan_nodes: dict[str, dict]) -> dict[str, list[dict]]:
    nodes = topology.get("nodes") or {}
    bgp: list[dict] = []
    vxlan: list[dict] = []
    igp: dict[str, list[dict]] = {"ospf": [], "isis": []}
    for name in sorted(monitored):
        node = nodes[name]
        modules = node.get("module") or []
        if "bgp" in modules:
            sessions = [("default", n) for n in get(node, "bgp.neighbors", []) or []]
            for vrf, vdata in (node.get("vrfs") or {}).items():
                sessions += [(vrf, n) for n in get(vdata, "bgp.neighbors", []) or []]
            for vrf, nbr in sessions:
                if nbr.get("name") not in monitored:
                    continue
                for af in ("ipv4", "ipv6"):
                    peer = nbr.get(af)
                    if peer is True:  # unnumbered: FRR keys the session by interface
                        peer = nbr.get("local_if") or nbr.get("ifname")
                    if not isinstance(peer, str):
                        continue
                    bgp.append(
                        {
                            "node": name,
                            "peer": _addr(peer) or peer,
                            "peer_node": nbr.get("name"),
                            "type": nbr.get("type"),
                            "vrf": vrf,
                        }
                    )
        # Only where something reads VNIs from the device (FRR), or "expected" would always read "missing".
        if VXLAN in (plan_nodes.get(name, {}).get("frr") or {}).get("protocols", []):
            vxlan += [{"node": name, **vni} for vni in vxlan_vnis(node)]
        for proto in ("ospf", "isis"):
            if proto not in modules:
                continue
            for intf in node.get("interfaces") or []:
                if proto not in intf or intf.get("type") == "loopback" or get(intf, f"{proto}.passive"):
                    continue
                for nbr in intf.get("neighbors") or []:
                    peer = nbr.get("node")
                    if peer not in monitored or proto not in (nodes[peer].get("module") or []):
                        continue
                    pintf = _peer_interface(nodes, peer, intf.get("linkindex"))
                    if proto not in pintf or get(pintf, f"{proto}.passive"):
                        continue
                    item = {"node": name, "peer_node": peer, "ifname": intf.get("ifname")}
                    if proto == "ospf":
                        item["area"] = str(get(intf, "ospf.area", get(node, "ospf.area", "0.0.0.0")))
                    igp[proto].append(item)
    return {"bgp": bgp, "vxlan": vxlan, "ospf": igp["ospf"], "isis": igp["isis"]}
