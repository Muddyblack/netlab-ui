import asyncio

from app.contract import snapshot
from services.model import serialize
from services.netlab import validation


def test_snapshot_runtime_fields_do_not_leak_into_yaml(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert snap["nodes"][0]["data"]["label"] == "r1"
    assert snap["nodes"][0]["data"]["state"] == "undeployed"
    assert topo.node("r1").attrs == {}
    assert "label:" not in snap["yamlContent"]
    assert "state:" not in snap["yamlContent"]
    assert "role:" not in snap["yamlContent"]


def test_snapshot_uses_netlab_device_for_duplicate_payload(tmp_path, monkeypatch):
    """The canvas copy payload must not use clab's `linux` kind for FRR."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\ndefaults:\n  device: frr\nnodes:\n  r1:\n")

    async def _create(*_a, **_kw):
        return {"clab": {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}}

    _install_fake_netlab(monkeypatch, _create)

    async def _run():
        topo = serialize.from_yaml(topology_path.read_text())
        await snapshot.build(str(topology_path), topo, 0)
        await asyncio.gather(*snapshot._transform_tasks.values())
        return await snapshot.build(str(topology_path), topo, 0)

    snap = asyncio.run(_run())

    assert snap["nodes"][0]["kind"] == "linux"
    assert snap["nodes"][0]["data"]["kind"] == "frr"
    assert snap["nodes"][0]["data"]["device"] == "frr"


def test_snapshot_edges_include_endpoint_data(tmp_path, monkeypatch):
    """Edges must include sourceEndpoint and targetEndpoint for clab-ui rendering.
    When interface names are unknown (pre-deployment), we use empty strings to avoid
    displaying misleading labels."""
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n  r2:\n  r3:\nlinks:\n  - r1-r2\n  - r2-r3\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert len(snap["edges"]) == 2

    # Check first edge
    edge0 = snap["edges"][0]
    # Endpoint-derived, not positional: the id must survive unrelated edits and
    # be identical in the clab projection (see services/model/edge_ids.py).
    assert edge0["id"] == "r1--r2"
    assert edge0["source"] == "r1"
    assert edge0["target"] == "r2"
    assert "data" in edge0
    assert "sourceEndpoint" in edge0["data"]
    assert "targetEndpoint" in edge0["data"]
    # Empty strings when interface names are not yet known
    assert edge0["data"]["sourceEndpoint"] == ""
    assert edge0["data"]["targetEndpoint"] == ""

    # Check second edge
    edge1 = snap["edges"][1]
    assert edge1["data"]["sourceEndpoint"] == ""
    assert edge1["data"]["targetEndpoint"] == ""


def test_snapshot_edges_carry_topology_edge_type(tmp_path, monkeypatch):
    """Every edge must declare type "topology-edge" so React Flow uses clab-ui's
    custom edge renderer. Without it, links fall back to React Flow's thin 1px
    default edge and visibly flip to thin lines on the next snapshot refresh."""
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n  r2:\n  r3:\nlinks:\n  - r1-r2\n  - r2-r3\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert snap["edges"], "expected edges to be present"
    assert all(edge["type"] == "topology-edge" for edge in snap["edges"])


def test_snapshot_projects_validation_issues_onto_nodes_and_links(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes: [r1, r2]\nlinks: [r1-r2]\n")
    topology = serialize.from_yaml(topology_path.read_text())
    validation.store(
        topology_path,
        "ERROR node r1 has an invalid bgp.as\nWARNING link r1-r2 has no prefix\n",
        ["r1", "r2"],
        [("r1", "r2")],
    )

    result = asyncio.run(snapshot.build(str(topology_path), topology, 0))

    r1 = next(node for node in result["nodes"] if node["id"] == "r1")
    assert r1["data"]["iconColor"] == "#d32f2f"
    assert r1["data"]["extraData"]["validationIssues"][0]["entityType"] == "node"
    assert result["edges"][0]["data"]["linkStatus"] == "down"
    assert result["edges"][0]["data"]["extraData"]["validationIssues"][0]["entityType"] == "link"


def _install_fake_netlab(monkeypatch, create):
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: True)
    monkeypatch.setattr(snapshot.runner, "create", create)

    async def _no_status(*_a, **_kw):
        return {}

    monkeypatch.setattr(snapshot.runner, "status_for", _no_status)
    monkeypatch.setattr(snapshot.runner, "status_cached", _no_status)
    snapshot._clab_cache.clear()
    snapshot._transform_errors.clear()
    snapshot._transform_tasks.clear()


def test_failed_transform_is_reported_not_silently_swapped(tmp_path, monkeypatch):
    """A failing `netlab create` still yields a renderable fallback projection.
    Without a reported error the canvas just quietly switches renderers and the
    user has no way to tell the topology never transformed."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n  r2:\nlinks:\n  - r1-r2\n")
    topo = serialize.from_yaml(topology_path.read_text())

    async def _boom(*_a, **_kw):
        raise snapshot.runner.NetlabError(
            ["netlab", "create"], 1, "MissingValue in nodes: No device type specified for node r1"
        )

    _install_fake_netlab(monkeypatch, _boom)

    async def _run():
        first = await snapshot.build(str(topology_path), topo, 0)
        assert first["projection"]["pending"] is True
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        return await snapshot.build(str(topology_path), topo, 0)

    snap = asyncio.run(_run())

    assert "No device type specified for node r1" in snap["projection"]["error"]
    # ...and the projection says *why* the canvas is only an approximation.
    assert snap["projection"]["source"] == "failed-preview"
    # The canvas still renders the model-derived fallback.
    assert {n["id"] for n in snap["nodes"]} == {"r1", "r2"}
    # ...and the failure reaches the validation surface too.
    assert any(i["severity"] == "error" for i in snap["validationIssues"])


def test_successful_transform_clears_a_previous_error(tmp_path, monkeypatch):
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())

    async def _boom(*_a, **_kw):
        raise snapshot.runner.NetlabError(["netlab", "create"], 1, "broken")

    _install_fake_netlab(monkeypatch, _boom)

    async def _fail_then_fix():
        await snapshot.build(str(topology_path), topo, 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        assert snapshot._transform_errors.get(str(topology_path)) is not None

        async def _ok(*_a, **_kw):
            return {"clab": {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}}

        monkeypatch.setattr(snapshot.runner, "create", _ok)
        # A new hash is what re-triggers the transform, mirroring a user edit.
        topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n  r2:\n    device: frr\n")
        await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 1)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        return await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 2)

    snap = asyncio.run(_fail_then_fix())
    assert snap["projection"]["error"] is None
    assert snap["projection"]["source"] == "clab"


def test_unwrapped_transform_crash_is_cached_and_reported(tmp_path, monkeypatch):
    """A failure `runner.create` does not wrap must not vanish into the asyncio
    task — nothing would ever be cached and every snapshot would re-run it."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())

    async def _crash(*_a, **_kw):
        raise ValueError("unparseable transform dump")

    _install_fake_netlab(monkeypatch, _crash)

    async def _run():
        await snapshot.build(str(topology_path), topo, 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        return await snapshot.build(str(topology_path), topo, 1)

    snap = asyncio.run(_run())

    assert "unparseable transform dump" in snap["projection"]["error"]
    # Cached, so the failing transform is not retried until the YAML changes.
    assert snap["projection"]["pending"] is False


def test_edge_ids_are_stable_when_an_unrelated_link_is_removed(tmp_path, monkeypatch):
    """Positional ids (`e0`, `e1`) renumber every link after a deletion, which
    resets canvas selection and re-points edge-keyed annotations at the wrong
    link. Endpoint-derived ids must not move."""
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes: [r1, r2, r3]\nlinks: [r1-r2, r2-r3]\n")

    async def _run():
        before = await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 0)
        # Drop the *first* link — the survivor would shift from e1 to e0.
        topology_path.write_text("name: t\nnodes: [r1, r2, r3]\nlinks: [r2-r3]\n")
        after = await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 1)
        return before, after

    before, after = asyncio.run(_run())

    assert [e["id"] for e in before["edges"]] == ["r1--r2", "r2--r3"]
    assert [e["id"] for e in after["edges"]] == ["r2--r3"]


def test_parallel_links_between_one_pair_get_distinct_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshot.runner, "is_installed", lambda: False)
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes: [r1, r2]\nlinks: [r1-r2, r1-r2]\n")
    topo = serialize.from_yaml(topology_path.read_text())

    snap = asyncio.run(snapshot.build(str(topology_path), topo, 0))

    assert [e["id"] for e in snap["edges"]] == ["r1--r2", "r1--r2#2"]


def test_clab_and_model_projections_agree_on_edge_ids():
    """The two projections must recognise each other's edges, or the blend in
    `_merge_projections` degrades to a full re-render on every edit. The clab
    transform reverses the endpoint order here on purpose — the id is
    orientation-independent."""
    topo = serialize.from_yaml("name: t\nnodes: [r1, r2]\nlinks: [r1-r2]\n")
    _, model_edges = snapshot._nodes_edges_from_model(topo)
    _, clab_edges = snapshot._nodes_edges_from_clab(
        {"topology": {"nodes": {}, "links": [{"endpoints": ["r2:eth1", "r1:eth1"]}]}}
    )

    assert [e["id"] for e in model_edges] == [e["id"] for e in clab_edges] == ["r1--r2"]


def test_pending_snapshot_keeps_clab_bodies_and_shows_the_new_link(tmp_path, monkeypatch):
    """The interim snapshot served while `netlab create` runs must show the edit
    immediately *and* keep the real projection's data for everything that
    already existed — otherwise the canvas either hides the user's new link or
    re-renders the whole graph from a different source and back again."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes: [r1, r2, r3]\nlinks: [r1-r2]\n")

    async def _create(*_a, **_kw):
        return {
            "clab": {
                "topology": {
                    "nodes": {"r1": {"kind": "linux"}, "r2": {"kind": "linux"}, "r3": {"kind": "linux"}},
                    "links": [{"endpoints": ["r1:eth1", "r2:eth1"]}],
                }
            }
        }

    _install_fake_netlab(monkeypatch, _create)

    async def _run():
        await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        # Add a link — the YAML hash changes, so the next snapshot is interim.
        topology_path.write_text("name: t\nnodes: [r1, r2, r3]\nlinks: [r1-r2, r2-r3]\n")
        return await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 1)

    interim = asyncio.run(_run())

    assert interim["projection"]["pending"] is True
    assert interim["projection"]["source"] == "blended"
    edges = {e["id"]: e for e in interim["edges"]}
    # The just-added link is present right away...
    assert set(edges) == {"r1--r2", "r2--r3"}
    # ...the pre-existing one keeps the real transform's interface names...
    assert edges["r1--r2"]["data"]["sourceEndpoint"] == "eth1"
    # ...and the new one is model-derived, so it has none yet.
    assert edges["r2--r3"]["data"]["sourceEndpoint"] == ""
    # Nodes keep their clab kind rather than reverting to the netlab device.
    assert {n["id"] for n in interim["nodes"]} == {"r1", "r2", "r3"}
    assert next(n for n in interim["nodes"] if n["id"] == "r1")["kind"] == "linux"


def test_pending_snapshot_drops_a_deleted_node(tmp_path, monkeypatch):
    """The blend takes its element *set* from the live model, so a deletion
    applies immediately instead of lingering until the transform lands."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes: [r1, r2]\nlinks: [r1-r2]\n")

    async def _create(*_a, **_kw):
        return {
            "clab": {
                "topology": {
                    "nodes": {"r1": {"kind": "linux"}, "r2": {"kind": "linux"}},
                    "links": [{"endpoints": ["r1:eth1", "r2:eth1"]}],
                }
            }
        }

    _install_fake_netlab(monkeypatch, _create)

    async def _run():
        await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        topology_path.write_text("name: t\nnodes: [r1]\n")
        return await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 1)

    interim = asyncio.run(_run())

    assert {n["id"] for n in interim["nodes"]} == {"r1"}
    assert interim["edges"] == []


def test_cached_projection_is_not_mutated_by_a_build(tmp_path, monkeypatch):
    """`build()` reconciles node dicts in place (positions, state, labels). Those
    dicts are the cache's, so without a copy each build would compound edits
    into the cached projection."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")

    async def _create(*_a, **_kw):
        return {"clab": {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}}

    _install_fake_netlab(monkeypatch, _create)

    async def _run():
        await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        await snapshot.build(str(topology_path), serialize.from_yaml(topology_path.read_text()), 1)
        return snapshot._clab_cache[str(topology_path)]

    cached = asyncio.run(_run())

    # The reconciliation pass adds these; the cache must be untouched by it.
    assert "position" not in cached.nodes[0]
    assert "type" not in cached.nodes[0]


def test_transform_completion_is_pushed_to_the_ui(tmp_path, monkeypatch):
    """The frontend refreshes on this event instead of polling, so a transform
    that finishes must always announce itself — including the locked-lab path,
    which returns early."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())

    async def _create(*_a, **_kw):
        return {"clab": {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}}

    _install_fake_netlab(monkeypatch, _create)
    published: list[dict] = []
    monkeypatch.setattr(snapshot.events.hub, "publish", published.append)

    async def _run():
        await snapshot.build(str(topology_path), topo, 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)

    asyncio.run(_run())

    assert {"type": "transform", "path": str(topology_path)} in published


def test_deployed_lab_still_gets_a_real_transform(tmp_path, monkeypatch):
    """A deployed lab used to fall back to a model preview, because `netlab
    create` refuses to run in a locked directory. The transform now runs against
    a scratch cwd (`isolated=True`), which netlab permits, so pending edits on a
    deployed lab render from the real clab projection like anywhere else."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())
    (tmp_path / "netlab.lock").write_text("")
    isolated_flags: list[bool] = []

    async def _create(_path, *, isolated=False):
        isolated_flags.append(isolated)
        return {"clab": {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}}

    _install_fake_netlab(monkeypatch, _create)

    async def _run():
        await snapshot.build(str(topology_path), topo, 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        return await snapshot.build(str(topology_path), topo, 1)

    snap = asyncio.run(_run())

    assert isolated_flags == [True]
    assert snap["projection"]["source"] == "clab"
    assert next(n for n in snap["nodes"] if n["id"] == "r1")["kind"] == "linux"


def test_locked_preview_is_rerun_once_the_lab_is_torn_down(tmp_path, monkeypatch):
    """The original bug, now reachable only as a safety net: if the transform
    fails *while the lab is deployed*, deployment state is the likely cause, so
    the preview is tagged `locked-preview`. Such a preview used to be cached
    under the YAML hash alone, so after teardown the hash still matched and the
    canvas stayed on it forever — the real transform never ran again until the
    process restarted."""
    topology_path = tmp_path / "lab.yml"
    topology_path.write_text("name: t\nnodes:\n  r1:\n    device: frr\n")
    topo = serialize.from_yaml(topology_path.read_text())
    lock = tmp_path / "netlab.lock"
    lock.write_text("")

    async def _create(_path, *, isolated=False):
        # Fails only while the lab is deployed.
        if lock.exists():
            raise snapshot.runner.NetlabError(["netlab", "create"], 1, "locked lab")
        return {"clab": {"topology": {"nodes": {"r1": {"kind": "linux"}}, "links": []}}}

    _install_fake_netlab(monkeypatch, _create)

    async def _run():
        await snapshot.build(str(topology_path), topo, 0)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        while_locked = await snapshot.build(str(topology_path), topo, 1)

        # Torn down. The YAML never changed, so the hash still matches.
        lock.unlink()
        after_teardown = await snapshot.build(str(topology_path), topo, 2)
        await asyncio.gather(*snapshot._transform_tasks.values(), return_exceptions=True)
        return while_locked, after_teardown, await snapshot.build(str(topology_path), topo, 3)

    while_locked, after_teardown, settled = asyncio.run(_run())

    assert while_locked["projection"]["source"] == "locked-preview"
    # Removing the lock must invalidate the preview and re-run the transform...
    assert after_teardown["projection"]["pending"] is True
    # ...landing on the real thing.
    assert settled["projection"]["source"] == "clab"
    assert next(n for n in settled["nodes"] if n["id"] == "r1")["kind"] == "linux"
