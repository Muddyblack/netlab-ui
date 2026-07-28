"""Plugin discovery that mirrors netlab's own plugin search path.

netlab resolves ``plugin:`` entries by walking ``defaults.paths.plugin``
(``netsim/defaults/paths.yml``) and only falls back to importing a
``netsim.extra`` module. That search path is ``.``, ``topology:``,
``~/.netlab``, ``/etc/netlab`` — and because we always run netlab with
``cwd`` set to the topology's directory (see ``services.netlab.runner``),
``.`` and ``topology:`` collapse into a single directory.

Discovering only ``netsim/extra`` — which is what the plugin router used to do
— means the GUI shows a *different* plugin set than the one netlab actually
loads: a user plugin in ``~/.netlab`` works at ``netlab up`` but is invisible
in the palette. This module closes that gap.

Metadata is read by **parsing** plugin sources with :mod:`ast`, never by
importing them. Plugins are arbitrary Python that netlab executes during
transformation; the GUI backend has no business running that code just to
draw a card.
"""

from __future__ import annotations

import ast
import contextlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from services.netlab import location

# Hooks netlab calls on a plugin module, in the order `augment.main` runs them.
# Keeping the order lets the UI show *when* a plugin acts, not just that it does.
PLUGIN_HOOKS: tuple[str, ...] = (
    "topology_expand",
    "init",
    "pre_transform",
    "pre_node_transform",
    "post_node_transform",
    "pre_link_transform",
    "post_link_transform",
    "post_transform",
    "cleanup",
)

# Origin labels, most specific first — this is netlab's resolution order, so a
# plugin found in an earlier origin shadows the same id in a later one.
ORIGIN_TOPOLOGY = "topology"
ORIGIN_USER = "user"
ORIGIN_SYSTEM = "system"
ORIGIN_BUILTIN = "builtin"


@dataclass
class PluginMeta:
    """What we can learn about a plugin without importing it."""

    description: str = ""
    requires: list[str] = field(default_factory=list)
    execute_after: list[str] = field(default_factory=list)
    hooks: list[str] = field(default_factory=list)
    readme: str | None = None
    error: str | None = None


@dataclass
class DiscoveredPlugin:
    id: str
    origin: str
    source: Path
    meta: PluginMeta
    # Sources of the same id found later in the search path. netlab would never
    # load these; surfacing them explains "why isn't my edit taking effect".
    shadows: list[str] = field(default_factory=list)


def installed_extra_dir() -> Path | None:
    """``netsim/extra`` from the selected netlab package, if any."""
    package_dir = location.netsim_package_dir()
    extra_dir = package_dir / "extra" if package_dir else None
    return extra_dir if extra_dir and extra_dir.exists() else None


def search_path(topology_dir: Path | None = None) -> list[tuple[Path, str]]:
    """``(directory, origin)`` pairs in netlab's plugin resolution order.

    Mirrors ``defaults.paths.plugin``. Directories that don't exist are kept
    out rather than filtered downstream so callers can trust every entry.
    """
    candidates: list[tuple[Path | None, str]] = [
        (topology_dir, ORIGIN_TOPOLOGY),
        (Path("~/.netlab").expanduser(), ORIGIN_USER),
        (Path("/etc/netlab"), ORIGIN_SYSTEM),
        (installed_extra_dir(), ORIGIN_BUILTIN),
    ]
    return [(path, origin) for path, origin in candidates if path is not None and path.is_dir()]


def _is_plugin_dir(plugin_dir: Path) -> bool:
    """A loadable plugin directory has ``plugin.py`` (legacy) or ``__init__.py``
    (package-style, current netlab)."""
    if not plugin_dir.is_dir() or plugin_dir.name.startswith((".", "__")):
        return False
    return (plugin_dir / "plugin.py").exists() or (plugin_dir / "__init__.py").exists()


def _plugin_entry_file(plugin_dir: Path) -> Path | None:
    for name in ("__init__.py", "plugin.py"):
        candidate = plugin_dir / name
        if candidate.exists():
            return candidate
    return None


def iter_plugin_dirs(root: Path):
    """Yield ``(plugin_id, plugin_dir)`` for every user-loadable plugin dir.

    Netlab package layout evolved:

    * Older releases used flat dirs whose *name* already contained dots
      (``extra/bgp.policy/plugin.py`` → id ``bgp.policy``).
    * Current releases (≈26.7+) use a Python package tree
      (``extra/bgp/policy/__init__.py`` → id ``bgp.policy`` via path→dot).

    Namespace packages (``extra/bgp/`` with no ``__init__.py``) are not plugins
    themselves; we walk into them. Subpackages nested under an already-loadable
    plugin (e.g. ``tunnel/gre`` under ``tunnel``) are implementation modules,
    not separate ``plugin:`` entries, so they are skipped.
    """
    if not root.is_dir():
        return

    def walk(directory: Path, parts: tuple[str, ...]):
        try:
            children = sorted(path for path in directory.iterdir() if path.is_dir())
        except OSError:
            return

        for child in children:
            if child.name.startswith((".", "__")):
                continue
            plugin_id = ".".join((*parts, child.name))
            if _is_plugin_dir(child):
                yield plugin_id, child
                # Never walk into a discovered plugin's subpackages — those are
                # internal modules (tunnel.gre, …), not separate catalog entries.
                continue
            yield from walk(child, (*parts, child.name))

    yield from walk(root, ())


def iter_plugin_files(root: Path):
    """Yield ``(plugin_id, file)`` for single-file plugins directly under *root*.

    ``load_plugin_from_path`` accepts a bare ``<name>.py``, which is how most
    hand-written user plugins are shipped. The old dir-only discovery missed
    every one of them.
    """
    if not root.is_dir():
        return
    try:
        children = sorted(root.glob("*.py"))
    except OSError:
        return
    for child in children:
        if child.name.startswith((".", "__")):
            continue
        yield child.stem, child


def _literal_str_list(node: ast.AST) -> list[str] | None:
    """Evaluate a literal list/tuple of strings, or ``None`` if it isn't one."""
    try:
        value = ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return None
    if isinstance(value, (list, tuple)) and all(isinstance(item, str) for item in value):
        return list(value)
    return None


def read_metadata(entry_file: Path) -> PluginMeta:
    """Static metadata for one plugin source file. Never imports the module."""
    try:
        source = entry_file.read_text(encoding="utf-8")
    except OSError as exc:
        return PluginMeta(error=f"cannot read {entry_file.name}: {exc}")

    try:
        tree = ast.parse(source, filename=str(entry_file))
    except SyntaxError as exc:
        # netlab would fail to load this too, with a much less helpful message.
        return PluginMeta(error=f"syntax error in {entry_file.name} line {exc.lineno}: {exc.msg}")

    meta = PluginMeta()

    docstring = ast.get_docstring(tree)
    if docstring:
        # First paragraph only; the card has one line to work with.
        meta.description = " ".join(docstring.strip().split("\n\n")[0].split())

    hooks = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    meta.hooks = [hook for hook in PLUGIN_HOOKS if hook in hooks]

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            if target.id not in ("_requires", "_execute_after"):
                continue
            values = _literal_str_list(node.value)
            if values is None:
                # netlab logs an error and drops the attribute; say so up front.
                meta.error = f"{target.id} must be a list of plugin names"
                continue
            setattr(meta, target.id.lstrip("_"), values)

    readme = entry_file.parent / "README.md"
    if readme.is_file():
        with contextlib.suppress(OSError):
            meta.readme = readme.read_text(encoding="utf-8")

    return meta


def discover(
    topology_dir: Path | None = None,
    *,
    paths: list[tuple[Path, str]] | None = None,
) -> list[DiscoveredPlugin]:
    """Every plugin netlab could load, in netlab's own precedence order.

    *paths* overrides the computed search path (the router injects one so the
    builtin origin stays a monkeypatchable seam).
    """
    found: dict[str, DiscoveredPlugin] = {}

    for root, origin in paths if paths is not None else search_path(topology_dir):
        entries: list[tuple[str, Path, Path | None]] = []
        for plugin_id, plugin_dir in iter_plugin_dirs(root):
            entries.append((plugin_id, plugin_dir, _plugin_entry_file(plugin_dir)))
        for plugin_id, plugin_file in iter_plugin_files(root):
            entries.append((plugin_id, plugin_file, plugin_file))

        for plugin_id, source, entry_file in entries:
            existing = found.get(plugin_id)
            if existing is not None:
                # Later search-path entries lose; record them so the UI can
                # explain which copy actually wins.
                existing.shadows.append(str(source))
                continue
            meta = read_metadata(entry_file) if entry_file else PluginMeta()
            found[plugin_id] = DiscoveredPlugin(
                id=plugin_id,
                origin=origin,
                source=source,
                meta=meta,
            )

    return [found[plugin_id] for plugin_id in sorted(found)]


class PluginImportError(Exception):
    """Raised when a plugin cannot be imported; the message is user-facing."""


# A plugin name becomes a Python module name and a `plugin:` entry. netlab
# accepts dots (bgp.policy), so allow them, but nothing that could escape the
# destination directory or produce an unimportable module.
_VALID_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")


def validate_name(name: str) -> str:
    name = name.strip()
    if name.endswith(".py"):
        name = name[:-3]
    if not name or not _VALID_NAME.match(name):
        raise PluginImportError(
            f"'{name}' is not a usable plugin name — use letters, digits and "
            "underscores (dots are allowed for namespaced names like bgp.policy)"
        )
    return name


def validate_source(content: str, name: str) -> list[str]:
    """Reject a plugin netlab could not load; warn about ones it would ignore.

    Catching this here means a bad file never lands on the search path, rather
    than aborting the next ``netlab up`` with a stack trace.
    """
    try:
        tree = ast.parse(content, filename=f"{name}.py")
    except SyntaxError as exc:
        raise PluginImportError(f"not valid Python: line {exc.lineno}: {exc.msg}") from exc

    hooks = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))} & set(
        PLUGIN_HOOKS
    )

    warnings: list[str] = []
    if not hooks:
        warnings.append(
            "This file defines none of netlab's plugin hooks "
            f"({', '.join(PLUGIN_HOOKS[:4])}, …), so netlab will load it but it "
            "will not change the topology."
        )
    return warnings


def destination_dir(destination: str, topology_dir: Path | None) -> Path:
    """Resolve an import destination to a directory netlab actually searches.

    Deliberately not a free-form path: writing executable Python anywhere on
    the server is not something this endpoint should offer.
    """
    if destination == "topology":
        if topology_dir is None:
            raise PluginImportError(
                "No lab is open, so there is no lab folder to import into. "
                "Open a topology first, or import to ~/.netlab instead."
            )
        return topology_dir
    if destination == "user":
        return Path("~/.netlab").expanduser()
    raise PluginImportError(f"unknown destination '{destination}' (expected 'topology' or 'user')")


def import_plugin(
    *,
    name: str,
    destination_directory: Path,
    content: str | None = None,
    source_path: Path | None = None,
    link: bool = False,
    overwrite: bool = False,
) -> tuple[Path, list[str]]:
    """Place a user plugin into *destination_directory*. Returns (path, warnings)."""
    name = validate_name(name)

    if content is not None and source_path is not None:
        raise PluginImportError("provide either uploaded content or a source path, not both")
    if content is None and source_path is None:
        raise PluginImportError("nothing to import — provide a file's content or a path to one")

    if source_path is not None:
        source_path = source_path.expanduser()
        if not source_path.is_file():
            raise PluginImportError(f"no such file: {source_path}")
        if source_path.suffix != ".py":
            raise PluginImportError(f"{source_path.name} is not a .py file")
        try:
            content = source_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise PluginImportError(f"cannot read {source_path}: {exc}") from exc

    assert content is not None
    warnings = validate_source(content, name)

    target = destination_directory / f"{name}.py"
    if (target.exists() or target.is_symlink()) and not overwrite:
        raise PluginImportError(f"{target} already exists")

    try:
        destination_directory.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            target.unlink()
        if link:
            if source_path is None:
                raise PluginImportError("linking requires a source path on this machine")
            # Symlink so the user keeps editing the original and netlab picks
            # up every change without re-importing.
            target.symlink_to(source_path.resolve())
        else:
            target.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise PluginImportError(f"cannot write {target}: {exc}") from exc

    return target, warnings


PLUGIN_TEMPLATE = '''"""{name} — describe what this plugin does.

This first paragraph is shown as the plugin's description in netlab-ui.
"""

# Plugins this one needs in the topology's `plugin:` list (netlab aborts if
# they are missing) and plugins that must run before this one.
# _requires = []
# _execute_after = []


def post_transform(topology):
    """Runs after netlab has built the full data model.

    `topology` is the netlab topology Box: topology.nodes, topology.links,
    topology.defaults. Mutate it in place.
    """
    for name, node in topology.nodes.items():
        pass
'''


def resolve_order(enabled: list[str], plugins: dict[str, DiscoveredPlugin]) -> list[str]:
    """Order *enabled* plugins the way netlab's ``sort_plugins`` would.

    netlab sorts by ``_requires + _execute_after`` dependencies, which is
    invisible from the CLI — a plugin's position in ``plugin:`` is not the order
    it runs in. Unknown plugins keep their declared position so a typo doesn't
    silently vanish from the pipeline view.
    """

    def deps(plugin_id: str) -> list[str]:
        plugin = plugins.get(plugin_id)
        if plugin is None:
            return []
        return [dep for dep in plugin.meta.requires + plugin.meta.execute_after if dep in enabled]

    ordered: list[str] = []
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(plugin_id: str) -> None:
        if plugin_id in done or plugin_id in visiting:
            # A dependency cycle is netlab's problem to report; don't hang here.
            return
        visiting.add(plugin_id)
        for dep in deps(plugin_id):
            visit(dep)
        visiting.discard(plugin_id)
        done.add(plugin_id)
        ordered.append(plugin_id)

    for plugin_id in enabled:
        visit(plugin_id)
    return ordered


def missing_requirements(enabled: list[str], plugins: dict[str, DiscoveredPlugin]) -> dict[str, list[str]]:
    """``_requires`` entries that are not in the topology's plugin list.

    netlab treats this as fatal at transform time; catching it while editing is
    the whole point of showing dependencies in the GUI.
    """
    missing: dict[str, list[str]] = {}
    for plugin_id in enabled:
        plugin = plugins.get(plugin_id)
        if plugin is None:
            continue
        gaps = [dep for dep in plugin.meta.requires if dep not in enabled]
        if gaps:
            missing[plugin_id] = gaps
    return missing
