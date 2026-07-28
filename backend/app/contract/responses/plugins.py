"""Plugin discovery response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Plugin(BaseModel):
    id: str
    title: str
    markdown: str
    docs_url: str | None = None
    source: str | None = None
    # Where on netlab's search path this plugin was found: topology | user |
    # system | builtin. Anything but ``builtin`` is a user's own plugin.
    origin: str | None = None
    # Static metadata parsed (never imported) from the plugin source.
    description: str = ""
    requires: list[str] = Field(default_factory=list)
    execute_after: list[str] = Field(default_factory=list)
    hooks: list[str] = Field(default_factory=list)
    # Same-id copies further down the search path that netlab will not load.
    shadows: list[str] = Field(default_factory=list)
    # Set when the plugin can't be read or its metadata is malformed.
    error: str | None = None


class PluginPipelineEntry(BaseModel):
    id: str
    known: bool
    hooks: list[str] = Field(default_factory=list)
    missing_requires: list[str] = Field(default_factory=list)


class PluginPipeline(BaseModel):
    # Enabled plugins in the order netlab's `sort_plugins` will run them.
    order: list[PluginPipelineEntry]
    # True when dependency sorting moved something — i.e. the `plugin:` list
    # order in the file is not the execution order.
    reordered: bool


class PluginImportRequest(BaseModel):
    """Add a user-written plugin to a netlab plugin search-path directory.

    Exactly one source must be given: ``content`` (uploaded from the browser)
    or ``source_path`` (a file already on the server, copied or symlinked).
    """

    sessionId: str | None = None
    # Plugin name without the .py suffix; becomes the `plugin:` entry.
    name: str
    # "topology" → next to the session's lab file, "user" → ~/.netlab.
    destination: str = "topology"
    content: str | None = None
    sourcePath: str | None = None
    # Symlink instead of copying, so edits to the original take effect live.
    link: bool = False
    overwrite: bool = False


class PluginTemplate(BaseModel):
    name: str
    content: str


class PluginImportResult(BaseModel):
    plugin: Plugin
    path: str
    # Non-fatal observations (e.g. the plugin defines no netlab hooks).
    warnings: list[str] = Field(default_factory=list)


class PluginDebug(BaseModel):
    count: int
    plugins: list[str]
    discovery: dict[str, Any]
