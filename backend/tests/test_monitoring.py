"""Lab monitoring: plugin install, topology toggle, stack state and the PromQL proxy."""

import asyncio
import json

from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services import monitoring


def test_toggle_adds_and_removes_the_plugin_and_placement():
    attrs = {"plugin": ["fabric"]}
    monitoring.set_enabled(attrs, True, "node")
    assert attrs["plugin"] == ["fabric", "monitoring"]
    assert attrs["monitoring"] == {"placement": "node"}
    assert monitoring.enabled(attrs) and monitoring.placement(attrs) == "node"
    monitoring.set_enabled(attrs, True, "tool")
    assert "monitoring" not in attrs and monitoring.placement(attrs) == "tool"
    monitoring.set_enabled(attrs, False)
    assert attrs["plugin"] == ["fabric"]
    monitoring.set_enabled(attrs, False)
    attrs = {"plugin": "monitoring"}  # netlab also accepts a single string
    monitoring.set_enabled(attrs, False)
    assert "plugin" not in attrs


def test_install_links_the_shipped_plugin_into_netlab_user_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert monitoring.plugin_source() is not None
    state = monitoring.install_plugin()
    link = tmp_path / ".netlab" / "monitoring"
    assert link.is_symlink() and state["installed"] and state["managed"]
    # A user's own plugin directory wins and is not replaced
    link.unlink()
    (link / "x").mkdir(parents=True)
    (link / "__init__.py").write_text("")
    state = monitoring.install_plugin()
    assert not link.is_symlink() and state["installed"] and not state["managed"]


def test_state_reads_the_rendered_stack_and_plan(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    path = tmp_path / "topology.yml"
    path.write_text("name: t\nplugin: [ monitoring ]\nnodes: [r1]\n")
    mon = tmp_path / "monitoring"
    mon.mkdir()
    (mon / "stack.json").write_text(
        json.dumps(
            {
                "lab": "t",
                "placement": "tool",
                "containers": {"collector": "t_mon_collector"},
                "tsdb_url": "http://127.0.0.1:8428",
                "tsdb_port": 8428,
                "grafana_port": 3000,
                "dashboards": {"overview": "netlab-overview"},
            }
        )
    )
    (mon / "plan.json").write_text(
        json.dumps({"nodes": {"r1": {"device": "frr", "provider": "clab", "methods": ["host", "frr"]}}})
    )

    async def running(containers):
        return dict.fromkeys(containers, True)

    monkeypatch.setattr(monitoring, "running_containers", running)
    sid = store.create(str(path)).id
    res = TestClient(app).get("/api/lab/monitoring", params={"sessionId": sid})
    assert res.status_code == 200
    body = res.json()
    assert body["enabled"] and body["rendered"] and body["running"] == {"collector": True}
    assert body["grafanaPort"] == 3000
    assert body["coverage"] == [{"node": "r1", "device": "frr", "provider": "clab", "methods": ["host", "frr"]}]


def test_enabling_from_the_api_installs_the_plugin_and_edits_the_topology(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    path = tmp_path / "topology.yml"
    path.write_text("name: t\nnodes: [r1]\n")
    sid = store.create(str(path)).id
    client = TestClient(app)
    res = client.put("/api/lab/monitoring", json={"sessionId": sid, "enabled": True, "placement": "node"})
    assert res.status_code == 200 and res.json()["enabled"] and res.json()["pluginInstalled"]
    text = path.read_text()
    assert "monitoring" in text and "placement: node" in text
    res = client.put("/api/lab/monitoring", json={"sessionId": sid, "enabled": False, "placement": "tool"})
    assert not res.json()["enabled"] and "monitoring" not in path.read_text()


def test_query_and_summary_use_the_labs_metrics_store(tmp_path, monkeypatch):
    mon = tmp_path / "monitoring"
    mon.mkdir()
    (mon / "stack.json").write_text(json.dumps({"lab": "t", "tsdb_url": "http://127.0.0.1:1"}))
    urls = []

    def fake_http(url, **_kwargs):
        urls.append(url)
        if "unless" in url:
            if "netlab_expected_bgp_session" in url:
                return {
                    "status": "success",
                    "data": {
                        "result": [{"metric": {"node": "r1", "peer": "10.0.0.2", "peer_node": "r2"}, "value": [0, "1"]}]
                    },
                }
            return {"status": "success", "data": {"result": []}}
        return {"status": "success", "data": {"result": [{"metric": {}, "value": [0, "3"]}]}}

    monkeypatch.setattr(monitoring, "_http_json", fake_http)
    result = asyncio.run(monitoring.summary(tmp_path))
    assert result["nodes"] == 3 and result["bgpExpected"] == 3
    assert result["missing"] == [{"protocol": "BGP", "node": "r1", "peer": "r2", "detail": "10.0.0.2"}]
    assert all(u.startswith("http://127.0.0.1:1/api/v1/query?") for u in urls)
    assert "lab%3D%22t%22" in urls[0]


def test_query_without_rendered_stack_is_a_clear_error(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text("name: t\nnodes: [r1]\n")
    sid = store.create(str(path)).id
    res = TestClient(app).get("/api/lab/monitoring/query", params={"sessionId": sid, "query": "up"})
    assert res.status_code == 409 and "not set up" in res.json()["detail"]


def test_annotation_is_skipped_without_grafana(tmp_path):
    assert asyncio.run(monitoring.annotate(tmp_path, "r1 eth1 down", ["link"])) is False


def test_workspace_watcher_ignores_the_metrics_store():
    from watchfiles import Change

    from services import events

    keep = events._workspace_filter()
    assert keep(Change.modified, "/ws/lab/topology.yml")
    assert not keep(Change.added, "/ws/lab/monitoring/data/tsdb/data/small/part.bin")
    assert keep(Change.modified, "/ws/lab/monitoring/plan.json")
