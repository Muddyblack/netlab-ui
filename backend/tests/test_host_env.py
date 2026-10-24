import os
import stat
from types import SimpleNamespace

import pytest

from netlab_gui.services import host_env


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setattr(host_env, "_cache", None)
    monkeypatch.setattr(host_env.container_env, "in_container", lambda: False)


def _fake_clab(monkeypatch, tmp_path, *, mode, uid=0, gid=1234):
    clab = tmp_path / "containerlab"
    clab.write_text("")
    real = clab.stat()
    info = SimpleNamespace(st_uid=uid, st_gid=gid, st_mode=stat.S_IFREG | mode, st_size=real.st_size)
    monkeypatch.setattr(host_env.Path, "stat", lambda self, **_kw: info if self == clab else real)
    monkeypatch.setattr(host_env.os, "geteuid", lambda: 1000)
    return str(clab)


def test_root_needs_no_setup(monkeypatch):
    monkeypatch.setattr(host_env.os, "geteuid", lambda: 0)
    assert host_env._privilege_check("/usr/bin/containerlab")["ok"]


def test_plain_binary_points_at_the_sudo_hint(monkeypatch, tmp_path):
    path = _fake_clab(monkeypatch, tmp_path, mode=0o755)
    check = host_env._privilege_check(path)
    assert not check["ok"]
    assert check["fix"] == host_env.SUDO_HINT


def test_setuid_group_binary_requires_membership(monkeypatch, tmp_path):
    path = _fake_clab(monkeypatch, tmp_path, mode=stat.S_ISUID | 0o710)
    monkeypatch.setattr(host_env.os, "getgroups", lambda: [100])
    monkeypatch.setattr(host_env.os, "getegid", lambda: 100)
    check = host_env._privilege_check(path)
    assert not check["ok"]
    assert "usermod -aG" in check["fix"]

    monkeypatch.setattr(host_env.os, "getgroups", lambda: [100, 1234])
    assert host_env._privilege_check(path)["ok"]


def test_setuid_world_executable_binary_is_fine(monkeypatch, tmp_path):
    path = _fake_clab(monkeypatch, tmp_path, mode=stat.S_ISUID | 0o755)
    assert host_env._privilege_check(path)["ok"]


def test_docker_host_env_counts_as_access(monkeypatch):
    monkeypatch.setenv("DOCKER_HOST", "tcp://localhost:2375")
    assert host_env._docker_check()["ok"]


def test_missing_docker_socket_is_an_error(monkeypatch, tmp_path):
    monkeypatch.delenv("DOCKER_HOST", raising=False)
    monkeypatch.setattr(host_env, "_DOCKER_SOCKET", tmp_path / "nope.sock")
    check = host_env._docker_check()
    assert not check["ok"]
    assert check["severity"] == "error"


def test_workspace_check_walks_up_to_existing_parent(monkeypatch, tmp_path):
    monkeypatch.setattr(host_env.workspaces, "load", lambda: [str(tmp_path / "new" / "labs")])
    (check,) = host_env._workspace_checks()
    assert check["ok"] == os.access(tmp_path, os.W_OK | os.X_OK)


def test_diagnose_is_empty_in_a_container(monkeypatch):
    monkeypatch.setattr(host_env.container_env, "in_container", lambda: True)
    assert host_env.diagnose(refresh=True) == {"inContainer": True, "ready": True, "checks": []}


def test_ready_ignores_warnings(monkeypatch, tmp_path):
    ok = host_env._check("a", True, "error", "t", "d")
    warn = host_env._check("b", False, "warning", "t", "d")
    monkeypatch.setattr(host_env, "_netlab_check", lambda: ok)
    monkeypatch.setattr(host_env, "_containerlab_check", lambda: [ok])
    monkeypatch.setattr(host_env, "_docker_check", lambda: ok)
    monkeypatch.setattr(host_env, "_netem_check", lambda: warn)
    monkeypatch.setattr(host_env, "_workspace_checks", lambda: [ok])
    assert host_env.diagnose(refresh=True)["ready"] is True
