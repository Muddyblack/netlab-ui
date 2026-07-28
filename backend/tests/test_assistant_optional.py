"""The feature must be removable.

Whether it is switched off by env var or simply not installed, the rest of the
backend has to come up exactly as before — no routes, no /mcp, no import error.
"""

from __future__ import annotations

import builtins
import importlib

import pytest
from fastapi.testclient import TestClient


def _reload_app(monkeypatch, *, mode: str, block_mcp: bool = False):
    """Re-import the app under a different assistant configuration."""
    monkeypatch.setenv("NETLAB_APP_ASSISTANT", mode)

    if block_mcp:
        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "mcp" or name.startswith("mcp."):
                raise ImportError("no mcp")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", fake_import)
        monkeypatch.setattr(importlib.util, "find_spec", lambda name, *_a, **_k: None if name == "mcp" else True)

    import services.assistant as assistant_pkg

    importlib.reload(importlib.import_module("services.assistant.config"))
    importlib.reload(assistant_pkg)
    assistant_pkg._available = None
    return importlib.reload(importlib.import_module("app.main"))


@pytest.fixture(autouse=True)
def _restore(monkeypatch):
    yield
    # Leave the shared module state as the rest of the suite expects it.
    monkeypatch.undo()
    import services.assistant as assistant_pkg

    importlib.reload(importlib.import_module("services.assistant.config"))
    importlib.reload(assistant_pkg)
    assistant_pkg._available = None
    importlib.reload(importlib.import_module("app.main"))


def test_disabled_by_env(monkeypatch):
    main = _reload_app(monkeypatch, mode="off")
    client = TestClient(main.app)

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/assistant/capabilities").status_code == 404
    assert client.post("/mcp", json={}).status_code == 404


def test_degrades_when_the_dependency_is_missing(monkeypatch):
    main = _reload_app(monkeypatch, mode="auto", block_mcp=True)
    client = TestClient(main.app)

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/assistant/capabilities").status_code == 404


def test_enabled_by_default(monkeypatch):
    if importlib.util.find_spec("mcp") is None:
        pytest.skip("mcp package not installed")
    main = _reload_app(monkeypatch, mode="auto")
    client = TestClient(main.app)

    assert client.get("/api/assistant/capabilities").status_code == 200
    # Present but guarded.
    assert client.post("/mcp", json={}).status_code == 401
