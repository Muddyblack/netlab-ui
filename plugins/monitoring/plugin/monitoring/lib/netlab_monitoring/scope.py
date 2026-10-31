"""Which nodes the monitoring covers, and which of those get only host metrics.

``monitoring.nodes`` picks the monitored nodes and ``monitoring.light`` marks some of them as
host-only (CPU, memory and interface counters read on the lab host, no protocol collection and no
device login). Both are lists of selector strings, evaluated in order::

    monitoring:
      nodes:                         # default: every node
        - leaf*                      # glob over node names
        - re:spine[0-9]+             # regular expression, matches the whole node name
        - core                       # a node, or a group
        - group:pod* | first 10      # every group matching the glob, the first 10 members of each
        - leaf* | random 5           # 5 of the matching nodes, the same 5 every run (see seed)
        - device=srlinux             # by device, role, provider or module (values may be globs)
        - "!leaf9*"                  # a leading ! takes the matches out again
      light: [ "*", "!leaf1*" ]      # everything host-only except leaf1*
      seed: 7                        # for random picks

A selector is ``[!]TERM [| first N | last N | random N]``. Without ``|`` it takes every match; with
it, the first, last or a random N of the matches, in the order of the topology. A group selector
applies the pick to each group on its own. Selectors add to the result in the order written; a
list that starts with a ``!`` selector starts from every node. ``light`` can only mark nodes that
are monitored. A node with ``monitoring.enabled: false`` is never monitored.
"""

from __future__ import annotations

import fnmatch
import random
import re
from dataclasses import dataclass, field

COMPONENT_FLAG = "_monitoring_component"
ATTRIBUTES = ("device", "role", "provider", "module")
_PICK = re.compile(r"^(?P<term>.*?)\s*\|\s*(?P<kind>first|last|random)\s+(?P<count>\d+)\s*$")


class SelectorError(ValueError):
    """A selector that cannot be understood (the message says which and why)."""


@dataclass(frozen=True)
class Selector:
    text: str  # as written, for messages and for seeding random picks
    exclude: bool
    kind: str  # name | glob | regex | group | attribute
    pattern: str
    attribute: str = ""
    pick: str = ""  # "" (all), first, last or random
    count: int = 0


@dataclass
class Resolution:
    monitored: list[str] = field(default_factory=list)  # in the order of the topology
    light: list[str] = field(default_factory=list)  # the monitored nodes that get host metrics only
    total: int = 0  # nodes that could be monitored
    errors: list[str] = field(default_factory=list)  # selectors that were rejected
    warnings: list[str] = field(default_factory=list)  # selectors that matched nothing

    @property
    def full(self) -> list[str]:
        """The monitored nodes that get everything their device type supports."""
        light = set(self.light)
        return [name for name in self.monitored if name not in light]


def parse(text: object) -> Selector:
    """Understand one selector string. Raises SelectorError."""
    if not isinstance(text, str) or not text.strip():
        raise SelectorError(f"selector {text!r}: expected a non-empty string")
    raw = text.strip()
    exclude = raw.startswith("!")
    body = raw[1:].strip() if exclude else raw
    pick, count = "", 0
    if match := _PICK.match(body):
        body, pick, count = match["term"].strip(), match["kind"], int(match["count"])
        if count < 1:
            raise SelectorError(f"selector '{raw}': the number after '{pick}' must be at least 1")
    if not body:
        raise SelectorError(f"selector '{raw}': nothing to select")
    if body.startswith("re:"):
        pattern = body[3:].strip()
        try:
            re.compile(pattern)
        except re.error as exc:
            raise SelectorError(f"selector '{raw}': bad regular expression ({exc})") from exc
        return Selector(raw, exclude, "regex", pattern, pick=pick, count=count)
    if body.startswith("group:"):
        if not (pattern := body[6:].strip()):
            raise SelectorError(f"selector '{raw}': name a group, e.g. group:pod*")
        return Selector(raw, exclude, "group", pattern, pick=pick, count=count)
    if "=" in body:
        attribute, _, value = (part.strip() for part in body.partition("="))
        if attribute not in ATTRIBUTES:
            raise SelectorError(f"selector '{raw}': unknown attribute '{attribute}' (use {', '.join(ATTRIBUTES)})")
        if not value:
            raise SelectorError(f"selector '{raw}': give a value, e.g. {attribute}=...")
        return Selector(raw, exclude, "attribute", value, attribute=attribute, pick=pick, count=count)
    if re.search(r"\s", body):
        raise SelectorError(f"selector '{raw}': a node or group name has no spaces (use '| first N' for a pick)")
    kind = "glob" if any(char in body for char in "*?[") else "name"
    return Selector(raw, exclude, kind, body, pick=pick, count=count)


def _members(groups: dict, name: str, nodes: dict, seen: frozenset[str] = frozenset()) -> list[str]:
    """The nodes of a group, following groups nested in it, in the order of the topology."""
    if name in seen:
        return []
    direct = (groups.get(name) or {}).get("members") or []
    found: set[str] = set()
    for member in direct:
        if member in nodes:
            found.add(member)
        elif member in groups:
            found.update(_members(groups, member, nodes, seen | {name}))
    return [node for node in nodes if node in found]


def groups_of(topology: dict) -> dict[str, list[str]]:
    """For every node, the groups it belongs to (directly or through a group that contains its group)."""
    nodes = topology.get("nodes") or {}
    groups = topology.get("groups") or {}
    found: dict[str, list[str]] = {name: [] for name in nodes}
    for group in groups:
        for member in _members(groups, group, nodes):
            found[member].append(group)
    return found


def _attribute(node: dict, attribute: str, lab_provider: object) -> list[str]:
    if attribute == "module":
        return [str(item) for item in node.get("module") or []]
    if attribute == "role":
        return [str(node.get("role") or "router")]
    if attribute == "provider":
        return [str(node.get("provider") or lab_provider or "")]
    return [str(node.get(attribute) or "")]


def _matches(selector: Selector, topology: dict) -> list[tuple[str, list[str]]]:
    """What a selector matches: (label, nodes) pairs. A pick applies to each pair on its own, and only a
    group selector has more than one pair (one per matching group)."""
    nodes = topology.get("nodes") or {}
    groups = topology.get("groups") or {}
    pattern = selector.pattern
    if selector.kind == "name":
        if pattern in nodes:
            return [("", [pattern])]
        if pattern in groups:
            return [("", _members(groups, pattern, nodes))]
        return [("", [])]
    if selector.kind == "glob":
        return [("", [n for n in nodes if fnmatch.fnmatchcase(n, pattern)])]
    if selector.kind == "regex":
        return [("", [n for n in nodes if re.fullmatch(pattern, n)])]
    if selector.kind == "group":
        names = [g for g in groups if fnmatch.fnmatchcase(g, pattern)]
        return [(g, _members(groups, g, nodes)) for g in names] or [("", [])]
    lab_provider = topology.get("provider")
    return [
        (
            "",
            [
                n
                for n, node in nodes.items()
                if any(fnmatch.fnmatchcase(v, pattern) for v in _attribute(node, selector.attribute, lab_provider))
            ],
        )
    ]


def _pick(items: list[str], selector: Selector, label: str, seed: object) -> list[str]:
    if not selector.pick:
        return items
    if selector.pick == "first":
        return items[: selector.count]
    if selector.pick == "last":
        return items[-selector.count :]
    # Seeded by the selector, so the same lab gives the same sample every time, and a changed selector a new one.
    chosen = set(random.Random(f"{seed}|{selector.text}|{label}").sample(items, min(selector.count, len(items))))
    return [item for item in items if item in chosen]


def _evaluate(
    texts: list[str], topology: dict, universe: list[str], seed: object, *, empty_means_all: bool, what: str
) -> tuple[list[str], list[str], list[str]]:
    """Run a selector list over ``universe``; returns (chosen in universe order, errors, warnings)."""
    selectors: list[Selector] = []
    errors: list[str] = []
    for text in texts:
        try:
            selectors.append(parse(text))
        except SelectorError as exc:
            errors.append(str(exc))
    allowed = set(universe)
    chosen: set[str] = set(universe) if (not selectors and empty_means_all) else set()
    if selectors and selectors[0].exclude:
        chosen = set(universe)
    warnings: list[str] = []
    for selector in selectors:
        hit: set[str] = set()
        for label, items in _matches(selector, topology):
            hit.update(_pick(items, selector, label, seed))
        hit &= allowed
        if not hit:
            warnings.append(f"selector '{selector.text}' matches no {what}")
        chosen = chosen - hit if selector.exclude else chosen | hit
    return [name for name in universe if name in chosen], errors, warnings


def _as_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value] if isinstance(value, list) else []


def resolve(topology: dict) -> Resolution:
    """The monitored nodes of a (transformed) topology, and the host-only ones among them."""
    cfg = topology.get("monitoring") or {}
    nodes = topology.get("nodes") or {}
    seed = cfg.get("seed", 0)
    eligible = [
        name
        for name, node in nodes.items()
        if not node.get(COMPONENT_FLAG) and (node.get("monitoring") or {}).get("enabled") is not False
    ]
    result = Resolution(total=len(eligible))
    monitored, errors, warnings = _evaluate(
        _as_list(cfg.get("nodes")), topology, eligible, seed, empty_means_all=True, what="node"
    )
    light, light_errors, light_warnings = _evaluate(
        _as_list(cfg.get("light")), topology, monitored, seed, empty_means_all=False, what="monitored node"
    )
    result.monitored, result.light = monitored, light
    result.errors = [*(f"monitoring.nodes: {e}" for e in errors), *(f"monitoring.light: {e}" for e in light_errors)]
    result.warnings = [
        *(f"monitoring.nodes: {w}" for w in warnings),
        *(f"monitoring.light: {w}" for w in light_warnings),
    ]
    return result


def describe(resolution: Resolution) -> str:
    """One line for logs and the UI: how much of the lab is monitored, and how."""
    text = f"{len(resolution.monitored)} of {resolution.total} nodes"
    return f"{text} ({len(resolution.light)} host-only)" if resolution.light else text
