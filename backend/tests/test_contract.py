"""API-level tests for the clab-ui contract endpoints, using FastAPI's TestClient.

These run **without netlab installed**: the snapshot endpoint serves the static
fixture for a not-yet-existing topology, and command/model endpoints operate on a
temp topology file. This is exactly the milestone-1 "spike" path.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.contract import snapshot
from app.main import app
from services import annotations as ann_store
from services.model import serialize
from services.netlab import runner


@pytest.fixture(autouse=True)
def no_netlab_cli(monkeypatch):
    """Hold this suite to its "without netlab installed" promise.

    When netlab *is* on PATH the snapshot endpoint shells out for real: a
    `netlab status` per request, plus a background `netlab create` transform.
    The background one is the problem — it outlives the request that started
    it, and TestClient runs every request on its own event loop, so the task is
    abandoned mid-flight and its subprocess transport is finalized against a
    closed loop. asyncio reports that from `BaseSubprocessTransport.__del__`,
    which pytest surfaces as PytestUnraisableExceptionWarning attributed to
    whichever unrelated test happened to trigger the GC.
    """

    async def no_status(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(runner, "status_for", no_status)
    monkeypatch.setattr(snapshot, "_schedule_transform", lambda *_args, **_kwargs: None)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def topo_path(tmp_path, monkeypatch) -> str:
    # Session creation requires the topology to sit inside a configured
    # workspace, so make the temp dir one.
    monkeypatch.setenv("NETLAB_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("NETLAB_WORKSPACE_CONFIG", str(tmp_path / "ws.json"))
    return str(tmp_path / "lab.yml")


def _new_session(client, topo_path) -> str:
    res = client.post("/api/topology/sessions", json={"topologyPath": topo_path})
    assert res.status_code == 200
    return res.json()["sessionId"]


def test_health(client, monkeypatch):
    # Keep the contract test independent of host-installed CLIs. FastAPI's
    # TestClient runs the app in a helper thread, where spawning Nix-wrapped
    # binaries is both slow and platform-dependent.
    monkeypatch.setattr(runner, "cached_version", lambda: "netlab version 26.07")
    monkeypatch.setattr(runner, "is_installed", lambda: True)
    monkeypatch.setattr(runner, "is_containerlab_installed", lambda: True)
    monkeypatch.setattr(runner, "is_libvirt_installed", lambda: False)
    monkeypatch.setattr(runner, "containerlab_version", lambda: "0.71.0")
    monkeypatch.setattr(runner, "cached_version_components", lambda: [])
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert "netlab" in body


def test_icon_list_is_empty_when_directory_is_missing(client, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))

    res = client.get("/api/lab/icons")

    assert res.status_code == 200
    assert res.json() == {"icons": [], "items": []}


def test_icon_list_scans_netlab_icon_directory(client, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    icons_dir = tmp_path / ".netlab" / "icons"
    icons_dir.mkdir(parents=True)
    (icons_dir / "router.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" />')
    (icons_dir / "host.PNG").write_bytes(b"\x89PNG\r\n\x1a\n")
    (icons_dir / "ignored.txt").write_text("not an icon")

    res = client.get("/api/lab/icons")

    assert res.status_code == 200
    body = res.json()
    assert body["icons"] == ["host", "router"]
    items = {item["name"]: item for item in body["items"]}
    assert set(items) == {"host", "router"}
    assert items["host"]["source"] == "global"
    assert items["host"]["format"] == "png"
    assert items["host"]["dataUri"].startswith("data:image/png;base64,")
    assert items["router"]["format"] == "svg"
    assert items["router"]["dataUri"].startswith("data:image/svg+xml;base64,")


def test_icon_upload_saves_svg_to_netlab_icon_directory(client, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))

    res = client.post(
        "/api/lab/icons/upload",
        files={
            "file": (
                "custom-router.svg",
                b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
                "image/svg+xml",
            )
        },
    )

    assert res.status_code == 200
    assert res.json() == {"ok": True, "message": "uploaded custom-router.svg"}
    saved_icon = tmp_path / ".netlab" / "icons" / "custom-router.svg"
    assert saved_icon.read_bytes() == b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'

    list_res = client.get("/api/lab/icons")
    assert list_res.status_code == 200
    body = list_res.json()
    assert body["icons"] == ["custom-router"]
    assert body["items"][0]["name"] == "custom-router"
    assert body["items"][0]["format"] == "svg"


def test_icon_delete_removes_icon_from_netlab_icon_directory(client, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    icons_dir = tmp_path / ".netlab" / "icons"
    icons_dir.mkdir(parents=True)
    icon_path = icons_dir / "custom-router.svg"
    icon_path.write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    res = client.delete("/api/lab/icons/custom-router")

    assert res.status_code == 200
    assert res.json() == {"ok": True, "message": "deleted custom-router.svg"}
    assert not icon_path.exists()

    list_res = client.get("/api/lab/icons")
    assert list_res.status_code == 200
    assert list_res.json() == {"icons": [], "items": []}


def test_snapshot_serves_fixture_when_empty(client, topo_path, monkeypatch):
    from services.netlab import runner as netlab_runner

    monkeypatch.setattr(netlab_runner, "is_installed", lambda: False)

    sid = _new_session(client, topo_path)
    res = client.post("/api/topology/snapshot", json={"sessionId": sid})
    assert res.status_code == 200
    snap = res.json()["snapshot"]
    assert {n["id"] for n in snap["nodes"]} == {"r1", "r2"}
    assert "yamlContent" in snap and "annotations" in snap


def test_move_command_is_layout_only(client, topo_path):
    sid = _new_session(client, topo_path)
    res = client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "move", "id": "r1", "position": {"x": 42, "y": 7}}},
    )
    assert res.status_code == 200
    body = res.json()
    # clab-ui contract: every command acks with the fresh snapshot inline.
    assert body["type"] == "topology-host:ack"
    assert "snapshot" in body
    # A live drag is not a meaningful undo step.
    assert body["snapshot"]["canUndo"] is False
    # Position landed in the sidecar; the topology YAML stays clean (and absent).
    ann = ann_store.load(topo_path)
    assert ann_store.get_node_annotation(ann, "r1")["position"] == {"x": 42, "y": 7}
    assert not Path(topo_path).exists()


def test_save_positions_command_is_layout_only(client, topo_path):
    sid = _new_session(client, topo_path)
    res = client.post(
        f"/api/topology/command?sessionId={sid}",
        json={
            "sessionId": sid,
            "command": {
                "command": "savePositions",
                "payload": [
                    {"id": "r1", "position": {"x": 160, "y": 80}},
                    {"id": "r2", "position": {"x": 320, "y": 80}},
                ],
                "skipHistory": True,
            },
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "topology-host:ack"
    # skipHistory live update -> no undo checkpoint.
    assert body["snapshot"]["canUndo"] is False
    ann = ann_store.load(topo_path)
    assert ann_store.get_node_annotation(ann, "r1")["position"] == {"x": 160, "y": 80}
    assert ann_store.get_node_annotation(ann, "r2")["position"] == {"x": 320, "y": 80}
    assert not Path(topo_path).exists()


def test_structural_add_node_bumps_revision_and_writes_yaml(client, topo_path):
    sid = _new_session(client, topo_path)
    res = client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "addNode", "id": "r9", "device": "frr"}},
    )
    body = res.json()
    assert body["type"] == "topology-host:ack"
    # Revision starts at 1 (clab-ui's initialRevision) and bumps per command.
    assert body["revision"] == 2
    # A structural edit creates an undoable checkpoint.
    assert body["snapshot"]["canUndo"] is True
    text = Path(topo_path).read_text()
    assert "r9" in text and "frr" in text


def test_duplicated_node_matching_lab_default_stays_inherited(client, topo_path):
    """Duplicating a node that has no explicit `device` (it inherits `defaults.device`)
    must not pin the resolved default onto the clone. clab-ui always round-trips its
    rendering `kind` through `extraData.kind` (see commands.py's `_add_node`), even for
    nodes that never had an explicit device — the clone should still inherit."""
    Path(topo_path).write_text("name: sample\ndefaults:\n  device: frr\nnodes:\n  r1:\n")
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {"type": "addNode", "id": "r1_copy", "extraData": {"kind": "frr"}},
        },
    )
    text = Path(topo_path).read_text()
    assert "r1_copy" in text
    assert "device" not in text.split("r1_copy", 1)[1].split("\n\n")[0]


def test_duplicated_node_with_explicit_device_keeps_it(client, topo_path):
    """A clone whose device genuinely differs from the lab default (an explicit
    per-node override, not just the rendered default) must still keep it."""
    Path(topo_path).write_text("name: sample\ndefaults:\n  device: frr\nnodes:\n  r4:\n    device: linux\n")
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {"type": "addNode", "id": "r4_copy", "extraData": {"kind": "linux"}},
        },
    )
    text = Path(topo_path).read_text()
    assert "r4_copy" in text and "linux" in text


def test_duplicated_node_carries_full_attrs(client, topo_path):
    """Ctrl+D/copy-paste must clone everything the source node had — not just
    device — since clab-ui only round-trips a fixed field whitelist on its own.
    See snapshot.py's `extraData.netlabAttrs` and commands.py's `_add_node`."""
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {
                "type": "addNode",
                "id": "r9_copy",
                "extraData": {
                    "kind": "frr",
                    "netlabAttrs": {"config": ["custom.j2"], "mgmt": {"ipv4": "10.0.0.9"}},
                },
            },
        },
    )
    text = Path(topo_path).read_text()
    assert "r9_copy" in text
    assert "custom.j2" in text
    assert "10.0.0.9" in text


def test_undo_redo_round_trip(client, topo_path):
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "addNode", "id": "r9", "device": "frr"}},
    )
    assert "r9" in Path(topo_path).read_text()

    undo = client.post("/api/topology/command", json={"sessionId": sid, "command": {"command": "undo"}}).json()
    assert undo["type"] == "topology-host:ack"
    assert undo["snapshot"]["canRedo"] is True
    assert "r9" not in Path(topo_path).read_text()

    redo = client.post("/api/topology/command", json={"sessionId": sid, "command": {"command": "redo"}}).json()
    assert redo["type"] == "topology-host:ack"
    assert "r9" in Path(topo_path).read_text()


def test_add_link_then_remove_node_cleans_up(client, topo_path):
    sid = _new_session(client, topo_path)
    for cmd in (
        {"type": "addNode", "id": "a"},
        {"type": "addNode", "id": "b"},
        {"type": "addLink", "source": "a", "target": "b"},
    ):
        client.post("/api/topology/command", json={"sessionId": sid, "command": cmd})
    assert "a-b" in Path(topo_path).read_text()
    client.post("/api/topology/command", json={"sessionId": sid, "command": {"type": "removeNode", "id": "a"}})
    text = Path(topo_path).read_text()
    assert "a-b" not in text


def test_edit_link_persists_endpoint_interfaces(client, topo_path):
    sid = _new_session(client, topo_path)
    for cmd in (
        {"type": "addNode", "id": "a"},
        {"type": "addNode", "id": "b"},
        {"type": "addLink", "source": "a", "target": "b"},
    ):
        client.post("/api/topology/command", json={"sessionId": sid, "command": cmd})

    res = client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {
                "command": "editLink",
                "payload": {
                    "id": "e0",
                    "source": "a",
                    "target": "b",
                    "sourceEndpoint": "eth1",
                    "targetEndpoint": "eth2",
                },
            },
        },
    )
    body = res.json()
    assert body["type"] == "topology-host:ack"

    text = Path(topo_path).read_text()
    assert "interfaces:" in text
    assert "ifname: eth1" in text
    assert "ifname: eth2" in text

    # And the saved interfaces come back in the snapshot edges (no revert to empty).
    snap = client.post("/api/topology/snapshot", json={"sessionId": sid}).json()["snapshot"]
    edge = next(e for e in snap["edges"] if {e["source"], e["target"]} == {"a", "b"})
    assert edge["data"]["sourceEndpoint"] == "eth1"
    assert edge["data"]["targetEndpoint"] == "eth2"

    res = client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {
                "command": "editLink",
                "payload": {
                    "id": "e0",
                    "source": "a",
                    "target": "b",
                    "sourceEndpoint": "",
                    "targetEndpoint": "",
                },
            },
        },
    )
    body = res.json()
    assert body["type"] == "topology-host:ack"

    text = Path(topo_path).read_text()
    assert "interfaces:" not in text
    assert "ifname:" not in text
    assert "  - a-b" in text


def test_set_lab_settings_persists_netlab_fields_and_drops_containerlab_only(client, topo_path):
    sid = _new_session(client, topo_path)

    res = client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {
                "command": "setLabSettings",
                "payload": {
                    "name": "branch-lab",
                    "prefix": "clab-prefix",
                    "mgmt": {
                        "network": "netlab_mgmt",
                        "ipv4-subnet": "192.0.2.0/24",
                        "ipv6-subnet": "2001:db8::/64",
                        "ipv4-gw": "192.0.2.1",
                        "mtu": 1500,
                        "bridge": "br-netlab",
                        "ipv4-range": "192.0.2.128/25",
                        "ipv6-gw": "2001:db8::1",
                        "external-access": True,
                        "driver-opts": {"com.docker.network.bridge.name": "br0"},
                    },
                },
            },
        },
    )

    body = res.json()
    assert body["type"] == "topology-host:ack"

    text = Path(topo_path).read_text()
    topo = serialize.from_yaml(text)
    assert topo.name == "branch-lab"
    assert topo.attrs["management"] == {
        "_network": "netlab_mgmt",
        "ipv4": "192.0.2.0/24",
        "ipv6": "2001:db8::/64",
        "gateway": "192.0.2.1",
        "mtu": 1500,
        "_bridge": "br-netlab",
    }
    assert "prefix:" not in text
    assert "ipv4-range:" not in text
    assert "ipv6-gw:" not in text
    assert "external-access:" not in text
    assert "driver-opts:" not in text


def test_edit_node_rename_updates_links_groups_and_annotations(client, topo_path):
    Path(topo_path).write_text(
        """name: rename-test
groups:
  routers:
    members: [old, r2]
nodes:
  old:
    device: frr
  r2:
    device: frr
links:
  - interfaces:
      - node: old
        ifname: eth1
      - node: r2
        ifname: eth2
"""
    )
    ann_store.save(
        topo_path,
        {
            "nodeAnnotations": [{"id": "old", "groupId": "rack-1", "position": {"x": 10, "y": 20}, "icon": "router"}],
        },
    )
    sid = _new_session(client, topo_path)

    res = client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {
                "command": "editNode",
                "payload": {
                    "id": "old",
                    "oldName": "old",
                    "name": "new",
                },
            },
        },
    )

    body = res.json()
    assert body["type"] == "topology-host:ack"
    text = Path(topo_path).read_text()
    assert "old" not in text
    topo = serialize.from_yaml(text)
    assert topo.node("new") is not None
    assert topo.group("routers").members == ["new", "r2"]
    assert topo.links[0].endpoints == ["new", "r2"]
    assert topo.links[0].attrs["interfaces"][0] == {"node": "new", "ifname": "eth1"}
    assert topo.links[0].attrs["interfaces"][1] == {"node": "r2", "ifname": "eth2"}

    ann = ann_store.load(topo_path)
    assert ann_store.get_node_annotation(ann, "old") is None
    new_ann = ann_store.get_node_annotation(ann, "new")
    assert new_ann["position"] == {"x": 10, "y": 20}
    assert new_ann["icon"] == "router"
    assert new_ann["groupId"] == "rack-1"


def test_remove_node_prunes_orphan_annotations(client, topo_path):
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "addNode", "id": "r1", "device": "frr"}},
    )
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "move", "id": "r1", "position": {"x": 9, "y": 9}}},
    )
    assert ann_store.get_node_annotation(ann_store.load(topo_path), "r1") is not None
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "removeNode", "id": "r1"}},
    )
    # No orphaned position lingers for the deleted node.
    assert ann_store.get_node_annotation(ann_store.load(topo_path), "r1") is None


def test_remove_node_sweeps_stale_interface_reference(topo_path, monkeypatch):
    """A surviving link whose explicit ``interfaces:`` list still references the
    deleted node (a desync the endpoint filter alone misses, e.g. introduced via
    a group) gets that stale entry swept, without losing the link itself."""
    from app.contract import commands
    from services.model.topology import Link, Node, Topology

    desynced = Topology(name="lab")
    desynced.nodes = [Node(name="r1"), Node(name="r2"), Node(name="r3")]
    desynced.links = [
        Link(
            endpoints=["r2", "r3"],
            attrs={"interfaces": [{"node": "r1", "ifname": "eth1"}, {"node": "r2"}, {"node": "r3"}]},
        )
    ]
    monkeypatch.setattr(commands, "load_topology", lambda _path: desynced)

    commands._remove_node(topo_path, {"id": "r1"})

    saved = serialize.from_yaml(Path(topo_path).read_text())
    assert len(saved.links) == 1
    assert "r1" not in saved.links[0].endpoints
    assert set(saved.links[0].endpoints) == {"r2", "r3"}


def test_snapshot_reports_structured_yaml_syntax_error(client, topo_path):
    """A malformed topology YAML returns a 422 with a structured detail (instead
    of a 500 + stack trace), so the UI can point at the broken line."""
    Path(topo_path).write_text("name: lab\nnodes: [r1\n")
    sid = _new_session(client, topo_path)

    res = client.post("/api/topology/snapshot", json={"sessionId": sid})
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["error"] == "YAML syntax error"
    assert isinstance(detail["detail"], str) and detail["detail"]
    assert isinstance(detail["line"], int)


def test_snapshot_applies_saved_position_to_node(client, topo_path, monkeypatch):
    from services.netlab import runner as netlab_runner

    monkeypatch.setattr(netlab_runner, "is_installed", lambda: False)
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "addNode", "id": "r1", "device": "frr"}},
    )
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "move", "id": "r1", "position": {"x": 123, "y": 45}}},
    )
    snap = client.post("/api/topology/snapshot", json={"sessionId": sid}).json()["snapshot"]
    r1 = next(n for n in snap["nodes"] if n["id"] == "r1")
    # Drag position round-trips onto the canvas node (not just the sidecar).
    assert r1["position"] == {"x": 123, "y": 45}


def test_canvas_group_membership_stays_out_of_yaml(client, topo_path):
    sid = _new_session(client, topo_path)
    client.post(
        "/api/topology/command",
        json={"sessionId": sid, "command": {"type": "addNode", "id": "r1", "device": "frr"}},
    )
    client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {"command": "setNodeGroupMembership", "payload": {"nodeId": "r1", "groupId": "rack-1"}},
        },
    )
    # Membership is sidecar view-state; the netlab YAML must not grow a groups: key.
    assert "groups:" not in Path(topo_path).read_text()
    node_anns = ann_store.load(topo_path)["nodeAnnotations"]
    assert {"id": "r1", "groupId": "rack-1"} in node_anns


def test_set_annotations_with_memberships_saves_sidecar_annotations_and_memberships(client, topo_path):
    Path(topo_path).write_text(
        """name: annotation-save-test
nodes:
  r1:
    device: frr
  r2:
    device: frr
"""
    )
    sid = _new_session(client, topo_path)

    res = client.post(
        "/api/topology/command",
        json={
            "sessionId": sid,
            "command": {
                "command": "setAnnotationsWithMemberships",
                "payload": {
                    "annotations": {
                        "freeTextAnnotations": [
                            {"id": "label-1", "text": "Core", "x": 10, "y": 20},
                        ],
                        "freeShapeAnnotations": [
                            {"id": "shape-1", "type": "rect", "x": 5, "y": 6, "width": 70, "height": 40},
                        ],
                        "trafficRateAnnotations": [
                            {"id": "traffic-1", "edgeId": "e1", "rate": "10G"},
                        ],
                        "groupStyleAnnotations": [
                            {"id": "rack-1", "name": "Rack 1", "x": 0, "y": 0, "width": 240, "height": 160},
                        ],
                    },
                    "memberships": [
                        {"nodeId": "r1", "groupId": "rack-1"},
                        {"nodeId": "r2", "groupId": "rack-1"},
                    ],
                },
            },
        },
    )

    body = res.json()
    assert body["type"] == "topology-host:ack"

    ann = ann_store.load(topo_path)
    assert ann["freeTextAnnotations"] == [{"id": "label-1", "text": "Core", "x": 10, "y": 20}]
    assert ann["freeShapeAnnotations"] == [{"id": "shape-1", "type": "rect", "x": 5, "y": 6, "width": 70, "height": 40}]
    assert ann["trafficRateAnnotations"] == [{"id": "traffic-1", "edgeId": "e1", "rate": "10G"}]
    assert ann["groupStyleAnnotations"] == [
        {"id": "rack-1", "name": "Rack 1", "x": 0, "y": 0, "width": 240, "height": 160}
    ]
    assert ann["nodeAnnotations"] == [
        {"id": "r1", "groupId": "rack-1"},
        {"id": "r2", "groupId": "rack-1"},
    ]
    assert "groups:" not in Path(topo_path).read_text()


def test_template_instantiate_endpoint(client, topo_path):
    sid = _new_session(client, topo_path)
    # Seed a room template into the sidecar (templates are a UI concept).
    ann = ann_store.load(topo_path)
    ann["templates"] = [
        {
            "name": "room",
            "nodes": [{"name": "sw", "device": "ovs"}, {"name": "h1", "device": "linux"}],
            "links": [{"endpoints": ["sw", "h1"]}],
            "module": [],
            "includes": [],
        }
    ]
    ann_store.save(topo_path, ann)

    res = client.post(
        "/api/topology/templates/instantiate",
        json={"sessionId": sid, "template": "room", "count": 2},
    )
    assert res.status_code == 200
    yaml = res.json()["yaml"]
    assert "room1_sw" in yaml and "room2_h1" in yaml


def test_template_instantiate_with_coordinates_does_not_crash(client, topo_path):
    sid = _new_session(client, topo_path)
    # Seed a room template containing coordinate fields into the sidecar.
    ann = ann_store.load(topo_path)
    ann["templates"] = [
        {
            "name": "room",
            "nodes": [
                {"name": "sw", "device": "ovs", "x": 100, "y": 200},
                {"name": "h1", "device": "linux", "x": 150, "y": 300},
            ],
            "links": [{"endpoints": ["sw", "h1"]}],
            "module": [],
            "includes": [],
        }
    ]
    ann_store.save(topo_path, ann)

    res = client.post(
        "/api/topology/templates/instantiate",
        json={"sessionId": sid, "template": "room", "count": 2},
    )
    assert res.status_code == 200
    yaml = res.json()["yaml"]
    assert "room1_sw" in yaml and "room2_h1" in yaml


def test_unknown_session_404(client):
    res = client.post("/api/topology/snapshot", json={"sessionId": "nope"})
    assert res.status_code == 404


def test_plugins_endpoint_merges_docs_and_installed_catalog(client, monkeypatch):
    from app.plugins import router as plugins_router

    monkeypatch.setattr(
        plugins_router,
        "_load_docs_plugins",
        lambda: {
            "bgp.policy": {
                "id": "bgp.policy",
                "title": "BGP Routing Policies Plugin",
                "markdown": "# bgp.policy docs",
                "docs_url": "https://netlab.tools/plugins/bgp.policy/",
            }
        },
    )
    monkeypatch.setattr(
        plugins_router,
        "_load_installed_plugins",
        lambda *_: {
            "bgp.policy": {
                "id": "bgp.policy",
                "title": "bgp.policy",
                "markdown": "# installed bgp.policy",
                "docs_url": "https://netlab.tools/plugins/bgp.policy/",
            },
            "proxy-arp": {
                "id": "proxy-arp",
                "title": "proxy-arp",
                "markdown": "# installed proxy-arp",
                "docs_url": "https://netlab.tools/plugins/proxy-arp/",
            },
        },
    )

    res = client.get("/api/plugins")
    assert res.status_code == 200
    body = res.json()
    assert [plugin["id"] for plugin in body] == ["bgp.policy", "proxy-arp"]
    assert body[0]["title"] == "BGP Routing Policies Plugin"
    assert body[0]["docs_url"] == "https://netlab.tools/plugins/bgp.policy/"
    assert body[1]["markdown"] == "# installed proxy-arp"


def test_plugins_endpoint_discovers_from_installed_netsim(client, monkeypatch, tmp_path):
    """Plugins resolve straight from the installed `netsim/extra/` package."""
    from app.plugins import router as plugins_router

    monkeypatch.setattr(plugins_router, "_plugin_docs_dirs", lambda: [])

    # Simulate an installed netlab package: netsim/extra/<plugin>/plugin.py
    extra_dir = tmp_path / "netsim" / "extra"
    plugin_dir = extra_dir / "proxy-arp"
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "plugin.py").write_text("# proxy-arp plugin", encoding="utf-8")
    monkeypatch.setattr(plugins_router, "_plugin_extra_dirs", lambda: [extra_dir])
    # Pin the user legs of the search path so a real ~/.netlab on the dev
    # box cannot leak extra plugins into these assertions.
    monkeypatch.setattr(plugins_router, "_plugin_user_dirs", lambda *_: [])

    res = client.get("/api/plugins")
    assert res.status_code == 200
    body = res.json()
    assert [plugin["id"] for plugin in body] == ["proxy-arp"]
    assert body[0]["docs_url"] == "https://netlab.tools/plugins/proxy-arp/"


def test_plugins_endpoint_discovers_nested_package_layout(client, monkeypatch, tmp_path):
    """Current netlab (≈26.7+) stores dotted plugins as a package tree:
    ``extra/bgp/policy/__init__.py`` → catalog id ``bgp.policy``.

    Namespace dirs (``bgp/``) and submodules under a top-level plugin
    (``tunnel/gre/``) must not pollute the catalog.
    """
    from app.plugins import router as plugins_router

    monkeypatch.setattr(plugins_router, "_plugin_docs_dirs", lambda: [])

    extra_dir = tmp_path / "netsim" / "extra"

    # Nested dotted plugin under a namespace package (no __init__ on parent).
    bgp_policy = extra_dir / "bgp" / "policy"
    bgp_policy.mkdir(parents=True)
    (bgp_policy / "__init__.py").write_text("# bgp.policy", encoding="utf-8")

    # Flat top-level plugin.
    bonding = extra_dir / "bonding"
    bonding.mkdir(parents=True)
    (bonding / "__init__.py").write_text("# bonding", encoding="utf-8")

    # Top-level plugin that also has internal subpackages — only the parent
    # should appear in the catalog.
    tunnel = extra_dir / "tunnel"
    gre = tunnel / "gre"
    gre.mkdir(parents=True)
    (tunnel / "__init__.py").write_text("# tunnel", encoding="utf-8")
    (gre / "__init__.py").write_text("# tunnel.gre internal", encoding="utf-8")

    # Hidden test plugin under a namespace.
    test_fixup = extra_dir / "test" / "fixup"
    test_fixup.mkdir(parents=True)
    (test_fixup / "__init__.py").write_text("# test.fixup", encoding="utf-8")

    monkeypatch.setattr(plugins_router, "_plugin_extra_dirs", lambda: [extra_dir])
    # Pin the user legs of the search path so a real ~/.netlab on the dev
    # box cannot leak extra plugins into these assertions.
    monkeypatch.setattr(plugins_router, "_plugin_user_dirs", lambda *_: [])

    res = client.get("/api/plugins")
    assert res.status_code == 200
    body = res.json()
    assert [plugin["id"] for plugin in body] == ["bgp.policy", "bonding", "tunnel"]
    assert body[0]["docs_url"] == "https://netlab.tools/plugins/bgp.policy/"


def _pin_search_path(monkeypatch, user_dirs, extra_dirs=()):
    """Pin both legs of the plugin search path so discovery is hermetic."""
    from app.plugins import router as plugins_router

    monkeypatch.setattr(plugins_router, "_plugin_docs_dirs", lambda: [])
    monkeypatch.setattr(plugins_router, "_plugin_extra_dirs", lambda: list(extra_dirs))
    monkeypatch.setattr(plugins_router, "_plugin_user_dirs", lambda *_: list(user_dirs))


def test_plugins_endpoint_discovers_single_file_user_plugin(client, monkeypatch, tmp_path):
    """A bare ``<name>.py`` in ``~/.netlab`` is a perfectly valid netlab plugin
    and is how most hand-written ones ship. Discovery used to only look at
    directories under ``netsim/extra``, so these were invisible in the GUI even
    though ``netlab up`` loaded them fine."""
    from services.netlab import plugins as plugin_svc

    user_dir = tmp_path / "dot-netlab"
    user_dir.mkdir()
    (user_dir / "my_tweak.py").write_text(
        '"""Rewrite loopbacks for the campus lab.\n\nSecond paragraph is dropped."""\n'
        "\n"
        "_requires = ['bgp.policy']\n"
        "_execute_after = ['bonding']\n"
        "\n"
        "def init(topology):\n"
        "    pass\n"
        "\n"
        "def post_transform(topology):\n"
        "    pass\n",
        encoding="utf-8",
    )
    _pin_search_path(monkeypatch, [(user_dir, plugin_svc.ORIGIN_USER)])

    res = client.get("/api/plugins")
    assert res.status_code == 200
    plugin = next(p for p in res.json() if p["id"] == "my_tweak")

    assert plugin["origin"] == "user"
    assert plugin["source"] == str(user_dir / "my_tweak.py")
    assert plugin["description"] == "Rewrite loopbacks for the campus lab."
    assert plugin["requires"] == ["bgp.policy"]
    assert plugin["execute_after"] == ["bonding"]
    # Hooks come back in netlab's execution order, not source order.
    assert plugin["hooks"] == ["init", "post_transform"]
    # Custom plugins have no netlab.tools page — don't invent a broken link.
    assert plugin["docs_url"] is None


def test_plugins_endpoint_reports_unreadable_plugin_instead_of_hiding_it(client, monkeypatch, tmp_path):
    """netlab fatals on a plugin it can't parse. Dropping it from the catalog
    would leave the user wondering where their plugin went."""
    from services.netlab import plugins as plugin_svc

    user_dir = tmp_path / "dot-netlab"
    user_dir.mkdir()
    (user_dir / "broken.py").write_text("def init(topology:\n", encoding="utf-8")
    _pin_search_path(monkeypatch, [(user_dir, plugin_svc.ORIGIN_USER)])

    res = client.get("/api/plugins")
    plugin = next(p for p in res.json() if p["id"] == "broken")
    assert "syntax error" in plugin["error"]


def test_plugins_endpoint_records_shadowed_plugin_copies(client, monkeypatch, tmp_path):
    """Earlier search-path entries win. Saying which copy lost is the only way
    to explain "I edited the plugin and nothing changed"."""
    from services.netlab import plugins as plugin_svc

    topo_dir = tmp_path / "lab"
    user_dir = tmp_path / "dot-netlab"
    for directory in (topo_dir, user_dir):
        directory.mkdir()
        (directory / "shared.py").write_text("def init(topology):\n    pass\n", encoding="utf-8")
    _pin_search_path(
        monkeypatch,
        [(topo_dir, plugin_svc.ORIGIN_TOPOLOGY), (user_dir, plugin_svc.ORIGIN_USER)],
    )

    res = client.get("/api/plugins")
    plugin = next(p for p in res.json() if p["id"] == "shared")
    assert plugin["origin"] == "topology"
    assert plugin["source"] == str(topo_dir / "shared.py")
    assert plugin["shadows"] == [str(user_dir / "shared.py")]


def test_plugin_pipeline_resolves_execution_order_and_missing_requires(client, monkeypatch, tmp_path):
    """netlab sorts plugins by ``_requires``/``_execute_after``, so the order in
    ``plugin:`` is not the order they run in — and a missing ``_requires`` is
    fatal at transform time."""
    from services.netlab import plugins as plugin_svc

    user_dir = tmp_path / "dot-netlab"
    user_dir.mkdir()
    (user_dir / "late.py").write_text(
        "_requires = ['early', 'never_enabled']\n\ndef post_transform(topology):\n    pass\n",
        encoding="utf-8",
    )
    (user_dir / "early.py").write_text("def init(topology):\n    pass\n", encoding="utf-8")
    _pin_search_path(monkeypatch, [(user_dir, plugin_svc.ORIGIN_USER)])

    res = client.get("/api/plugins/pipeline?enabled=late&enabled=early")
    assert res.status_code == 200
    body = res.json()

    assert [entry["id"] for entry in body["order"]] == ["early", "late"]
    assert body["reordered"] is True
    assert body["order"][1]["missing_requires"] == ["never_enabled"]
    assert body["order"][0]["hooks"] == ["init"]


def test_plugin_pipeline_keeps_unknown_plugins_visible(client, monkeypatch, tmp_path):
    """A typo'd plugin name must not silently vanish from the pipeline view —
    that's exactly the case the user needs to see."""
    _pin_search_path(monkeypatch, [])

    res = client.get("/api/plugins/pipeline?enabled=typo.plugin")
    assert res.status_code == 200
    body = res.json()
    assert body["order"] == [{"id": "typo.plugin", "known": False, "hooks": [], "missing_requires": []}]


def test_plugin_import_writes_uploaded_plugin_to_search_path(client, monkeypatch, tmp_path):
    """Uploading from the browser is the only import route that works in the
    web app, where the user's file never exists on the server."""
    from services.netlab import plugins as plugin_svc

    dest = tmp_path / "dot-netlab"
    _pin_search_path(monkeypatch, [(dest, plugin_svc.ORIGIN_USER)])
    monkeypatch.setattr(plugin_svc, "destination_dir", lambda *_: dest)

    res = client.post(
        "/api/plugins/import",
        json={
            "name": "my_tweak",
            "destination": "user",
            "content": '"""Does a thing."""\n\ndef post_transform(topology):\n    pass\n',
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert (dest / "my_tweak.py").is_file()
    assert body["path"] == str(dest / "my_tweak.py")
    assert body["plugin"]["origin"] == "user"
    assert body["plugin"]["hooks"] == ["post_transform"]
    assert body["warnings"] == []


def test_plugin_import_symlinks_instead_of_copying(client, monkeypatch, tmp_path):
    """Linking keeps the user's own file as the source of truth, so their next
    edit takes effect without a re-import."""
    from services.netlab import plugins as plugin_svc

    original = tmp_path / "src" / "my_tweak.py"
    original.parent.mkdir()
    original.write_text("def init(topology):\n    pass\n", encoding="utf-8")

    dest = tmp_path / "dot-netlab"
    _pin_search_path(monkeypatch, [(dest, plugin_svc.ORIGIN_USER)])
    monkeypatch.setattr(plugin_svc, "destination_dir", lambda *_: dest)

    res = client.post(
        "/api/plugins/import",
        json={
            "name": "my_tweak",
            "destination": "user",
            "sourcePath": str(original),
            "link": True,
        },
    )
    assert res.status_code == 200, res.text
    assert (dest / "my_tweak.py").is_symlink()
    assert (dest / "my_tweak.py").resolve() == original.resolve()


def test_plugin_import_rejects_unparsable_python(client, monkeypatch, tmp_path):
    """Better to fail the import than to let a broken file abort the user's
    next `netlab up` with a loader stack trace."""
    from services.netlab import plugins as plugin_svc

    dest = tmp_path / "dot-netlab"
    _pin_search_path(monkeypatch, [(dest, plugin_svc.ORIGIN_USER)])
    monkeypatch.setattr(plugin_svc, "destination_dir", lambda *_: dest)

    res = client.post(
        "/api/plugins/import",
        json={"name": "broken", "destination": "user", "content": "def init(topology:\n"},
    )
    assert res.status_code == 400
    assert "not valid Python" in res.json()["detail"]
    assert not (dest / "broken.py").exists()


def test_plugin_import_warns_when_no_hooks_are_defined(client, monkeypatch, tmp_path):
    """A file with no netlab hooks loads fine and does nothing — silently
    accepting it would look like the plugin simply didn't work."""
    from services.netlab import plugins as plugin_svc

    dest = tmp_path / "dot-netlab"
    _pin_search_path(monkeypatch, [(dest, plugin_svc.ORIGIN_USER)])
    monkeypatch.setattr(plugin_svc, "destination_dir", lambda *_: dest)

    res = client.post(
        "/api/plugins/import",
        json={"name": "inert", "destination": "user", "content": "VALUE = 1\n"},
    )
    assert res.status_code == 200
    assert any("none of netlab's plugin hooks" in w for w in res.json()["warnings"])


def test_plugin_import_refuses_overwrite_and_path_escape(client, monkeypatch, tmp_path):
    from services.netlab import plugins as plugin_svc

    dest = tmp_path / "dot-netlab"
    dest.mkdir()
    (dest / "taken.py").write_text("def init(topology):\n    pass\n", encoding="utf-8")
    _pin_search_path(monkeypatch, [(dest, plugin_svc.ORIGIN_USER)])
    monkeypatch.setattr(plugin_svc, "destination_dir", lambda *_: dest)

    existing = client.post(
        "/api/plugins/import",
        json={"name": "taken", "destination": "user", "content": "def init(t):\n    pass\n"},
    )
    assert existing.status_code == 400
    assert "already exists" in existing.json()["detail"]

    # A name is a module name, never a path — it must not be able to escape.
    escape = client.post(
        "/api/plugins/import",
        json={"name": "../evil", "destination": "user", "content": "def init(t):\n    pass\n"},
    )
    assert escape.status_code == 400
    assert not (tmp_path / "evil.py").exists()


def test_plugin_import_to_topology_requires_an_open_lab(client, monkeypatch, tmp_path):
    _pin_search_path(monkeypatch, [])

    res = client.post(
        "/api/plugins/import",
        json={"name": "my_tweak", "destination": "topology", "content": "def init(t):\n    pass\n"},
    )
    assert res.status_code == 400
    assert "No lab is open" in res.json()["detail"]


def test_plugin_template_is_a_valid_plugin(client):
    """The scaffold we hand users must itself pass the import validation —
    otherwise "New plugin" produces something the app then rejects."""
    res = client.get("/api/plugins/template?name=my_tweak")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "my_tweak"

    from services.netlab import plugins as plugin_svc

    assert plugin_svc.validate_source(body["content"], "my_tweak") == []


def test_plugins_endpoint_reports_discovery_error_when_empty(client, monkeypatch):
    from app.plugins import router as plugins_router

    monkeypatch.setattr(plugins_router, "_load_docs_plugins", lambda: {})
    monkeypatch.setattr(plugins_router, "_load_installed_plugins", lambda *_: {})
    monkeypatch.setattr(
        plugins_router,
        "_discovery_details",
        lambda *_: {
            "discovered_docs_dirs": [],
            "discovered_extra_dirs": [],
            "cwd": "/cwd",
            "netsim_paths": [],
            "installed_extra_dir": None,
        },
    )

    res = client.get("/api/plugins")
    assert res.status_code == 503
    assert "No netlab plugins were discovered." in res.json()["detail"]


# ------------------------- netlab multiserver plugin ----------------------- #
_MS_TOPO = """name: ms-test
groups:
  spines:
    members: [s1, s2]
nodes:
  s1:
    device: frr
  s2:
    device: frr
  l1:
    device: frr
"""


def test_get_multiserver_empty_when_block_absent(client, topo_path):
    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    res = client.get(f"/api/topology/multiserver?sessionId={sid}")
    assert res.status_code == 200
    body = res.json()
    assert body["enabled"] is False
    assert body["servers"] == []
    # Picker data is available for authoring even before enabling the plugin.
    assert set(body["nodes"]) == {"s1", "s2", "l1"}
    assert body["groups"] == ["spines"]


def test_save_multiserver_writes_block_and_enables_plugin(client, topo_path):
    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    res = client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={
            "enabled": True,
            "assignment": "explicit",
            "servers": [
                {"name": "srv1", "host": "10.0.0.1", "groups": ["spines"]},
                {"name": "srv2", "host": "10.0.0.2", "weight": 2, "members": ["l1"]},
            ],
            "vxlan": {"dev": "eth0"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["enabled"] is True
    assert {s["name"] for s in body["servers"]} == {"srv1", "srv2"}
    srv2 = next(s for s in body["servers"] if s["name"] == "srv2")
    assert srv2["weight"] == 2 and srv2["members"] == ["l1"]

    text = Path(topo_path).read_text()
    assert "multiserver" in text
    # Plugin list gets the multiserver entry so netlab actually runs it.
    topo = serialize.from_yaml(text)
    assert "multiserver" in topo.attrs.get("plugin", [])
    assert topo.attrs["multiserver"]["vxlan"]["dev"] == "eth0"
    # Default weight (1) is omitted to keep the YAML clean.
    assert "weight" not in topo.attrs["multiserver"]["servers"]["srv1"]


def test_disable_multiserver_removes_block_and_plugin(client, topo_path):
    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={"enabled": True, "servers": [{"name": "srv1", "host": "10.0.0.1"}], "vxlan": {"dev": "eth0"}},
    )
    res = client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={"enabled": False},
    )
    assert res.status_code == 200
    assert res.json()["enabled"] is False
    topo = serialize.from_yaml(Path(topo_path).read_text())
    assert "multiserver" not in topo.attrs
    assert "multiserver" not in topo.attrs.get("plugin", [])


def test_resolved_placement_reads_generated_server_dirs(client, topo_path):
    Path(topo_path).write_text(_MS_TOPO)
    base = Path(topo_path).parent
    srv1 = base / "server-srv1"
    srv1.mkdir()
    (srv1 / "clab.yml").write_text("topology:\n  nodes:\n    s1: {}\n    s2: {}\n")
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={"enabled": True, "servers": [{"name": "srv1", "host": "10.0.0.1"}], "vxlan": {"dev": "eth0"}},
    )
    res = client.get(f"/api/topology/multiserver?sessionId={sid}")
    srv1_info = next(s for s in res.json()["servers"] if s["name"] == "srv1")
    assert set(srv1_info["resolvedNodes"]) == {"s1", "s2"}


def test_placement_status_not_created_before_create(client, topo_path):
    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={"enabled": True, "servers": [{"name": "srv1", "host": "10.0.0.1"}], "vxlan": {"dev": "eth0"}},
    )
    # No server-*/ dirs on disk -> the panel prompts a create instead of blanking.
    res = client.get(f"/api/topology/multiserver?sessionId={sid}")
    assert res.json()["placementStatus"] == "not_created"


def test_placement_status_stale_when_topology_newer_than_generated(client, topo_path):
    import os
    import time

    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={"enabled": True, "servers": [{"name": "srv1", "host": "10.0.0.1"}], "vxlan": {"dev": "eth0"}},
    )
    # Generate a worker dir, then backdate it so the topology YAML (rewritten by
    # the PUT above) is newer — the "edited since last create" case.
    base = Path(topo_path).parent
    srv1 = base / "server-srv1"
    srv1.mkdir()
    clab = srv1 / "clab.yml"
    clab.write_text("topology:\n  nodes:\n    s1: {}\n")
    old = time.time() - 100
    os.utime(clab, (old, old))
    res = client.get(f"/api/topology/multiserver?sessionId={sid}")
    assert res.json()["placementStatus"] == "stale"


def test_placement_status_ready_when_generated_after_topology(client, topo_path):
    import os
    import time

    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={"enabled": True, "servers": [{"name": "srv1", "host": "10.0.0.1"}], "vxlan": {"dev": "eth0"}},
    )
    base = Path(topo_path).parent
    srv1 = base / "server-srv1"
    srv1.mkdir()
    clab = srv1 / "clab.yml"
    clab.write_text("topology:\n  nodes:\n    s1: {}\n")
    future = time.time() + 100
    os.utime(clab, (future, future))
    res = client.get(f"/api/topology/multiserver?sessionId={sid}")
    assert res.json()["placementStatus"] == "ready"


def test_resolved_placement_honors_custom_output_dir_template(client, topo_path):
    """A custom multiserver.output_dir (not starting with 'server-') must still be
    discovered, so placement works for any topology config."""
    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={
            "enabled": True,
            "servers": [{"name": "srv1", "host": "10.0.0.1", "members": ["s1"]}],
            "vxlan": {"dev": "eth0"},
        },
    )
    # Add the custom template directly (panel PUT doesn't expose output_dir).
    from services.model import serialize

    topo = serialize.from_yaml(Path(topo_path).read_text())
    topo.attrs["multiserver"]["output_dir"] = "worker_{server_name}"
    Path(topo_path).write_text(serialize.to_yaml(topo))

    base = Path(topo_path).parent
    wdir = base / "worker_srv1"
    wdir.mkdir()
    (wdir / "clab.yml").write_text("topology:\n  nodes:\n    s1: {}\n")
    import os
    import time

    future = time.time() + 100
    os.utime(wdir / "clab.yml", (future, future))

    res = client.get(f"/api/topology/multiserver?sessionId={sid}")
    body = res.json()
    srv1 = next(s for s in body["servers"] if s["name"] == "srv1")
    assert srv1["resolvedNodes"] == ["s1"]
    assert body["placementStatus"] == "ready"


def test_resolved_placement_honors_server_id_in_template(client, topo_path):
    """output_dir templates using {server_id} resolve to the plugin's auto-assigned
    ids (1-based in declaration order, explicit ids honored)."""
    Path(topo_path).write_text(_MS_TOPO)
    sid = _new_session(client, topo_path)
    client.put(
        f"/api/topology/multiserver?sessionId={sid}",
        json={
            "enabled": True,
            "servers": [
                {"name": "alpha", "host": "10.0.0.1", "members": ["s1"]},
                {"name": "beta", "host": "10.0.0.2", "members": ["s2"]},
            ],
            "vxlan": {"dev": "eth0"},
        },
    )
    from services.model import serialize

    topo = serialize.from_yaml(Path(topo_path).read_text())
    topo.attrs["multiserver"]["output_dir"] = "srv{server_id}"
    Path(topo_path).write_text(serialize.to_yaml(topo))

    base = Path(topo_path).parent
    import os
    import time

    future = time.time() + 100
    # alpha -> id 1 -> srv1, beta -> id 2 -> srv2
    for dname, node in (("srv1", "s1"), ("srv2", "s2")):
        d = base / dname
        d.mkdir()
        (d / "clab.yml").write_text(f"topology:\n  nodes:\n    {node}: {{}}\n")
        os.utime(d / "clab.yml", (future, future))

    body = client.get(f"/api/topology/multiserver?sessionId={sid}").json()
    placement = {s["name"]: s["resolvedNodes"] for s in body["servers"]}
    assert placement == {"alpha": ["s1"], "beta": ["s2"]}
