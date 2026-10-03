"""The files netlab generates for one node (``netlab create``).

``node_files/<node>/`` holds the rendered configuration, one file per module
(``ospf``, ``bgp``, ``daemons``, ``initial`` for FRR, ``*.cfg`` for others);
``host_vars/<node>/`` holds the node's resolved data (``topology.json``).
Both live in the lab directory and are plain text, so the UI can open them
in the editor tabs.
"""

from __future__ import annotations

import re
from pathlib import Path

_NODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_MAX_FILES = 200

# (directory under the lab, label shown in the UI)
_SOURCES = (("node_files", "Generated configuration"), ("host_vars", "Node data"))

# Rendered-config files first, in the order a device reads them.
_ORDER = ("initial", "daemons", "ospf", "ospfv3", "isis", "bgp", "bfd", "vrf", "evpn", "mpls")


def valid_node(name: str) -> bool:
    return bool(_NODE_RE.match(name))


def _rank(path: Path) -> tuple[int, str]:
    stem = path.name.split(".")[0]
    return (_ORDER.index(stem) if stem in _ORDER else len(_ORDER), path.name)


def list_files(lab_dir: Path, node: str) -> list[dict[str, object]]:
    """Files for ``node`` as ``{name, path, group, size}``; empty before ``netlab create``."""
    if not valid_node(node):
        raise ValueError(f"invalid node name: {node}")
    found: list[dict[str, object]] = []
    for directory, group in _SOURCES:
        base = lab_dir / directory / node
        if not base.is_dir():
            continue
        files = sorted((p for p in base.rglob("*") if p.is_file() and not p.is_symlink()), key=_rank)
        for path in files[:_MAX_FILES]:
            found.append({
                "name": str(path.relative_to(base)),
                "path": str(path),
                "group": group,
                "size": path.stat().st_size,
            })  # fmt: skip
    return found
