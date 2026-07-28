"""The netlab *source* model: a structured, in-memory representation of a netlab
topology that the UI edits.

This is the single source of truth for authoring. It deliberately holds **only
declarative intent** — nodes, links, groups, defaults, modules — and never any
layout/coordinate data (those live in the annotations sidecar, see
``services/annotations``). Serializing this model yields a clean netlab
``topology.yml`` that ``netlab create`` validates.

The model is intentionally permissive: netlab accepts a wide range of shorthand
(a node value may be ``null``/``{}``, a link may be a string like ``r1-r2`` or a
rich dict). We preserve arbitrary extra attributes in ``attrs`` so we never lose
data we don't explicitly understand.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Node:
    """A netlab node. ``device`` is optional — netlab falls back to the group or
    global default device when it is omitted."""

    name: str
    device: str | None = None
    # Anything else under the node (module config, custom attributes, mgmt, ...).
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Link:
    """A netlab link.

    netlab links are flexible. We keep a normalized list of endpoint node names
    in ``endpoints`` (covering both the ``r1-r2`` string form and the
    ``interfaces:`` list form) and stash everything else in ``attrs`` so rich
    links (per-interface settings, prefixes, link-level module config) survive a
    round-trip untouched.
    """

    endpoints: list[str] = field(default_factory=list)
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Group:
    """A netlab group.

    ``members`` may reference **node names or other group names** — that is how
    netlab expresses nested groups, and it is exactly what the Templates feature
    relies on. ``module`` and any other shared attributes flow down to members
    (precedence: node > inner group > outer group > defaults).
    """

    name: str
    members: list[str] = field(default_factory=list)
    module: list[str] = field(default_factory=list)
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class Template:
    """A reusable, parameterizable sub-topology ("a room", "a house").

    A template is itself a mini netlab fragment: some nodes, the internal links
    between them, and an optional shared module list. ``includes`` lets a
    template embed other templates (a "house" = N "rooms"), enabling recursive,
    nested composition. Templates are a UI-authoring convenience — expanding one
    (see ``services/model/templates.py``) produces only plain netlab
    nodes/links/groups.
    """

    name: str
    nodes: list[Node] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    module: list[str] = field(default_factory=list)
    # Names of other templates to embed, with an instance count each.
    includes: list[IncludeRef] = field(default_factory=list)


@dataclass
class IncludeRef:
    """Embed ``template`` ``count`` times inside another template/topology."""

    template: str
    count: int = 1


@dataclass
class Topology:
    name: str = "lab"
    provider: str | None = None
    defaults: dict[str, Any] = field(default_factory=dict)
    nodes: list[Node] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    groups: list[Group] = field(default_factory=list)
    # Template *definitions*. These are not part of netlab YAML; they live in the
    # UI sidecar and are expanded into nodes/links/groups on demand.
    templates: list[Template] = field(default_factory=list)
    # Top-level attributes we don't model explicitly (module, addressing, ...).
    attrs: dict[str, Any] = field(default_factory=dict)

    # -- convenience lookups -------------------------------------------------
    def node(self, name: str) -> Node | None:
        return next((n for n in self.nodes if n.name == name), None)

    def group(self, name: str) -> Group | None:
        return next((g for g in self.groups if g.name == name), None)

    def template(self, name: str) -> Template | None:
        return next((t for t in self.templates if t.name == name), None)
