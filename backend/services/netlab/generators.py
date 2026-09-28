"""Topology generators: plugins that *create* nodes and links.

netlab runs a plugin's ``topology_expand`` hook before anything else looks at
the topology, so a plugin there can turn a small parameter block into a whole
fabric (``fabric: {leafs: 4, spines: 2}``) or N copies of a node
(``clone: {count: 8}``). Scaling a lab is then editing a number instead of
drawing forty nodes.

A generator is any plugin with a ``topology_expand`` hook. What it accepts is
read — never imported — from, in order:

1. a ``_generator`` literal in the plugin source (the way a single-file user
   plugin describes itself)::

       _generator = {
           "title": "OSPF multi-area",
           "key": "ospf_gen",              # top-level topology key; default: _config_name or the plugin id
           "scope": "topology",            # or "node": the block sits on one node (like node.clone)
           "patterns": ["ring"],           # topology shapes it can reproduce (see services.netlab.patterns)
           "params": {
               "areas": {"type": "int", "min_value": 1, "default": 2, "description": "number of areas"},
               "backbone": {"type": "str", "valid_values": ["ring", "mesh"], "default": "ring"},
           },
       }

2. the plugin's ``defaults.yml`` — ``attributes.global.<key>`` in netlab's own
   attribute syntax, plus defaults from the ``<key>:`` section. This is how the
   builtin ``fabric`` plugin declares itself, so no netlab-ui convention is
   needed for package-style plugins.

3. a small table for builtins that document their attributes only in comments
   (``node.clone``).
"""

from __future__ import annotations

import contextlib
import os
import shutil
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

from services.model.topology import Topology
from services.netlab import plugins as plugin_svc

Scope = Literal["topology", "node"]
PARAM_TYPES = ("int", "float", "bool", "str", "dict", "list")


class GeneratorError(ValueError):
    """Bad generator name or parameters; the message is user-facing."""


@dataclass
class GeneratorParam:
    name: str
    type: str = "str"
    required: bool = False
    default: Any = None
    min: float | None = None
    max: float | None = None
    choices: list[Any] | None = None
    description: str = ""


@dataclass
class Generator:
    plugin: str
    key: str
    scope: Scope
    title: str
    description: str
    origin: str
    params: list[GeneratorParam] = field(default_factory=list)
    patterns: list[str] = field(default_factory=list)

    def param(self, name: str) -> GeneratorParam | None:
        return next((p for p in self.params if p.name == name), None)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# Builtins whose attributes live only in comments or whose shape we recognize.
_BUILTIN_HINTS: dict[str, dict[str, Any]] = {
    "node.clone": {
        "title": "Clone a node",
        "key": "clone",
        "scope": "node",
        "patterns": ["clone"],
        "params": {
            "count": {"type": "int", "min_value": 1, "_required": True, "description": "number of copies"},
            "start": {"type": "int", "min_value": 0, "description": "first copy's id (default 1)"},
            "step": {"type": "int", "min_value": 1, "description": "id increment between copies (default 1)"},
        },
    },
    "fabric": {"title": "Leaf-spine fabric", "patterns": ["leaf_spine"]},
}


# ------------------------------------------------------------------ discovery
def _parse_param(name: str, spec: Any, default: Any = None) -> GeneratorParam:
    """One attribute in netlab's syntax: ``int``, ``{type: int, min_value: 1}``,
    or a bare mapping of sub-attributes (a nested dict)."""
    param = GeneratorParam(name=name, default=default)
    if isinstance(spec, str):
        param.type = spec if spec in PARAM_TYPES else "str"
        return param
    if not isinstance(spec, dict):
        return param
    kind = spec.get("type")
    if kind is None:
        # netlab reads a mapping without `type` as a nested attribute tree.
        param.type = "dict"
    else:
        param.type = kind if kind in PARAM_TYPES else "str"
    param.required = bool(spec.get("_required", False))
    param.min = spec.get("min_value")
    param.max = spec.get("max_value")
    choices = spec.get("valid_values")
    param.choices = list(choices) if isinstance(choices, (list, tuple)) else None
    param.description = str(spec.get("description") or spec.get("_description") or "")
    if "default" in spec:
        param.default = spec["default"]
    return param


def _load_defaults_yml(entry_file: Path) -> dict[str, Any]:
    path = entry_file.parent / "defaults.yml"
    # A single-file plugin's directory is some other lab folder; only a package
    # plugin (plugin.py / __init__.py) owns the defaults.yml beside it.
    if entry_file.name not in ("plugin.py", "__init__.py") or not path.is_file():
        return {}
    try:
        data = YAML(typ="safe").load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, YAMLError):
        return {}
    return data if isinstance(data, dict) else {}


def _entry_file(found: plugin_svc.DiscoveredPlugin) -> Path | None:
    source = found.source
    if source.is_file():
        return source
    return plugin_svc._plugin_entry_file(source)


def from_plugin(found: plugin_svc.DiscoveredPlugin) -> Generator | None:
    """The generator a discovered plugin provides, or ``None`` if it isn't one."""
    meta = found.meta
    if "topology_expand" not in meta.hooks:
        return None

    declared = dict(_BUILTIN_HINTS.get(found.id, {}))
    if isinstance(meta.generator, dict):
        declared.update(meta.generator)

    key = str(declared.get("key") or meta.config_name or found.id.replace(".", "_"))
    scope: Scope = "node" if declared.get("scope") == "node" else "topology"

    params: list[GeneratorParam] = []
    declared_params = declared.get("params")
    if isinstance(declared_params, dict):
        params = [_parse_param(name, spec) for name, spec in declared_params.items()]
    else:
        entry = _entry_file(found)
        defaults = _load_defaults_yml(entry) if entry else {}
        attributes = (defaults.get("attributes") or {}).get("global") or {}
        values = defaults.get(key) if isinstance(defaults.get(key), dict) else {}
        schema = attributes.get(key)
        if isinstance(schema, dict):
            params = [_parse_param(name, spec, values.get(name)) for name, spec in schema.items()]

    patterns = declared.get("patterns")
    return Generator(
        plugin=found.id,
        key=key,
        scope=scope,
        title=str(declared.get("title") or found.id),
        description=str(declared.get("description") or meta.description),
        origin=found.origin,
        params=params,
        patterns=[str(p) for p in patterns] if isinstance(patterns, (list, tuple)) else [],
    )


def discover(paths: list[tuple[Path, str]]) -> list[Generator]:
    return [gen for found in plugin_svc.discover(paths=paths) if (gen := from_plugin(found)) is not None]


def find(generators: list[Generator], plugin: str) -> Generator:
    for gen in generators:
        if gen.plugin == plugin:
            return gen
    names = ", ".join(g.plugin for g in generators) or "none installed"
    raise GeneratorError(f"'{plugin}' is not a generator plugin (available: {names})")


# ----------------------------------------------------------------- validation
def _coerce(param: GeneratorParam, value: Any) -> Any:
    kind = param.type
    try:
        if kind == "int":
            if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
                raise ValueError
            value = int(value)
        elif kind == "float":
            if isinstance(value, bool):
                raise ValueError
            value = float(value)
        elif kind == "bool":
            if isinstance(value, str):
                if value.lower() not in ("true", "false", "yes", "no"):
                    raise ValueError
                value = value.lower() in ("true", "yes")
            elif not isinstance(value, bool):
                raise ValueError
        elif kind == "str":
            if not isinstance(value, (str, int, float)) or isinstance(value, bool):
                raise ValueError
            value = str(value)
        elif (kind == "dict" and not isinstance(value, dict)) or (kind == "list" and not isinstance(value, list)):
            raise ValueError
    except (TypeError, ValueError):
        raise GeneratorError(f"{param.name} must be {kind}, got {value!r}") from None

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if param.min is not None and value < param.min:
            raise GeneratorError(f"{param.name} must be at least {param.min}")
        if param.max is not None and value > param.max:
            raise GeneratorError(f"{param.name} must be at most {param.max}")
    if param.choices is not None and value not in param.choices:
        raise GeneratorError(f"{param.name} must be one of {', '.join(map(str, param.choices))}")
    return value


def validate_params(gen: Generator, params: dict[str, Any]) -> dict[str, Any]:
    """Checked, type-coerced parameters. Keeps only what the caller set (plus
    required values that have a default), so the topology block stays short
    and later changes to the plugin's defaults still apply."""
    if not isinstance(params, dict):
        raise GeneratorError("params must be a mapping")
    clean: dict[str, Any] = {}
    # A generator that declares nothing takes its block as-is: netlab (or the
    # plugin) validates it at transform time.
    if not gen.params:
        return dict(params)
    unknown = sorted(set(params) - {p.name for p in gen.params})
    if unknown:
        known = ", ".join(p.name for p in gen.params)
        raise GeneratorError(f"unknown parameter(s) {', '.join(unknown)} for {gen.plugin} (known: {known})")
    for param in gen.params:
        if param.name in params and params[param.name] is not None:
            clean[param.name] = _coerce(param, params[param.name])
        elif param.required:
            if param.default is None:
                raise GeneratorError(f"{param.name} is required for {gen.plugin}")
            clean[param.name] = param.default
    return clean


# ---------------------------------------------------------------------- apply
def _plugin_list(topo: Topology) -> list[str]:
    raw = topo.attrs.get("plugin")
    if isinstance(raw, str):
        return [raw]
    return [str(p) for p in raw] if isinstance(raw, list) else []


def apply(
    topo: Topology,
    *,
    plugin: str,
    key: str,
    scope: Scope,
    params: dict[str, Any],
    node: str | None = None,
) -> None:
    """Enable *plugin* and write its parameter block into *topo*. Removing the
    hand-built nodes a generator replaces is the ``applyGenerator`` command's
    job (it has the annotation sidecar to clean too)."""
    plugins = _plugin_list(topo)
    if plugin not in plugins:
        plugins.append(plugin)
    topo.attrs["plugin"] = plugins

    if scope == "node":
        target = topo.node(node or "")
        if target is None:
            raise GeneratorError(f"{plugin} is applied to a node — pass node=<name> of an existing node")
        target.attrs[key] = params
    else:
        topo.attrs[key] = params


# -------------------------------------------------------------------- preview
# Lab-directory entries netlab writes; linking them into the scratch copy would
# let the preview read (or clobber) the real lab's artifacts.
_GENERATED = {"netlab.lock", "netlab.snapshot.yml", "netlab.snapshot.pickle", "clab.yml", "node_files", "Vagrantfile"}


def _summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    nodes = snapshot.get("nodes") or {}
    links = snapshot.get("links") or []
    devices: dict[str, int] = {}
    for body in nodes.values() if isinstance(nodes, dict) else []:
        device = str((body or {}).get("device") or "?")
        devices[device] = devices.get(device, 0) + 1
    return {
        "nodes": sorted(nodes) if isinstance(nodes, dict) else [],
        "links": len(links) if isinstance(links, list) else 0,
        "devices": devices,
    }


async def expand(topology_path: str | Path, yaml_text: str) -> dict[str, Any]:
    """Run ``netlab create`` on *yaml_text* as if it were the lab's topology,
    without touching the lab directory, and summarize what it builds.

    The scratch copy symlinks the lab's own files (plugins, custom templates,
    includes) so lab-relative lookups resolve the same way they would for real.
    Raises :class:`services.netlab.runner.NetlabError` when netlab rejects it.
    """
    from services.netlab import runner

    source = Path(topology_path)
    with tempfile.TemporaryDirectory(prefix="netlab_generator_") as tmp:
        work_dir = Path(tmp)
        with contextlib.suppress(OSError):
            for entry in source.parent.iterdir():
                if entry.name == source.name or entry.name in _GENERATED or entry.name.startswith(".netlab"):
                    continue
                with contextlib.suppress(OSError):
                    os.symlink(entry, work_dir / entry.name)
        work = work_dir / source.name
        work.write_text(yaml_text, encoding="utf-8")
        try:
            artifact = await runner.create(work, isolated=True)
        finally:
            # isolated create caches by path; this path is gone after the block.
            with contextlib.suppress(Exception):
                runner._create_cache.pop((str(work.resolve()), True), None)
                runner._create_locks.pop((str(work.resolve()), True), None)
            shutil.rmtree(work_dir / "__pycache__", ignore_errors=True)
    return _summary(artifact.get("snapshot") or {})


async def preview(topology_path: str | Path, after_text: str) -> dict[str, Any]:
    """Before/after node and link counts for a proposed generator change."""
    from services.netlab import runner

    before: dict[str, Any] | None
    try:
        artifact = await runner.create(topology_path, isolated=True)
        before = _summary(artifact.get("snapshot") or {})
    except (runner.NetlabError, OSError, ValueError):
        # The current topology not transforming must not block previewing a fix.
        before = None
    try:
        after = await expand(topology_path, after_text)
    except runner.NetlabError as exc:
        return {"ok": False, "error": str(exc)[-4000:], "before": before, "after": None}

    before_nodes = set(before["nodes"]) if before else set()
    after_nodes = set(after["nodes"])
    return {
        "ok": True,
        "error": None,
        "before": before,
        "after": after,
        "addedNodes": sorted(after_nodes - before_nodes),
        "removedNodes": sorted(before_nodes - after_nodes),
    }


async def plan(
    topology_path: str | Path,
    plugin: str,
    params: dict[str, Any],
    *,
    node: str | None = None,
    replace_nodes: list[str] | None = None,
) -> dict[str, Any]:
    """Resolve and validate a generator, and say what applying it would do:
    the topology command, the YAML diff, and netlab's expansion before/after.
    Nothing is written. Raises :class:`GeneratorError` for bad input."""
    from services.assistant import proposals

    path = Path(topology_path)
    gen = find(discover(plugin_svc.search_path(path.parent)), plugin)
    clean = validate_params(gen, params)
    if gen.scope == "node" and not node:
        raise GeneratorError(f"{plugin} is applied to one node — say which (node=<name>)")
    command = {
        "type": "applyGenerator",
        "plugin": gen.plugin,
        "key": gen.key,
        # Not "scope": /command reads that key as the canvas snapshot scope.
        "attachTo": gen.scope,
        "params": clean,
        "node": node if gen.scope == "node" else None,
        "replaceNodes": list(replace_nodes or []),
    }
    try:
        after_text, diff = proposals.preview_edit(str(path), [command])
    except GeneratorError:
        raise
    except (ValueError, KeyError) as exc:
        raise GeneratorError(str(exc)) from exc
    return {"command": command, "diff": diff, **await preview(path, after_text)}


GENERATOR_TEMPLATE = '''"""{name} — describe what this generator builds.

This first paragraph is shown as the generator's description in netlab-ui.
"""

from box import Box

from netsim import data

# What netlab-ui shows in the generator form, and what the assistant may set.
# `params` use netlab's attribute syntax (type, min_value, max_value,
# valid_values, _required) plus `default` and `description`.
_generator = {{
    "title": "{name}",
    "key": "{name}",
    # Shapes this builds, so netlab-ui can offer it for a hand-drawn ring.
    "patterns": ["ring"],
    "params": {{
        "count": {{"type": "int", "min_value": 1, "default": 3, "description": "how many routers"}},
        "name": {{"type": "str", "default": "r{{id}}", "description": "node name pattern"}},
    }},
}}


def topology_expand(topology: Box) -> None:
    """Runs before netlab validates or transforms anything: add nodes, links
    and groups here and netlab treats them like hand-written ones."""
    params = topology.pop("{name}", None)  # netlab would reject an unknown top-level key
    if params is None:
        return
    count = params.get("count", 3)
    pattern = params.get("name", "r{{id}}")

    names = [pattern.format(id=i) for i in range(1, count + 1)]
    for name in names:
        if name in topology.nodes:  # a hand-written node with that name wins
            continue
        # nodes is already a dict here; a generated node needs the same shape
        # netlab's own node normalization would have given it.
        topology.nodes[name] = data.get_box({{"name": name, "interfaces": []}})

    # A ring. Leave addressing to netlab's pools so scaling never breaks it.
    links = topology.get("links", [])
    for i, name in enumerate(names):
        links.append(f"{{name}}-{{names[(i + 1) % len(names)]}}")
    topology.links = links
'''
