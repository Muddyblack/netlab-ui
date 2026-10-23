"""The user's hand-drawn sketch of a lab, for an agent to turn into a topology.

The UI renders the pen strokes (plus the nodes already on the canvas, as labelled boxes) to a PNG and
saves it here with the strokes. The agent reads the PNG from the lab's folder (a vision-capable agent CLI
opens image files) and gets the structured side through ``get_sketch``: the existing nodes' positions,
and the text labels and shapes the user already placed with clab-ui's own annotation tools. Those are
read from the annotations file, never written, so this cannot race with the canvas saving it.

Strokes live in ``.netlab-ui/sketch.json``, not the annotations file: clab-ui has no freehand type, and
that file is rewritten whole by the canvas.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from services import annotations
from services.assistant.tools import ToolError, _lab_name, _session

SKETCH_DIR = Path(".netlab-ui")
IMAGE_NAME = "sketch.png"
DATA_NAME = "sketch.json"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_STROKES = 2000


def image_path(lab_dir: Path) -> Path:
    return lab_dir / SKETCH_DIR / IMAGE_NAME


def save(lab_dir: Path, image: bytes, data: dict[str, Any]) -> Path:
    """Store the rendered sketch and its structured data in the lab's folder."""
    if not image.startswith(b"\x89PNG"):
        raise ToolError("the sketch image must be a PNG")
    if len(image) > MAX_IMAGE_BYTES:
        raise ToolError("the sketch image is larger than 8 MB")
    strokes = data.get("strokes", [])
    if not isinstance(strokes, list) or len(strokes) > MAX_STROKES:
        raise ToolError("too many strokes")
    folder = lab_dir / SKETCH_DIR
    folder.mkdir(parents=True, exist_ok=True)
    (folder / IMAGE_NAME).write_bytes(image)
    (folder / DATA_NAME).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return folder / IMAGE_NAME


def save_strokes(lab_dir: Path, strokes: list[Any]) -> None:
    """Keep the drawing between page loads without rendering a picture; Generate adds the PNG later."""
    if len(strokes) > MAX_STROKES:
        raise ToolError("too many strokes")
    data = load(lab_dir) or {}
    data["strokes"] = strokes
    folder = lab_dir / SKETCH_DIR
    folder.mkdir(parents=True, exist_ok=True)
    (folder / DATA_NAME).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def load(lab_dir: Path) -> dict[str, Any] | None:
    try:
        return json.loads((lab_dir / SKETCH_DIR / DATA_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _existing_annotations(topology_path: str) -> dict[str, Any]:
    try:
        found = annotations.load(topology_path)
    except (OSError, ValueError):
        return {"texts": [], "shapes": []}
    return {
        "texts": [
            {"text": t.get("text", ""), "position": t.get("position")}
            for t in found.get("freeTextAnnotations", [])
            if isinstance(t, dict)
        ],
        "shapes": [
            {"shape": s.get("shapeType"), "position": s.get("position"), "end": s.get("endPosition")}
            for s in found.get("freeShapeAnnotations", [])
            if isinstance(s, dict)
        ],
    }


async def get_sketch(lab: str | None = None) -> dict[str, Any]:
    """The user's hand-drawn sketch of the lab they want: the image to look at and what it was drawn over."""
    session = _session(lab)
    lab_dir = Path(session.topology_path).parent
    data = load(lab_dir)
    image = image_path(lab_dir)
    if data is None or not image.exists():
        raise ToolError("the user has not drawn a sketch yet — ask them to draw one and press Generate")
    return {
        "lab": _lab_name(session),
        "image": str(image),
        "how_to_read": (
            "Open the PNG with your image reading. Boxes with a grey fill are nodes already in the lab (named); "
            "coloured pen lines are the user's drawing: shapes are devices or networks, lines between them are "
            "links, handwriting is names, protocols, addresses or notes. Coordinates are canvas units."
        ),
        "strokes": len(data.get("strokes", [])),
        "existing_nodes": data.get("nodes", []),
        "existing_annotations": _existing_annotations(session.topology_path),
        "next_steps": (
            "If the sketch leaves something open (device types, addressing, protocols, how many of a "
            "repeated shape), ask the user in this conversation before proposing. Then call get_topology_yaml "
            "and propose_topology_edit; the user reviews the diff and applies it."
        ),
    }
