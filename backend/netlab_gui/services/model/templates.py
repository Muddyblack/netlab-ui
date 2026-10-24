"""Template expansion — the core "define once, instantiate N times" authoring
feature.

A :class:`Template` is a reusable mini-topology ("a room"). Expanding it N times
produces N copies of its nodes (name-prefixed to stay unique), the internal
links rewired to the prefixed names, and one netlab :class:`Group` per instance
whose members are those prefixed nodes. Templates may ``include`` other
templates ("a house = N rooms"), so expansion is recursive and the resulting
group nesting mirrors the template nesting — a house group lists its room groups
as members (group *names*, never raw nodes), which is exactly how netlab nests
groups.

The output is plain netlab constructs (nodes/links/groups). netlab itself then
applies module/attribute inheritance down the group hierarchy at
``netlab create`` time — we don't reimplement that.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .topology import Group, Link, Node, Template, Topology

_NETLAB_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,15}$")


def instantiate(
    topo: Topology,
    template_name: str,
    count: int,
    prefix: str | None = None,
    external_mappings: dict[str, str] | None = None,
    overrides: dict[str, Any] | None = None,
) -> Topology:
    """Expand ``template_name`` ``count`` times and merge the result into
    ``topo`` (mutating and returning it).

    For ``count == 1`` the instance prefix is ``<prefix>`` (e.g. ``room``); for
    ``count > 1`` instances are ``<prefix>1 .. <prefix>N`` (e.g. ``room1``).
    """

    template = topo.template(template_name)
    if template is None:
        raise KeyError(f"unknown template: {template_name!r}")
    if count < 1:
        raise ValueError("instance count must be at least 1")
    base = prefix or template_name

    planned_nodes: list[str] = []
    planned_groups: list[str] = []
    for i in range(1, count + 1):
        inst = base if count == 1 else f"{base}{i}"
        nodes, groups = _planned_instance_names(topo, template, inst)
        planned_nodes.extend(nodes)
        planned_groups.extend(groups)

    _validate_planned_names(topo, template_name, base, planned_nodes, planned_groups)

    for i in range(1, count + 1):
        inst = base if count == 1 else f"{base}{i}"
        _expand_instance(topo, template, inst, external_mappings, overrides=overrides)
    return topo


def _planned_instance_names(
    topo: Topology,
    template: Template,
    inst: str,
    _stack: tuple[str, ...] = (),
) -> tuple[list[str], list[str]]:
    """Return every node/group identifier expansion would create, without
    mutating the topology. This is the authoritative pre-write validation used
    by every UI/API caller."""
    if template.name in _stack:
        chain = " -> ".join((*_stack, template.name))
        raise KeyError(f"circular template include: {chain}")

    nodes = [f"{inst}_{node.name}" for node in template.nodes]
    groups = [inst]
    for ref in template.includes:
        child = topo.template(ref.template)
        if child is None:
            raise KeyError(f"unknown included template: {ref.template!r}")
        for index in range(1, ref.count + 1):
            child_inst = f"{inst}_{ref.template}" if ref.count == 1 else f"{inst}_{ref.template}{index}"
            child_nodes, child_groups = _planned_instance_names(topo, child, child_inst, (*_stack, template.name))
            nodes.extend(child_nodes)
            groups.extend(child_groups)
    return nodes, groups


def _validate_planned_names(
    topo: Topology,
    template_name: str,
    prefix: str,
    nodes: list[str],
    groups: list[str],
) -> None:
    for kind, names in (("node", nodes), ("group", groups)):
        invalid = next((name for name in names if not _NETLAB_IDENTIFIER.fullmatch(name)), None)
        if invalid is not None:
            raise ValueError(
                f"cannot place unit {template_name!r} with prefix {prefix!r}: generated {kind} "
                f"identifier {invalid!r} is {len(invalid)} characters; netlab identifiers must start "
                "with a letter or underscore and contain at most 16 letters, numbers, or underscores"
            )

    duplicates = {name for name, count in Counter((*nodes, *groups)).items() if count > 1}
    existing_nodes = {node.name for node in topo.nodes}
    existing_groups = {group.name for group in topo.groups}
    collisions = duplicates | (set(nodes) & existing_nodes) | (set(groups) & existing_groups)
    if collisions:
        names = ", ".join(sorted(collisions))
        raise ValueError(f"cannot place unit {template_name!r}: generated identifiers already exist: {names}")


def _expand_link_endpoint(
    topo: Topology,
    template: Template,
    inst: str,
    endpoint: str,
    external_mappings: dict[str, str] | None,
) -> list[str]:
    """Resolve one authoring endpoint to the concrete node name(s) it targets.

    A bare include name whose count is >1 -- e.g. ``workplace.uplink`` in a room
    that ``includes`` ``workplace`` xN -- *fans out* to one endpoint per instance
    (``<inst>_workplace1_uplink`` ... ``<inst>_workplaceN_uplink``), so a single
    "each workplace -> sw" wiring rule scales automatically with the count. Every
    other form resolves to exactly one endpoint, preserving the original rules:

      - ``room2.sw`` / count-1 ``room.sw`` — a specific included instance;
      - a node this template defines — prefixed with the instance name;
      - anything else — mapped through ``external_mappings`` or kept verbatim.
    """
    if "." in endpoint:
        seg, rest = endpoint.split(".", 1)
        ref = next((r for r in template.includes if r.template == seg), None)
        if ref is not None and ref.count > 1:
            tail = rest.replace(".", "_")
            return [f"{inst}_{seg}{j}_{tail}" for j in range(1, ref.count + 1)]
        return [f"{inst}_{endpoint.replace('.', '_')}"]
    if _is_defined_in_template(topo, template, endpoint):
        return [f"{inst}_{endpoint}"]
    return [(external_mappings or {}).get(endpoint, endpoint)]


def _is_defined_in_template(
    topo: Topology, template: Template, node_name: str, _seen: frozenset[str] = frozenset()
) -> bool:
    if template.name in _seen:
        return False
    if any(n.name == node_name for n in template.nodes):
        return True
    seen = _seen | {template.name}
    for ref in template.includes:
        child = topo.template(ref.template)
        if child is not None and _is_defined_in_template(topo, child, node_name, seen):
            return True
    return False


def _expand_instance(
    topo: Topology,
    template: Template,
    inst: str,
    external_mappings: dict[str, str] | None = None,
    _stack: tuple[str, ...] = (),
    overrides: dict[str, Any] | None = None,
) -> Group:
    """Expand a single instance named ``inst``; returns the group representing
    this instance so an enclosing template can list it as a member.

    ``overrides`` optionally standardizes the placed copy: ``device`` replaces
    each node's device and ``image`` sets the node ``image`` attribute. They
    propagate into included sub-units so "place this room as device X" applies
    to the whole thing."""

    if template.name in _stack:
        chain = " -> ".join((*_stack, template.name))
        raise KeyError(f"circular template include: {chain}")

    override_device = (overrides or {}).get("device") or None
    override_image = (overrides or {}).get("image") or None
    members: list[str] = []

    # 1. This template's own nodes, prefixed with the instance name.
    for n in template.nodes:
        new_name = f"{inst}_{n.name}"
        attrs = dict(n.attrs)
        if override_image:
            attrs["image"] = override_image
        topo.nodes.append(Node(name=new_name, device=override_device or n.device, attrs=attrs))
        members.append(new_name)

    # 2. This template's links, rewired if internal, mapped/kept if external.
    #    A bare multi-instance include endpoint (``workplace.uplink`` with 4
    #    workplaces) fans out to one endpoint per instance, so wiring a hub to
    #    "each workplace" produces one link per instance and scales with the
    #    count. Dotted `<instance>.<node>` refs and internal/external nodes each
    #    resolve to a single endpoint as before.
    for link in template.links:
        expansions = [_expand_link_endpoint(topo, template, inst, e, external_mappings) for e in link.endpoints]
        fan_lengths = {len(x) for x in expansions if len(x) > 1}
        if len(fan_lengths) > 1:
            raise ValueError(
                f"link {link.endpoints}: cannot fan out endpoints with different instance counts "
                f"({sorted(fan_lengths)})"
            )
        replicas = fan_lengths.pop() if fan_lengths else 1
        for k in range(replicas):
            endpoints = [group[k] if len(group) > 1 else group[0] for group in expansions]
            topo.links.append(Link(endpoints=endpoints, attrs=dict(link.attrs)))

    # 3. Recursively expand included templates; each becomes a nested group whose
    #    *name* is added as a member of this instance's group.
    for ref in template.includes:
        child = topo.template(ref.template)
        if child is None:
            raise KeyError(f"unknown included template: {ref.template!r}")

        # Add parent template's local nodes to the child external mappings rewired to the instance prefix
        child_external_mappings = dict(external_mappings or {})
        for n in template.nodes:
            child_external_mappings[n.name] = f"{inst}_{n.name}"

        for j in range(1, ref.count + 1):
            child_inst = f"{inst}_{ref.template}" if ref.count == 1 else f"{inst}_{ref.template}{j}"
            child_group = _expand_instance(
                topo, child, child_inst, child_external_mappings, (*_stack, template.name), overrides=overrides
            )
            members.append(child_group.name)  # nest by group name

    group = Group(name=inst, members=members, module=list(template.module))
    topo.groups.append(group)
    return group
