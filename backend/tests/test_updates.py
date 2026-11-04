from fastapi.testclient import TestClient

from netlab_ui.app.main import app
from netlab_ui.services import updates


def test_version_comparison():
    assert updates.is_newer("0.0.4", "0.0.3")
    assert updates.is_newer("0.1", "v0.0.9")
    assert not updates.is_newer("0.0.3", "0.0.3")
    assert not updates.is_newer("0.0.3", "0.0.10")
    assert not updates.is_newer("0.0.4", "0.0.3-5-gabc123-dirty")  # a checkout never nags
    assert not updates.is_newer(None, "0.0.3")


def test_status_only_when_newer_and_allowed(monkeypatch):
    monkeypatch.setattr(updates, "latest_release", lambda: "0.0.4")
    assert updates.status("0.0.3", ["pipx", "upgrade", "netlab-ui"])["available"] is True
    assert updates.status("0.0.4", None)["available"] is False
    assert updates.status("dev", None)["latest"] is None
    monkeypatch.setenv("NETLAB_UI_UPDATE_CHECK", "off")
    assert updates.status("0.0.3", None)["available"] is False


def test_failed_lookup_is_retried_later(monkeypatch):
    calls = []
    monkeypatch.setattr(updates, "_cache", None)
    monkeypatch.setattr(updates, "_fetch_latest", lambda: calls.append(1))
    assert updates.latest_release() is None
    assert updates.latest_release() is None
    assert len(calls) == 1  # not hammering PyPI while it is unreachable


def test_update_route(monkeypatch):
    monkeypatch.setattr(updates, "latest_release", lambda: "99.0.0")
    monkeypatch.setattr("netlab_ui.app.main.APP_VERSION", "0.0.3")
    body = TestClient(app).get("/api/update").json()
    assert body["available"] is True and body["latest"] == "99.0.0"
    assert body["releaseUrl"].endswith("/tag/v99.0.0")
