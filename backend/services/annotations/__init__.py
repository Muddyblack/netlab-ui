"""Annotations sidecar package — re-export the store API for ``services.annotations``."""

from .store import (
    load,
    remove_node,
    rename_node,
    save,
    set_collapsed,
    set_icon,
    set_node_group,
    set_position,
    sidecar_path,
)

__all__ = [
    "load",
    "remove_node",
    "rename_node",
    "save",
    "set_collapsed",
    "set_icon",
    "set_node_group",
    "set_position",
    "sidecar_path",
]
