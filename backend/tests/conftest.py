"""Shared fixtures."""

import pytest


@pytest.fixture(autouse=True)
def isolated_home(tmp_path_factory, monkeypatch):
    """Keep tests out of the developer's real ``~/.netlab``.

    Some endpoints (the plugin catalog) install the monitoring plugin link there. Run from the host,
    that re-pointed the link at the host checkout and broke it for the UI running in a container,
    which shares the directory. Tests that need a particular home still set their own."""
    monkeypatch.setenv("HOME", str(tmp_path_factory.mktemp("home")))
