"""Recognize shapes in a hand-built topology that a generator could produce.

Deterministic graph checks on the *source* model (what the user drew), not an
LLM guess: the assistant explains and proposes, this decides what is there.

Every finding names its nodes. When an installed generator declares it can
build that shape (``Generator.patterns``), the finding carries a ready-to-apply
suggestion: generator, parameters, and which hand-built nodes it replaces.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Any

from services.model.topology import Node, Topology
from services.netlab.generators import Generator

_NAME_RE = re.compile(r"^(.*?)(\d+)$")


@dataclass
class Suggestion:
    generator: str
    params: dict[str, Any] = field(default_factory=dict)
    node: str | None = None
    replaceNodes: list[str] = field(default_factory=list)
    # What changes beyond the obvious (renamed nodes, dropped per-node settings).
    notes: list[str] = field(default_factory=list)


@dataclass
class Pattern:
    kind: str
    nodes: list[str]
    summary: str
    suggestion: Suggestion | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# ----------------------------------------------------------------- the graph
def _adjacency(topo: Topology) -> dict[str, set[str]]:
    """Point-to-point adjacency. Multi-access links (>2 nodes) are skipped: a
    LAN segment isn't an edge between each pair of its members."""
    adj: dict[str, set[str]] = {n.name: set() for n in topo.nodes}
    for link in topo.links:
        ends = [e for e in dict.fromkeys(link.endpoints) if e in adj]
        if len(ends) == 2:
            a, b = ends
            adj[a].add(b)
            adj[b].add(a)
    return adj


def _signature(node: Node) -> str:
    """What makes two nodes interchangeable: device plus every other attribute."""
    return json.dumps({"device": node.device, **node.attrs}, sort_keys=True, default=str)


def _components(adj: dict[str, set[str]]) -> list[list[str]]:
    seen: set[str] = set()
    out: list[list[str]] = []
    for start in sorted(adj):
        if start in seen or not adj[start]:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nxt in adj[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        out.append(sorted(comp))
    return out


def name_pattern(names: list[str], placeholder: str = "count") -> str | None:
    """``["leaf1", "leaf2", "leaf3"]`` → ``"leaf{count}"`` when the names are one
    prefix plus the numbers 1..n; ``None`` otherwise."""
    prefixes: set[str] = set()
    numbers: list[int] = []
    for name in names:
        match = _NAME_RE.match(name)
        if not match:
            return None
        prefixes.add(match.group(1))
        numbers.append(int(match.group(2)))
    if len(prefixes) != 1 or sorted(numbers) != list(range(1, len(names) + 1)):
        return None
    return f"{prefixes.pop()}{{{placeholder}}}"


def _common_attrs(topo: Topology, names: list[str]) -> tuple[dict[str, Any], bool]:
    """Attributes every node in *names* shares, and whether they share all of
    them (False means per-node settings would be lost)."""
    nodes = [topo.node(n) for n in names]
    sigs = {_signature(n) for n in nodes if n}
    first = nodes[0]
    common: dict[str, Any] = {}
    if first is None:
        return common, False
    if first.device and all(n and n.device == first.device for n in nodes):
        common["device"] = first.device
    for key, value in first.attrs.items():
        if all(n and n.attrs.get(key) == value for n in nodes):
            common[key] = value
    return common, len(sigs) == 1


def _generator_for(generators: list[Generator], kind: str) -> Generator | None:
    # User generators first: a plugin the user wrote for this shape beats a builtin.
    ranked = sorted(generators, key=lambda g: g.origin == "builtin")
    return next((g for g in ranked if kind in g.patterns), None)


# ------------------------------------------------------------------ detectors
def _leaf_spine(topo: Topology, adj: dict[str, set[str]], gens: list[Generator]) -> list[Pattern]:
    """A complete bipartite core: every leaf links to every spine, no leaf-leaf
    or spine-spine links."""
    by_neighbors: dict[frozenset[str], list[str]] = defaultdict(list)
    for name, neighbors in adj.items():
        if neighbors:
            by_neighbors[frozenset(neighbors)].append(name)

    found: list[Pattern] = []
    used: set[str] = set()
    for neighbors, members in sorted(by_neighbors.items(), key=lambda kv: -len(kv[1])):
        group = frozenset(members)
        if len(members) < 2 or group & used or neighbors & used:
            continue
        # The other side must see exactly this group, and the sides must not overlap.
        if group & neighbors or any(adj[n] != group for n in neighbors):
            continue
        spines, leaves = sorted(neighbors), sorted(members)
        if len(spines) > len(leaves) or any("leaf" in s.lower() for s in spines):
            spines, leaves = leaves, spines
        # K(1,n) is a star, not a fabric.
        if len(spines) < 2 or len(leaves) < 2:
            continue
        # K(2,2) is also a 4-node ring; only the names can tell which was meant.
        if len(spines) == len(leaves) == 2 and not any(
            hint in name.lower() for name in spines + leaves for hint in ("leaf", "spine")
        ):
            continue
        used |= group | neighbors

        pattern = Pattern(
            kind="leaf_spine",
            nodes=leaves + spines,
            summary=f"leaf-spine: {len(leaves)} leaves ({', '.join(leaves)}) x {len(spines)} spines "
            f"({', '.join(spines)})",
        )
        gen = _generator_for(gens, "leaf_spine")
        if gen and gen.plugin == "fabric":
            notes: list[str] = []
            params: dict[str, Any] = {"leafs": len(leaves), "spines": len(spines)}
            for role, names in (("leaf", leaves), ("spine", spines)):
                common, uniform = _common_attrs(topo, names)
                settings: dict[str, Any] = dict(common)
                if template := name_pattern(names):
                    settings["name"] = template
                else:
                    notes.append(f"{role} names don't follow <prefix><1..n>; fabric will name them its default way")
                if not uniform:
                    notes.append(f"{role}s differ in per-node settings; only the shared ones are kept")
                if settings:
                    params[role] = settings
            pattern.suggestion = Suggestion(
                generator=gen.plugin, params=params, replaceNodes=leaves + spines, notes=notes
            )
        elif gen:
            pattern.suggestion = Suggestion(
                generator=gen.plugin,
                replaceNodes=leaves + spines,
                notes=[f"{gen.plugin} declares it builds this shape; choose its parameters"],
            )
        found.append(pattern)
    return found


def _clones(topo: Topology, adj: dict[str, set[str]], gens: list[Generator], skip: set[str]) -> list[Pattern]:
    """Interchangeable nodes: same settings, same neighbors, not linked to
    each other — "one branch router, copied by hand"."""
    buckets: dict[tuple[str, frozenset[str]], list[str]] = defaultdict(list)
    for node in topo.nodes:
        if node.name in skip or not adj.get(node.name):
            continue
        buckets[(_signature(node), frozenset(adj[node.name]))].append(node.name)

    found: list[Pattern] = []
    for (_sig, neighbors), members in buckets.items():
        if len(members) < 2 or neighbors & set(members):
            continue
        members = sorted(members)
        pattern = Pattern(
            kind="clone",
            nodes=members,
            summary=f"{len(members)} identical nodes ({', '.join(members)}) on {', '.join(sorted(neighbors))}",
        )
        gen = _generator_for(gens, "clone")
        if gen and gen.plugin == "node.clone":
            keep = members[0]
            pattern.suggestion = Suggestion(
                generator=gen.plugin,
                params={"count": len(members)},
                node=keep,
                replaceNodes=members[1:],
                notes=[f"node.clone renames the copies ({keep}-01, {keep}-02, …) and gives each its own link"],
            )
        found.append(pattern)
    return found


def _shapes(adj: dict[str, set[str]], gens: list[Generator], skip: set[str], kinds: tuple[str, ...]) -> list[Pattern]:
    """Rings, chains, full meshes and stars, per connected component."""
    found: list[Pattern] = []
    for comp in _components(adj):
        if set(comp) & skip or len(comp) < 3:
            continue
        degrees = {n: len(adj[n]) for n in comp}
        size = len(comp)
        kind: str | None = None
        if size >= 4 and all(d == size - 1 for d in degrees.values()):
            kind, summary = "full_mesh", f"full mesh of {size} nodes"
        elif all(d == 2 for d in degrees.values()):
            kind, summary = "ring", f"ring of {size} nodes"
        # A 3-node chain is just a hub with two spokes; leave it to clone/star.
        elif size >= 4 and sorted(degrees.values()) == [1, 1] + [2] * (size - 2):
            kind, summary = "chain", f"chain of {size} nodes"
        else:
            hubs = [n for n, d in degrees.items() if d == size - 1]
            if len(hubs) == 1 and all(degrees[n] == 1 for n in comp if n != hubs[0]):
                kind, summary = "star", f"star: {hubs[0]} with {size - 1} spokes"
        if kind not in kinds:
            continue
        pattern = Pattern(kind=kind, nodes=comp, summary=summary)
        if gen := _generator_for(gens, kind):
            pattern.suggestion = Suggestion(
                generator=gen.plugin,
                replaceNodes=comp,
                notes=[f"{gen.plugin} declares it builds a {kind.replace('_', ' ')}; choose its parameters"],
            )
        found.append(pattern)
    return found


def detect(topo: Topology, generators: list[Generator]) -> list[Pattern]:
    adj = _adjacency(topo)
    found = _leaf_spine(topo, adj, generators)
    # Whole-component shapes before clones: opposite corners of a ring have
    # the same neighbors too, but they aren't copies of one node.
    found += _shapes(adj, generators, {n for p in found for n in p.nodes}, ("full_mesh", "ring", "chain"))
    found += _clones(topo, adj, generators, {n for p in found for n in p.nodes})
    # Stars last: a hub with identical spokes is better expressed as a clone.
    found += _shapes(adj, generators, {n for p in found for n in p.nodes}, ("star",))
    return found
