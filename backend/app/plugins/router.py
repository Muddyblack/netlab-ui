import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.contract.responses import (
    Plugin,
    PluginDebug,
    PluginImportRequest,
    PluginImportResult,
    PluginPipeline,
    PluginPipelineEntry,
    PluginTemplate,
)
from app.sessions.store import store as session_store
from services.netlab import docs as netlab_docs
from services.netlab import location
from services.netlab import plugins as plugin_svc

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

NETLAB_PLUGIN_DOCS_BASE = "https://netlab.tools/plugins"


def _plugin_docs_url(plugin_id: str) -> str:
    return f"{NETLAB_PLUGIN_DOCS_BASE}/{plugin_id}/"


def _plugin_docs_dirs() -> list[Path]:
    """Local plugin docs are not included in the installed netlab package.

    Keep this seam for callers and tests; documentation is resolved through
    ``services.netlab.docs`` and its versioned cache instead.
    """
    return []


def _plugin_extra_dirs() -> list[Path]:
    installed_extra = _installed_extra_dir()
    return [installed_extra] if installed_extra else []


def _plugin_user_dirs(topology_dir: Path | None = None) -> list[tuple[Path, str]]:
    """The user-owned legs of netlab's plugin search path (topology dir,
    ``~/.netlab``, ``/etc/netlab``) — everything but the installed package."""
    return [
        (path, origin) for path, origin in plugin_svc.search_path(topology_dir) if origin != plugin_svc.ORIGIN_BUILTIN
    ]


def _plugin_search_path(topology_dir: Path | None = None) -> list[tuple[Path, str]]:
    """netlab's full plugin search path. Split across two seams so tests can
    pin either leg without reaching into the service."""
    paths = _plugin_user_dirs(topology_dir)
    paths.extend((path, plugin_svc.ORIGIN_BUILTIN) for path in _plugin_extra_dirs())
    return paths


def _session_topology_dir(session_id: str | None) -> Path | None:
    """Directory netlab would run in for *session_id* — the topology's own dir
    (see ``services.netlab.runner``), which is first on the plugin search path."""
    if not session_id:
        return None
    session = session_store.get(session_id)
    if session is None:
        return None
    parent = Path(session.topology_path).expanduser().parent
    return parent if parent.is_dir() else None


def _discovery_details(topology_dir: Path | None = None) -> dict[str, str | list[str] | None]:
    package_dir = location.netsim_package_dir()
    module_paths = [str(package_dir)] if package_dir else []
    extra_dir = _installed_extra_dir()
    docs_dirs = [str(path) for path in _plugin_docs_dirs()]
    extra_dirs = [str(path) for path in _plugin_extra_dirs()]
    return {
        "discovered_docs_dirs": docs_dirs,
        "discovered_extra_dirs": extra_dirs,
        "search_path": [f"{origin}:{path}" for path, origin in _plugin_search_path(topology_dir)],
        "cwd": str(Path.cwd()),
        "netsim_paths": module_paths,
        "installed_extra_dir": str(extra_dir) if extra_dir else None,
    }


def _installed_extra_dir() -> Path | None:
    package_dir = location.netsim_package_dir()
    extra_dir = package_dir / "extra" if package_dir else None
    return extra_dir if extra_dir and extra_dir.exists() else None


def _load_docs_plugins() -> dict[str, dict[str, str]]:
    plugins: dict[str, dict[str, str]] = {}
    for plugins_dir in _plugin_docs_dirs():
        for doc in sorted(plugins_dir.glob("*.md")):
            plugin_id = doc.stem
            if plugin_id in plugins:
                continue
            try:
                content = doc.read_text(encoding="utf-8")
            except OSError:
                continue

            title = plugin_id
            title_match = re.search(r"^#\s+(.*)$", content, re.MULTILINE)
            if title_match:
                title = title_match.group(1).strip()

            clean_content = re.sub(r"^\(.*?\)=\s*$", "", content, flags=re.MULTILINE)
            plugins[plugin_id] = {
                "id": plugin_id,
                "title": title,
                "markdown": clean_content.strip(),
                "docs_url": _plugin_docs_url(plugin_id),
            }
    return plugins


def _markdown_title(markdown: str, fallback: str) -> str:
    match = re.search(r"^#\s+(.*)$", markdown, re.MULTILINE)
    return match.group(1).strip() if match else fallback


def _is_user_facing_plugin(plugin_id: str) -> bool:
    hidden_prefixes = ("test.",)
    hidden_exact = {"ebgp.utils", "none"}
    return not plugin_id.startswith(hidden_prefixes) and plugin_id not in hidden_exact


def _load_installed_plugins(topology_dir: Path | None = None) -> dict[str, dict]:
    """Discover every plugin netlab could load for this topology — purely from
    the local filesystem, following netlab's own search path (topology dir,
    ``~/.netlab``, ``/etc/netlab``, ``netsim/extra``).

    Markdown is intentionally left empty for builtins and resolved lazily by
    :func:`plugin_detail` when the user opens a plugin's manual, so the list
    endpoint never blocks on the network (it previously fetched every plugin's
    doc from GitHub up front, which is what made the palette tab hang). Custom
    plugins have no upstream docs, so an adjacent ``README.md`` is used instead
    and shipped straight away."""
    plugins: dict[str, dict] = {}
    for found in plugin_svc.discover(paths=_plugin_search_path(topology_dir)):
        if not _is_user_facing_plugin(found.id):
            continue
        is_builtin = found.origin == plugin_svc.ORIGIN_BUILTIN
        plugins[found.id] = {
            "id": found.id,
            "title": found.id,
            # Custom plugins are not on netlab.tools; a README is all they have.
            "markdown": "" if is_builtin else (found.meta.readme or ""),
            "docs_url": _plugin_docs_url(found.id) if is_builtin else None,
            "source": str(found.source),
            "origin": found.origin,
            "description": found.meta.description,
            "requires": found.meta.requires,
            "execute_after": found.meta.execute_after,
            "hooks": found.meta.hooks,
            "shadows": found.shadows,
            "error": found.meta.error,
        }
    return plugins


def _resolve_plugin_markdown(plugin_id: str) -> str | None:
    """Full markdown for one plugin: prefer the local bundled doc (fast,
    offline), fall back to fetching it from the netlab repo. Returns None when
    neither is available."""
    for plugins_dir in _plugin_docs_dirs():
        doc = plugins_dir / f"{plugin_id}.md"
        if doc.exists():
            try:
                return netlab_docs.clean_markdown(doc.read_text(encoding="utf-8"))
            except OSError:
                continue
    return netlab_docs.fetch_doc(f"plugins/{plugin_id}.md")


def _merged_plugins(topology_dir: Path | None = None) -> list[dict]:
    merged = _load_installed_plugins(topology_dir)
    # Bundled docs only ever add documentation; they must not drop the
    # discovery metadata (origin, source, hooks) attached above.
    for plugin_id, doc in _load_docs_plugins().items():
        merged.setdefault(plugin_id, {}).update(doc)
    return [merged[plugin_id] for plugin_id in sorted(merged)]


@router.get("", response_model=list[Plugin])
def list_plugins(session_id: str | None = Query(default=None, alias="sessionId")):
    """Plugin catalog. Passing *sessionId* adds the session topology's own
    directory to the search path — that's where netlab looks first, so without
    it the palette can't see a plugin sitting next to the topology file."""
    plugins = _merged_plugins(_session_topology_dir(session_id))
    if plugins:
        return plugins

    details = _discovery_details()
    raise HTTPException(
        status_code=503,
        detail=(
            "No netlab plugins were discovered. Install netlab in this "
            "environment (`pip install networklab`) so its `netsim` package is "
            "importable; plugins are read from the installed `netsim/extra/` "
            "dir. Plugin documentation is loaded on demand from the upstream "
            "netlab repository and cached locally. Debug: "
            f"discovered_docs_dirs={details['discovered_docs_dirs']} "
            f"discovered_extra_dirs={details['discovered_extra_dirs']} "
            f"cwd={details['cwd']} "
            f"netsim_paths={details['netsim_paths']} "
            f"installed_extra_dir={details['installed_extra_dir']}"
        ),
    )


_IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}


@router.get("/images/{image_name}")
def plugin_doc_image(image_name: str):
    """Serve a plugin documentation image from the local netlab docs install.

    netlab's plugin docs reference their figures with plain relative names
    (e.g. ``topology_bgp.domain.png``) that sit alongside the markdown in
    ``docs/plugins/``. Serving them here lets the docs render offline instead
    of round-tripping to netlab.tools.
    """
    # Reject anything that isn't a bare filename to prevent path traversal.
    if image_name != Path(image_name).name:
        raise HTTPException(status_code=400, detail="Invalid image name")

    media_type = _IMAGE_MEDIA_TYPES.get(Path(image_name).suffix.lower())
    if media_type is None:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    for plugins_dir in _plugin_docs_dirs():
        candidate = (plugins_dir / image_name).resolve(strict=False)
        # Ensure the resolved path stays within the docs directory.
        if plugins_dir.resolve(strict=False) not in candidate.parents:
            continue
        if candidate.is_file():
            return FileResponse(candidate, media_type=media_type)

    raise HTTPException(status_code=404, detail="Plugin image not found")


@router.get("/debug", response_model=PluginDebug)
def plugin_debug(session_id: str | None = Query(default=None, alias="sessionId")):
    topology_dir = _session_topology_dir(session_id)
    plugins = _merged_plugins(topology_dir)
    details = _discovery_details(topology_dir)
    return {
        "count": len(plugins),
        "plugins": [plugin["id"] for plugin in plugins],
        "discovery": details,
    }


@router.get("/pipeline", response_model=PluginPipeline)
def plugin_pipeline(
    enabled: list[str] = Query(default_factory=list),
    session_id: str | None = Query(default=None, alias="sessionId"),
):
    """Resolve the topology's ``plugin:`` list into the order netlab will
    actually run it in.

    netlab sorts plugins by their ``_requires``/``_execute_after`` metadata, so
    a plugin's position in ``plugin:`` is *not* its execution order — and an
    unsatisfied ``_requires`` is fatal at transform time. Neither is visible
    from the CLI before you run it; this is.
    """
    found = {
        plugin.id: plugin
        for plugin in plugin_svc.discover(paths=_plugin_search_path(_session_topology_dir(session_id)))
    }
    ordered = plugin_svc.resolve_order(enabled, found)
    missing = plugin_svc.missing_requirements(enabled, found)

    return {
        "order": [
            PluginPipelineEntry(
                id=plugin_id,
                known=plugin_id in found,
                hooks=found[plugin_id].meta.hooks if plugin_id in found else [],
                missing_requires=missing.get(plugin_id, []),
            )
            for plugin_id in ordered
        ],
        "reordered": ordered != enabled,
    }


@router.get("/template", response_model=PluginTemplate)
def plugin_template(name: str = Query(default="my_plugin")):
    """Starting point for a user's own plugin — a documented stub with the
    hook signature filled in, so "write your own" isn't a blank page."""
    try:
        safe_name = plugin_svc.validate_name(name)
    except plugin_svc.PluginImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"name": safe_name, "content": plugin_svc.PLUGIN_TEMPLATE.format(name=safe_name)}


@router.post("/import", response_model=PluginImportResult)
def import_plugin(body: PluginImportRequest):
    """Install a user-written plugin onto netlab's plugin search path.

    Three ways in, all landing in the same place: upload the file's text from
    the browser, copy one that's already on this machine, or symlink it so the
    original stays the source of truth.
    """
    topology_dir = _session_topology_dir(body.sessionId)
    try:
        target_dir = plugin_svc.destination_dir(body.destination, topology_dir)
        path, warnings = plugin_svc.import_plugin(
            name=body.name,
            destination_directory=target_dir,
            content=body.content,
            source_path=Path(body.sourcePath) if body.sourcePath else None,
            link=body.link,
            overwrite=body.overwrite,
        )
    except plugin_svc.PluginImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Re-discover so the response carries the same shape the catalog uses —
    # including whether this import now shadows an existing copy.
    plugin_id = plugin_svc.validate_name(body.name)
    discovered = _load_installed_plugins(topology_dir).get(plugin_id)
    if discovered is None:
        raise HTTPException(
            status_code=500,
            detail=f"wrote {path} but netlab would not discover it there",
        )
    if discovered.get("shadows"):
        warnings.append(
            f"A plugin named {plugin_id} also exists at "
            f"{', '.join(discovered['shadows'])}; netlab will now load the imported one."
        )

    return {"plugin": discovered, "path": str(path), "warnings": warnings}


@router.get("/{plugin_id}", response_model=Plugin)
def plugin_detail(plugin_id: str, session_id: str | None = Query(default=None, alias="sessionId")):
    """Resolve a single plugin's documentation markdown on demand. Declared
    after ``/debug``, ``/pipeline`` and ``/images/...`` so those keep matching
    first."""
    if not _is_user_facing_plugin(plugin_id) or plugin_id != Path(plugin_id).name:
        raise HTTPException(status_code=404, detail="Unknown plugin")

    # A custom plugin has no netlab.tools page; its README (if any) is the
    # manual, and fetching upstream for it would only ever 404.
    discovered = _load_installed_plugins(_session_topology_dir(session_id)).get(plugin_id)
    if discovered and discovered.get("origin") not in (None, plugin_svc.ORIGIN_BUILTIN):
        markdown = discovered.get("markdown") or (
            f"# {plugin_id}\n\n"
            f"{discovered.get('description') or 'This custom plugin ships no documentation.'}\n\n"
            f"Source: `{discovered.get('source')}`\n\n"
            "Add a `README.md` next to the plugin to document it here."
        )
        return {**discovered, "markdown": markdown, "title": _markdown_title(markdown, plugin_id)}

    markdown = _resolve_plugin_markdown(plugin_id)
    if markdown is None:
        markdown = (
            f"# {plugin_id}\n\n"
            "Documentation could not be loaded (offline?), but the plugin is "
            "available in the host netlab package. See "
            f"[{_plugin_docs_url(plugin_id)}]({_plugin_docs_url(plugin_id)})."
        )

    return {
        "id": plugin_id,
        "title": _markdown_title(markdown, plugin_id),
        "markdown": markdown,
        "docs_url": _plugin_docs_url(plugin_id),
    }
