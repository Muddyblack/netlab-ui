import asyncio

from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services.netlab import tools


def test_catalog_reads_netlabs_tool_definitions():
    ids = {tool["id"]: tool for tool in tools.catalog()}
    assert {"graphite", "suzieq", "edgeshark"} <= set(ids)
    assert "netlab_ui" not in ids
    assert ids["suzieq"]["canConnect"] and not ids["graphite"]["canConnect"]
    assert ids["graphite"]["title"] == "Graphite"


def test_enabling_keeps_settings_and_disabling_the_last_tool_drops_the_key():
    attrs = {"tools": {"graphite": {"port": 9000}}}
    tools.set_enabled(attrs, "graphite", True)
    tools.set_enabled(attrs, "suzieq", True)
    assert attrs["tools"] == {"graphite": {"port": 9000}, "suzieq": None}
    tools.set_enabled(attrs, "graphite", False)
    tools.set_enabled(attrs, "suzieq", False)
    assert "tools" not in attrs


def test_urls_come_from_netlabs_message():
    message = "Open http://127.0.0.1:8080/graphite/ in your browser. Or http://[::1]:8888."
    assert tools.urls(message) == ["http://127.0.0.1:8080/graphite/", "http://[::1]:8888"]


def test_pull_progress_is_dropped_from_tool_output():
    output = "\n".join(
        [
            "Unable to find image 'x' locally",
            "0.4.2: Pulling from netreplica/graphite",
            "de611ff764da: Pull complete",
            "abc123",
        ]
    )
    assert tools._clean(output) == "Unable to find image 'x' locally\nabc123"


def test_lab_tools_combines_topology_snapshot_and_container_state(tmp_path, monkeypatch):
    (tmp_path / tools.SNAPSHOT).write_bytes(b"")

    async def bridge(_lab_dir, *args, **_kwargs):
        assert args == ("info",)
        info = {"message": "Open http://127.0.0.1:8080/graphite/", "containers": ["lab_graphite"], "canConnect": False}
        return 0, {"tools": {"graphite": info}}

    async def running(containers):
        return containers == ["lab_graphite"]

    monkeypatch.setattr(tools, "_bridge", bridge)
    monkeypatch.setattr(tools, "_running", running)
    result = {t["id"]: t for t in asyncio.run(tools.lab_tools(tmp_path, {"tools": {"graphite": None, "suzieq": None}}))}
    assert result["graphite"]["deployed"] and result["graphite"]["running"]
    assert result["graphite"]["urls"] == ["http://127.0.0.1:8080/graphite/"]
    assert result["suzieq"]["enabled"] and not result["suzieq"]["deployed"]
    assert not result["nuts"]["enabled"]


def test_endpoints_toggle_tools_in_the_topology_and_refuse_undeployed_actions(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text("name: t\nnodes: [r1]\n")
    sid = store.create(str(path)).id
    client = TestClient(app)
    res = client.put("/api/lab/tools", json={"sessionId": sid, "tool": "graphite", "enabled": True})
    assert res.status_code == 200
    assert next(t for t in res.json()["tools"] if t["id"] == "graphite")["enabled"]
    assert "graphite" in path.read_text()
    assert client.put("/api/lab/tools", json={"sessionId": sid, "tool": "x; rm", "enabled": True}).status_code == 400
    res = client.post("/api/lab/tools/action", json={"sessionId": sid, "tool": "graphite", "action": "up"})
    assert res.json()["code"] == 1 and "isn't deployed" in res.json()["stderr"]


def test_clab_tarball_needs_a_deployed_lab_and_cleans_up(tmp_path, monkeypatch):
    from services.netlab import runner, setup

    path = tmp_path / "topology.yml"
    path.write_text("name: t\nnodes: [r1]\n")
    sid = store.create(str(path)).id
    client = TestClient(app)
    assert client.get("/api/lab/clab-tarball", params={"sessionId": sid}).status_code == 409

    (tmp_path / tools.SNAPSHOT).write_bytes(b"")
    out = tmp_path / "out"

    async def tarball(_path):
        out.mkdir()
        (out / "t.tar.gz").write_bytes(b"tar")
        return out / "t.tar.gz", runner.CommandResult(0, "", "")

    monkeypatch.setattr(setup, "clab_tarball", tarball)
    res = client.get("/api/lab/clab-tarball", params={"sessionId": sid})
    assert res.status_code == 200 and res.content == b"tar"
    assert 'filename="t.tar.gz"' in res.headers["content-disposition"]
    assert not out.exists()


def test_netlab_children_get_the_lab_directory_as_pwd(tmp_path):
    from services.netlab import runner

    # netlab's Ansible playbooks find the lab through $PWD, not the process cwd.
    assert runner._child_env(tmp_path)["PWD"] == str(tmp_path.resolve())
