import sys

import pytest
from fastapi.testclient import TestClient

from app.lab import pcap
from app.main import app
from app.sessions.store import store
from services.netlab import runner


@pytest.fixture
def session(tmp_path, monkeypatch):
    path = tmp_path / "topology.yml"
    path.write_text("name: t\nnodes: [r1, vm]\n")

    async def status_for(_path):
        return {"nodes": {"r1": {"provider": "clab", "provider_name": "clab-t-r1"}, "vm": {"provider": "external"}}}

    monkeypatch.setattr(runner, "status_for", status_for)
    return store.create(str(path)).id


def test_pcap_needs_a_lab_and_a_sane_interface(session):
    client = TestClient(app)
    assert client.get("/api/lab/capture/pcap", params={"node": "r1", "interface": "eth1"}).status_code == 400
    odd = client.get("/api/lab/capture/pcap", params={"sessionId": session, "node": "r1", "interface": "eth1 -w /x"})
    assert odd.status_code == 400
    vm = client.get("/api/lab/capture/pcap", params={"sessionId": session, "node": "vm", "interface": "eth1"})
    assert vm.status_code == 409


def test_pcap_streams_the_helpers_output_as_a_download(session, monkeypatch):
    async def pid(_container, _runtime):
        return 4242

    monkeypatch.setattr(pcap, "_container_pid", pid)
    # Stand-in helper: a pcap header plus one 4-byte record, no namespaces.
    monkeypatch.setattr(
        pcap,
        "_CAPTURE_SCRIPT",
        "import sys,struct;o=sys.stdout.buffer;o.write(struct.pack('<IHHiIII',0xA1B2C3D4,2,4,0,0,262144,1));"
        "o.write(struct.pack('<IIII',1,0,4,4)+b'abcd')",
    )
    monkeypatch.setattr(pcap.sys, "executable", sys.executable)
    res = TestClient(app).get("/api/lab/capture/pcap", params={"sessionId": session, "node": "r1", "interface": "eth1"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/vnd.tcpdump.pcap"
    assert 'filename="r1-eth1-' in res.headers["content-disposition"]
    assert len(res.content) == 24 + 16 + 4


def test_pcap_reports_a_helper_that_fails_before_the_header(session, monkeypatch):
    async def pid(_container, _runtime):
        return 4242

    monkeypatch.setattr(pcap, "_container_pid", pid)
    monkeypatch.setattr(pcap, "_CAPTURE_SCRIPT", "import sys; sys.exit('cannot capture on eth1: No such device')")
    res = TestClient(app).get("/api/lab/capture/pcap", params={"sessionId": session, "node": "r1", "interface": "eth1"})
    assert res.status_code == 502
    assert "No such device" in res.json()["detail"]
