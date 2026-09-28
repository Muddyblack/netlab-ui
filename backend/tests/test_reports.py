import asyncio

from fastapi.testclient import TestClient

from app.main import app
from app.sessions.store import store
from services.lenses import reports
from services.netlab import runner

SHOW_REPORTS = """
md:
  addressing: {name: addressing.md, desc: Node/interface addressing}
html:
  addressing: {name: addressing.html, desc: Node/interface addressing}
  mgmt: {name: mgmt.html, desc: Device management interfaces}
text:
  addressing: {name: addressing, desc: Node/interface addressing}
  nodes: {name: nodes, desc: Node names}
"""


def _fake_netlab(monkeypatch, report_output="<html>ok</html>\n"):
    async def run_command(args, cwd=None):
        assert args[:2] == ["show", "reports"]
        return runner.CommandResult(0, SHOW_REPORTS, "")

    async def run_raw(_path, name):
        return f"{name}:{report_output}"

    monkeypatch.setattr(runner, "run_command", run_command)
    monkeypatch.setattr(reports, "_run_raw", run_raw)


def test_catalog_groups_every_format_of_a_report(tmp_path, monkeypatch):
    _fake_netlab(monkeypatch)
    catalog = {item["id"]: item for item in asyncio.run(reports.catalog(str(tmp_path / "topology.yml")))}
    assert catalog["addressing.md"]["exports"] == ["addressing.md", "addressing.html", "addressing"]
    assert catalog["mgmt.html"]["format"] == "html" and catalog["mgmt.html"]["name"] == "Management"
    assert catalog["nodes"]["format"] == "text"


def test_netlab_log_lines_are_not_part_of_the_report():
    raw = " [INFO] Using lab topology file topology.yml\n<html>\n [INFO] kept inside\n"
    assert reports._strip_log_lines(raw) == "<html>\n [INFO] kept inside\n"


def test_export_endpoint_serves_known_formats_sandboxed(tmp_path, monkeypatch):
    _fake_netlab(monkeypatch)
    path = tmp_path / "lab" / "topology.yml"
    path.parent.mkdir()
    path.write_text("name: t\nnodes: [r1]\n")
    sid = store.create(str(path)).id
    client = TestClient(app)
    res = client.get("/api/topology/reports/export", params={"sessionId": sid, "name": "mgmt.html", "download": False})
    assert res.status_code == 200 and res.text.startswith("mgmt.html:")
    assert res.headers["content-type"].startswith("text/html")
    assert res.headers["content-security-policy"] == "sandbox"
    assert res.headers["content-disposition"] == 'inline; filename="lab-mgmt.html"'
    text = client.get("/api/topology/reports/export", params={"sessionId": sid, "name": "nodes"})
    assert text.headers["content-disposition"] == 'attachment; filename="lab-nodes.txt"'
    unknown = client.get("/api/topology/reports/export", params={"sessionId": sid, "name": "../../etc/passwd"})
    assert unknown.status_code == 404
