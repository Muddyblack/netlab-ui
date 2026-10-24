"""The hand-drawn sketch handed to agents."""

import asyncio
from types import SimpleNamespace

import pytest

from services.assistant import sketch
from services.assistant.tools import ToolError

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 16


def test_save_and_load_round_trip(tmp_path):
    path = sketch.save(tmp_path, PNG, {"strokes": [{"id": "a"}], "nodes": [{"id": "r1"}]})
    assert path.read_bytes() == PNG
    assert sketch.load(tmp_path)["nodes"] == [{"id": "r1"}]


def test_strokes_autosave_keeps_the_rest(tmp_path):
    sketch.save(tmp_path, PNG, {"strokes": [], "nodes": [{"id": "r1"}]})
    sketch.save_strokes(tmp_path, [{"id": "a"}])
    loaded = sketch.load(tmp_path)
    assert loaded["strokes"] == [{"id": "a"}] and loaded["nodes"] == [{"id": "r1"}]
    sketch.save_strokes(tmp_path / "fresh", [{"id": "b"}])
    assert sketch.load(tmp_path / "fresh")["strokes"] == [{"id": "b"}]


def test_rejects_non_png_and_oversize(tmp_path):
    with pytest.raises(ToolError):
        sketch.save(tmp_path, b"GIF89a", {})
    with pytest.raises(ToolError):
        sketch.save(tmp_path, PNG, {"strokes": [0] * (sketch.MAX_STROKES + 1)})


def test_get_sketch_reports_existing_annotations(tmp_path, monkeypatch):
    topology = tmp_path / "topology.yml"
    topology.write_text("nodes: [r1]\n")
    (tmp_path / "topology.yml.annotations.json").write_text(
        '{"freeTextAnnotations":[{"text":"AS 65000","position":{"x":1,"y":2}}],'
        '"freeShapeAnnotations":[{"shapeType":"rectangle","position":{"x":0,"y":0}}]}'
    )
    session = SimpleNamespace(id="s", topology_path=str(topology))
    monkeypatch.setattr(sketch, "_session", lambda *_: session)
    monkeypatch.setattr(sketch, "_lab_name", lambda *_: "lab")
    with pytest.raises(ToolError, match="not drawn"):
        asyncio.run(sketch.get_sketch())
    sketch.save(tmp_path, PNG, {"strokes": [{}], "nodes": [{"id": "r1"}]})
    result = asyncio.run(sketch.get_sketch())
    assert result["existing_annotations"]["texts"][0]["text"] == "AS 65000"
    assert result["existing_annotations"]["shapes"][0]["shape"] == "rectangle"
    assert result["image"].endswith("sketch.png")
