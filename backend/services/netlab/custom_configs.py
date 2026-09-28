"""netlab custom configuration templates (a node's ``config: [name]``).

netlab renders ``name`` for each node from the first file it finds
(``defaults.paths.custom``): ``name/<node>.<device>.j2``, ``name/<device>.j2``,
``name.<device>.j2``, ``name.j2`` and a few more, searched in the lab
directory, ``~/.netlab`` and ``/etc/netlab`` (and netlab's own ``extra``
directory, which holds plugin internals). This module lists the templates
found in the first three, with the devices each has a variant for, and
creates new ones in the lab directory, so the node editor can offer them
instead of a blank text field.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
# Lab-directory entries that hold something else than custom configs.
_NOT_CUSTOM = {
    "group_vars", "host_vars", "node_files", "config", "reports", "tasks", "templates",
    "graphite", "suzieq", "nuts", "__pycache__",
}  # fmt: skip


def _search_dirs(lab_dir: Path) -> list[tuple[Path, str]]:
    # netlab's own package:extra holds plugin internals (templates plugins
    # apply themselves), not configs to pick, so it isn't offered.
    dirs = [(lab_dir, "lab"), (Path.home() / ".netlab", "user"), (Path("/etc/netlab"), "system")]
    return [(path, source) for path, source in dirs if path.is_dir()]


def _is_plugin(directory: Path) -> bool:
    return (directory / "__init__.py").exists() or (directory / "plugin.py").exists()


def _variants_in(directory: Path) -> list[str]:
    return sorted(path.name.removesuffix(".j2") for path in directory.glob("*.j2") if path.is_file())


def discover(lab_dir: Path) -> list[dict[str, Any]]:
    """Templates netlab would find for ``config: [name]``, first match wins."""
    found: dict[str, dict[str, Any]] = {}
    for base, source in _search_dirs(lab_dir):
        entries: dict[str, dict[str, Any]] = {}
        for path in sorted(base.iterdir()):
            if path.name.startswith((".", "clab-")) or path.name in _NOT_CUSTOM:
                continue
            if path.is_dir() and not _is_plugin(path) and (variants := _variants_in(path)):
                entries.setdefault(path.name, {"variants": set(), "path": path})["variants"].update(variants)
            elif path.is_file() and path.suffix == ".j2":
                name, _, variant = path.name.removesuffix(".j2").partition(".")
                if not _NAME_RE.fullmatch(name):
                    continue
                entry = entries.setdefault(name, {"variants": set(), "path": path})
                entry["variants"].add(variant or "any device")
        for name, entry in entries.items():
            if name not in found:
                found[name] = {
                    "name": name,
                    "source": source,
                    "path": str(entry["path"]),
                    "variants": sorted(entry["variants"]),
                    "editable": source == "lab",
                }
    return sorted(found.values(), key=lambda item: (item["source"] != "lab", item["name"]))


STARTER = """{{# Custom configuration "{name}" for {device} nodes.

   Nodes get it with   config: [{name}]   (node, group or defaults), and
   netlab applies it after the initial configuration (netlab up / netlab
   config {name}). Every node attribute is available here, for example
   {{{{ inventory_hostname }}}}, {{{{ interfaces }}}}, {{{{ loopback.ipv4 }}}}
   or {{{{ bgp.as }}}}; see https://netlab.tools/custom/ for the details.
   A variant for another device goes next to this file as <device>.j2. #}}
"""


def create(lab_dir: Path, name: str, device: str) -> Path:
    """``<lab>/<name>/<device>.j2`` with a commented starter; an existing file
    is kept. ValueError for names netlab can't use."""
    if not _NAME_RE.fullmatch(name):
        raise ValueError("Template names may contain letters, digits, dash and underscore.")
    if not _NAME_RE.fullmatch(device):
        raise ValueError("Pick the device the template is for (frr, eos, …).")
    if name in _NOT_CUSTOM:
        raise ValueError(f"{name!r} is a directory netlab uses for something else.")
    target = lab_dir / name / f"{device}.j2"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(STARTER.format(name=name, device=device))
    return target
