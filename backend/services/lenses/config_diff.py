"""Semantic per-module config comparison between two nodes.

Reuses :func:`services.netlab.config_preview.read_node_files` (the same
generated ``node_files/<node>`` artifacts the single-node preview shows) and
diffs them file-by-file. netlab names generated files after the module that
produced them (``03-ospf.sh``, ``daemons`` …), so grouping by file *is* grouping
by module — the ask for #7, without a second config-generation path.
"""

from __future__ import annotations

import difflib
import re
from typing import Any

from services.netlab import config_preview

_LEADING_ORDER_RE = re.compile(r"^\d+[-_]?")


def _module_label(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    name = name.rsplit(".", 1)[0]
    name = _LEADING_ORDER_RE.sub("", name)
    return name or path


def build_config_diff(topology_path: str, left: str, right: str) -> dict[str, Any]:
    left_files = {file["path"]: file["content"] for file in config_preview.read_node_files(topology_path, left)}
    right_files = {file["path"]: file["content"] for file in config_preview.read_node_files(topology_path, right)}
    paths = sorted(set(left_files) | set(right_files))

    files: list[dict[str, Any]] = []
    summary = {"same": 0, "different": 0, "onlyLeft": 0, "onlyRight": 0}
    for path in paths:
        left_present = path in left_files
        right_present = path in right_files
        left_text = left_files.get(path, "")
        right_text = right_files.get(path, "")
        identical = left_present and right_present and left_text == right_text
        hunks: list[str] = []
        added = removed = 0
        if not identical:
            diff = difflib.unified_diff(
                left_text.splitlines(),
                right_text.splitlines(),
                fromfile=f"{left}/{path}",
                tofile=f"{right}/{path}",
                lineterm="",
                n=3,
            )
            for line in diff:
                hunks.append(line)
                if line.startswith("+") and not line.startswith("+++"):
                    added += 1
                elif line.startswith("-") and not line.startswith("---"):
                    removed += 1

        if not left_present:
            summary["onlyRight"] += 1
        elif not right_present:
            summary["onlyLeft"] += 1
        elif identical:
            summary["same"] += 1
        else:
            summary["different"] += 1

        files.append(
            {
                "path": path,
                "module": _module_label(path),
                "leftPresent": left_present,
                "rightPresent": right_present,
                "identical": identical,
                "added": added,
                "removed": removed,
                "hunks": hunks[:400],
                "leftContent": left_text,
                "rightContent": right_text,
            }
        )

    return {
        "available": bool(left_files or right_files),
        "left": left,
        "right": right,
        "files": files,
        "summary": summary,
    }
