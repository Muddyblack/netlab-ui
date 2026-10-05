"""Generator plugins: discovery, parameter validation, pattern detection, and
the applyGenerator command / MCP tools built on them."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from app.contract import commands
from app.sessions.store import store
from services.assistant import proposals, tools
from services.model import serialize
from services.netlab import generators, patterns, plugins, runner

FABRIC_DEFAULTS = """\
attributes:
  global:
    fabric:
      leafs: { type: int, _required: True }
      spines: { type: int, _required: True }
      leaf: dict
      spine: dict
fabric:
  leaf: { name: 'L{count}', group: leafs }
  spine: { name: 'S{count}', group: spines }
"""

HAND_BUILT = """\
defaults.device: frr
nodes:
  spine1:
  spine2:
  leaf1:
  leaf2:
  leaf3:
  core:
  br1:
  br2:
links:
- leaf1-spine1
- leaf1-spine2
- leaf2-spine1
- leaf2-spine2
- leaf3-spine1
- leaf3-spine2
- core-br1
- core-br2
"""


@pytest.fixture
def extra(tmp_path, monkeypatch):
    """A fake netsim/extra with fabric and node.clone, so tests don't depend
    on the installed netlab."""
    root = tmp_path / "extra"
    (root / "fabric").mkdir(parents=True)
    (root / "fabric" / "plugin.py").write_text('_config_name = "fabric"\n\ndef topology_expand(topology): pass\n')
    (root / "fabric" / "defaults.yml").write_text(FABRIC_DEFAULTS)
    (root / "node.clone").mkdir()
    (root / "node.clone" / "plugin.py").write_text("def topology_expand(topology): pass\n")
    (root / "files").mkdir()
    (root / "files" / "plugin.py").write_text("def post_transform(topology): pass\n")
    monkeypatch.setattr(plugins, "installed_extra_dir", lambda: root)
    monkeypatch.setattr(plugins, "search_path", _only(root))
    return root


def _only(root: Path):
    def search_path(topology_dir=None):
        paths = [(topology_dir, plugins.ORIGIN_TOPOLOGY)] if topology_dir else []
        return [*paths, (root, plugins.ORIGIN_BUILTIN)]

    return search_path


@pytest.fixture
def lab(tmp_path, extra):
    lab_dir = tmp_path / "lab"
    lab_dir.mkdir()
    path = lab_dir / "topology.yml"
    path.write_text(HAND_BUILT)
    return path


# ------------------------------------------------------------------ discovery
def test_discovers_only_topology_expand_plugins(extra):
    found = {g.plugin: g for g in generators.discover(plugins.search_path())}
    assert set(found) == {"fabric", "node.clone"}

    fabric = found["fabric"]
    assert fabric.key == "fabric" and fabric.scope == "topology"
    assert fabric.patterns == ["leaf_spine"]
    leafs = fabric.param("leafs")
    assert leafs and leafs.type == "int" and leafs.required
    assert fabric.param("leaf").default == {"name": "L{count}", "group": "leafs"}

    clone = found["node.clone"]
    assert clone.key == "clone" and clone.scope == "node"
    assert clone.param("count").min == 1


def test_single_file_generator_declares_itself(tmp_path, extra):
    content = generators.GENERATOR_TEMPLATE.format(name="ring_gen")
    (tmp_path / "ring_gen.py").write_text(content)
    gen = generators.find(generators.discover(plugins.search_path(tmp_path)), "ring_gen")
    assert gen.origin == "topology"
    assert gen.patterns == ["ring"]
    assert gen.param("count").default == 3


def test_non_literal_generator_is_reported(tmp_path):
    (tmp_path / "bad.py").write_text("_generator = dict(title='x')\ndef topology_expand(t): pass\n")
    meta = plugins.read_metadata(tmp_path / "bad.py")
    assert meta.generator is None
    assert "_generator must be a literal" in (meta.error or "")


# ----------------------------------------------------------------- validation
def test_validate_params_coerces_and_checks(extra):
    gens = generators.discover(plugins.search_path())
    clone = generators.find(gens, "node.clone")
    assert generators.validate_params(clone, {"count": "4"}) == {"count": 4}
    with pytest.raises(generators.GeneratorError, match="at least 1"):
        generators.validate_params(clone, {"count": 0})
    with pytest.raises(generators.GeneratorError, match="count is required"):
        generators.validate_params(clone, {})
    with pytest.raises(generators.GeneratorError, match="unknown parameter"):
        generators.validate_params(clone, {"count": 2, "bogus": 1})
    with pytest.raises(generators.GeneratorError, match="must be int"):
        generators.validate_params(clone, {"count": 2.5})
    with pytest.raises(generators.GeneratorError, match="not a generator"):
        generators.find(gens, "files")


# ------------------------------------------------------------------- patterns
def test_detects_leaf_spine_and_clones(lab, extra):
    topo = serialize.from_yaml(lab.read_text())
    found = {p.kind: p for p in patterns.detect(topo, generators.discover(plugins.search_path()))}

    fabric = found["leaf_spine"].suggestion
    assert fabric.generator == "fabric"
    assert fabric.params == {
        "leafs": 3,
        "spines": 2,
        "leaf": {"name": "leaf{count}"},
        "spine": {"name": "spine{count}"},
    }
    assert sorted(fabric.replaceNodes) == ["leaf1", "leaf2", "leaf3", "spine1", "spine2"]

    clone = found["clone"].suggestion
    assert (clone.generator, clone.node, clone.params, clone.replaceNodes) == (
        "node.clone",
        "br1",
        {"count": 2},
        ["br2"],
    )


def test_star_is_not_a_fabric_and_shapes_are_named():
    def kinds(text):
        return [p.kind for p in patterns.detect(serialize.from_yaml(text), [])]

    ring = "nodes: [a, b, c, d]\nlinks: [a-b, b-c, c-d, d-a]\n"
    chain = "nodes: [a, b, c, d]\nlinks: [a-b, b-c, c-d]\n"
    mesh = "nodes: [a, b, c, d]\nlinks: [a-b, a-c, a-d, b-c, b-d, c-d]\n"
    assert kinds(ring) == ["ring"]
    assert kinds(chain) == ["chain"]
    assert kinds(mesh) == ["full_mesh"]
    # hub + identical spokes: the spokes are clone candidates, never a 1xN fabric
    assert "leaf_spine" not in kinds("nodes: [h, s1, s2, s3]\nlinks: [h-s1, h-s2, h-s3]\n")


def test_name_pattern():
    assert patterns.name_pattern(["leaf2", "leaf1", "leaf3"]) == "leaf{count}"
    assert patterns.name_pattern(["leaf1", "leaf3"]) is None
    assert patterns.name_pattern(["a1", "b2"]) is None


# -------------------------------------------------------------------- command
def test_apply_generator_command_replaces_nodes(lab):
    commands.apply(
        str(lab),
        {
            "type": "applyGenerator",
            "plugin": "fabric",
            "key": "fabric",
            "attachTo": "topology",
            "params": {"leafs": 3, "spines": 2},
            "replaceNodes": ["leaf1", "leaf2", "leaf3", "spine1", "spine2"],
        },
    )
    commands.apply(
        str(lab),
        {
            "type": "applyGenerator",
            "plugin": "node.clone",
            "key": "clone",
            "attachTo": "node",
            "params": {"count": 2},
            "node": "br1",
            "replaceNodes": ["br1", "br2"],
        },
    )
    topo = serialize.from_yaml(lab.read_text())
    assert topo.attrs["plugin"] == ["fabric", "node.clone"]
    assert topo.attrs["fabric"] == {"leafs": 3, "spines": 2}
    assert [n.name for n in topo.nodes] == ["core", "br1"]
    assert topo.node("br1").attrs["clone"] == {"count": 2}
    assert [link.endpoints for link in topo.links] == [["core", "br1"]]


def test_node_scope_needs_an_existing_node(lab):
    with pytest.raises(generators.GeneratorError, match="existing node"):
        commands.apply(
            str(lab),
            {"type": "applyGenerator", "plugin": "node.clone", "key": "clone", "attachTo": "node", "params": {}},
        )


# ---------------------------------------------------------------------- tools
@pytest.fixture
def session(lab, monkeypatch):
    async def fake_preview(path, after_text):
        return {"ok": True, "error": None, "before": None, "after": {"nodes": ["x"], "links": 0, "devices": {}},
                "addedNodes": ["x"], "removedNodes": []}  # fmt: skip

    monkeypatch.setattr(generators, "preview", fake_preview)
    created = store.create(str(lab))
    yield created
    store.delete(created.id)
    proposals.store.clear()


def test_tools_detect_and_propose(session, lab):
    detected = asyncio.run(tools.detect_topology_patterns())
    suggestion = next(p["suggestion"] for p in detected["patterns"] if p["kind"] == "leaf_spine")

    before = lab.read_text()
    result = asyncio.run(
        tools.propose_generator(
            suggestion["generator"],
            suggestion["params"],
            "scale the fabric",
            replace_nodes=suggestion["replaceNodes"],
        )
    )
    assert "+  - fabric" in result["diff"]
    assert result["expands_to"]["nodes"] == 1
    assert lab.read_text() == before, "a proposal must not write the topology"
    command = proposals.store.get(result["proposalId"]).commands[0]
    assert command["type"] == "applyGenerator"
    # /api/topology/command reads "scope" as the canvas snapshot scope.
    assert "scope" not in command


def test_tools_reject_bad_params(session):
    with pytest.raises(tools.ToolError, match="count is required"):
        asyncio.run(tools.propose_generator("node.clone", {}, "x", node="br1"))
    listed = asyncio.run(tools.list_generators())
    assert {g["plugin"] for g in listed["generators"]} == {"fabric", "node.clone"}
    assert json.dumps(listed)  # JSON-able for the MCP wrapper


# ---------------------------------------------------------------- real netlab
@pytest.mark.skipif(not runner.is_installed() or not shutil.which("netlab"), reason="netlab not installed")
def test_template_generator_expands_with_real_netlab(tmp_path, monkeypatch):
    monkeypatch.undo()
    (tmp_path / "ring_gen.py").write_text(generators.GENERATOR_TEMPLATE.format(name="ring_gen"))
    path = tmp_path / "topology.yml"
    text = "provider: clab\ndefaults.device: frr\nplugin: [ring_gen]\nring_gen:\n  count: 4\nnodes: {}\n"
    path.write_text(text)
    summary = asyncio.run(generators.expand(path, text))
    assert summary["nodes"] == ["r1", "r2", "r3", "r4"]
    assert summary["links"] == 4
    assert not (tmp_path / "__pycache__").exists()


def test_discover_skips_python_packages_a_plugin_writes_into_the_lab_folder(tmp_path):
    # The monitoring plugin writes its collector (a plain package) to monitoring/collector/nlmon.
    lab = tmp_path / "lab"
    (lab / "monitoring" / "collector" / "nlmon").mkdir(parents=True)
    (lab / "monitoring" / "collector" / "nlmon" / "__init__.py").write_text('"""collector."""\n__version__ = "0.1"\n')
    (lab / "mine").mkdir()
    (lab / "mine" / "__init__.py").write_text("def post_transform(topology): pass\n")
    (lab / "pkg" / "inner").mkdir(parents=True)
    (lab / "pkg" / "inner" / "__init__.py").write_text("def init(topology): pass\n")
    found = [p.id for p in plugins.discover(paths=[(lab, plugins.ORIGIN_TOPOLOGY)])]
    assert found == ["mine", "pkg.inner"]
