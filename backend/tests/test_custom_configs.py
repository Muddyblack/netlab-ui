from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services.netlab import custom_configs


def test_discovery_finds_directory_and_file_templates_but_not_lab_artifacts(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    (tmp_path / "ospf-tweaks").mkdir()
    (tmp_path / "ospf-tweaks" / "frr.j2").write_text("")
    (tmp_path / "ospf-tweaks" / "eos.j2").write_text("")
    (tmp_path / "banner.j2").write_text("")
    (tmp_path / "banner.frr.j2").write_text("")
    (tmp_path / "host_vars" / "r1").mkdir(parents=True)
    (tmp_path / "reports").mkdir()
    (tmp_path / "reports" / "mine.md.j2").write_text("")
    (tmp_path / "myplugin").mkdir()
    (tmp_path / "myplugin" / "plugin.py").write_text("")
    (tmp_path / "myplugin" / "frr.j2").write_text("")
    user = tmp_path / "home" / ".netlab" / "motd"
    user.mkdir(parents=True)
    (user / "linux.j2").write_text("")

    found = {item["name"]: item for item in custom_configs.discover(tmp_path)}
    assert set(found) == {"ospf-tweaks", "banner", "motd"}
    assert found["ospf-tweaks"]["variants"] == ["eos", "frr"] and found["ospf-tweaks"]["editable"]
    assert found["banner"]["variants"] == ["any device", "frr"]
    assert found["motd"]["source"] == "user" and not found["motd"]["editable"]


def test_endpoints_create_a_starter_for_the_labs_default_device(tmp_path):
    path = tmp_path / "topology.yml"
    path.write_text("name: t\ndefaults.device: frr\nnodes: {r1: {}, r2: {device: eos}}\n")
    sid = store.create(str(path)).id
    client = TestClient(app)
    listing = client.get("/api/lab/custom-configs", params={"sessionId": sid}).json()
    assert listing == {"templates": [], "devices": ["eos", "frr"], "defaultDevice": "frr"}

    res = client.post("/api/lab/custom-configs", json={"sessionId": sid, "name": "ospf-tweaks"})
    created = Path(res.json()["path"])
    assert created == tmp_path / "ospf-tweaks" / "frr.j2"
    assert "config: [ospf-tweaks]" in created.read_text()
    created.write_text("mine")
    client.post("/api/lab/custom-configs", json={"sessionId": sid, "name": "ospf-tweaks", "device": "frr"})
    assert created.read_text() == "mine"  # never overwritten

    bad = client.post("/api/lab/custom-configs", json={"sessionId": sid, "name": "../x", "device": "frr"})
    assert bad.status_code == 400
    reserved = client.post("/api/lab/custom-configs", json={"sessionId": sid, "name": "host_vars", "device": "frr"})
    assert reserved.status_code == 400
