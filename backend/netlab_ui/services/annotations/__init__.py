"""Annotations sidecar package — re-export the store API for ``services.annotations``."""

from .store import (
    clab_annotations_path,
    ensure_node_annotation,
    get_node_annotation,
    has_annotations,
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
    "clab_annotations_path",
    "ensure_node_annotation",
    "get_node_annotation",
    "has_annotations",
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
