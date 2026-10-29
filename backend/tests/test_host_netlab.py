"""netlab on the host: a container that may enter the host runs the host's own netlab there, as the host user."""

import os
import subprocess

import pytest

from netlab_ui.services import host, host_env
from netlab_ui.services.netlab import location

ALICE = host.HostUser("alice", 1000, 1000, "/home/alice", "/bin/bash")


@pytest.fixture
def on_host(monkeypatch, tmp_path):
    """A reachable host whose file system is ``tmp_path`` and whose netlab is in a pipx venv."""
    root = tmp_path / "host"
    venv_bin = root / "home/alice/.local/share/pipx/venvs/networklab/bin"
    venv_bin.mkdir(parents=True)
    (venv_bin / "netlab").write_text("#!/home/alice/.local/share/pipx/venvs/networklab/bin/python\n")
    (root / "home/alice/.local/bin").mkdir(parents=True)
    (root / "home/alice/.local/bin/netlab").symlink_to(venv_bin / "netlab")
    monkeypatch.setattr(host, "reachable", lambda: True)
    monkeypatch.setattr(host, "_user", lambda: ALICE)
    monkeypatch.setattr(host, "HOST_ROOT", root)
    monkeypatch.setattr(host, "_probe", lambda: host._Probe(ALICE, ""))
    found = {"netlab": "/home/alice/.local/bin/netlab"}
    monkeypatch.setattr(host, "which_all_on_host", lambda names: {name: found.get(name) for name in names})
    monkeypatch.delenv(location.BIN_ENV, raising=False)
    monkeypatch.delenv("NETLAB_UI_NETLAB", raising=False)
    monkeypatch.setenv(location.CONFIG_ENV, str(tmp_path / "ui.json"))
    return root


def test_the_host_netlab_is_found_on_the_host(on_host):
    resolved = location.resolve()
    assert resolved.found
    assert resolved.bin_path == "/home/alice/.local/bin/netlab"
    assert resolved.source == "path"


def test_a_configured_path_is_checked_on_the_host_with_the_users_home(on_host, monkeypatch):
    monkeypatch.setenv(location.BIN_ENV, "~/.local/share/pipx/venvs/networklab/bin/netlab")
    resolved = location.resolve()
    assert resolved.bin_path == "/home/alice/.local/share/pipx/venvs/networklab/bin/netlab"
    assert resolved.bin_dir == "/home/alice/.local/share/pipx/venvs/networklab/bin"
    # Its interpreter comes from the shebang, read through the host's root, and never the backend's own.
    assert location.target_python() == "/home/alice/.local/share/pipx/venvs/networklab/bin/python"
    assert not location.in_backend_venv()


def test_netlab_runs_on_the_host_as_the_user_in_the_lab_folder(on_host, monkeypatch):
    monkeypatch.setenv(location.BIN_ENV, "/home/alice/.local/share/pipx/venvs/networklab/bin/netlab")
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PATH": "/container/bin"}
    argv, spawn_env = location.spawn_args(["netlab", "up"], env, "/home/alice/labs/l1")
    assert argv[: len(host.NSENTER)] == host.NSENTER
    assert "--reuid=1000" in argv and "--regid=1000" in argv
    script = argv[-1]
    assert script.startswith("PATH=/home/alice/.local/share/pipx/venvs/networklab/bin:")
    assert "cd /home/alice/labs/l1 && exec netlab up" in script
    # Only what differs from our own environment travels; the container's PATH does not.
    assert "PYTHONUNBUFFERED=1" in argv
    assert not any(part.startswith("PATH=/container") for part in argv)
    assert spawn_env == {"PATH": host.HOST_PATH}


def test_netlab_runs_here_when_forced_or_without_a_host(on_host, monkeypatch):
    monkeypatch.setenv("NETLAB_UI_NETLAB", "container")
    assert location.spawn_args(["netlab", "up"], {"A": "1"}) == (["netlab", "up"], {"A": "1"})
    monkeypatch.delenv("NETLAB_UI_NETLAB")
    monkeypatch.setattr(host, "reachable", lambda: False)
    assert location.spawn_args(["netlab", "up"], {"A": "1"}) == (["netlab", "up"], {"A": "1"})


def test_the_netsim_package_is_read_through_the_hosts_root(on_host, monkeypatch):
    package = on_host / "home/alice/.local/share/pipx/venvs/networklab/lib/python3.12/site-packages/netsim"
    package.mkdir(parents=True)
    host_dir = "/" + str(package.relative_to(on_host))
    monkeypatch.setattr(location, "probe_netsim", lambda: {"packageDir": host_dir, "version": "26.10"})
    assert location.netsim_package_dir() == package


def test_claim_hands_root_files_to_the_user_but_leaves_containerlab_alone(on_host, monkeypatch, tmp_path):
    owned = {}
    monkeypatch.setattr(host.os, "lstat", lambda _path: os.stat_result((0,) * 10))
    monkeypatch.setattr(host.os, "lchown", lambda path, uid, gid: owned.update({path: (uid, gid)}))
    host.claim(["/labs/l1/topology.yml", "/labs/l1/clab-l1/r1/config"])
    assert owned == {"/labs/l1/topology.yml": (1000, 1000)}


def test_host_checks_read_the_users_containerlab_and_docker_access(on_host, monkeypatch):
    facts = "docker=no\ngroups=1000 27\nclab=/usr/bin/containerlab\nstat=0 1001 89c8\ngroup=clab_admins\n"
    monkeypatch.setattr(host_env.subprocess, "run", lambda *_a, **_kw: subprocess.CompletedProcess([], 0, facts, ""))
    found, privileges, docker = host_env._host_checks()
    assert found["ok"] and "on the host" in found["detail"]
    # 0x89c8 is mode 0o104710: setuid root, group-only; alice (groups 1000, 27) is not in clab_admins (1001).
    assert not privileges["ok"] and "clab_admins" in privileges["title"]
    assert not docker["ok"] and "usermod -aG docker alice" in docker["fix"]


def test_the_monitoring_plugin_is_copied_where_the_host_sees_it(monkeypatch, tmp_path):
    from netlab_ui.services import monitoring

    home = tmp_path / "root"
    (home / ".netlab").mkdir(parents=True)
    shipped = tmp_path / "app" / "monitoring_plugin"
    shipped.mkdir(parents=True)
    (shipped / "__init__.py").write_text("# plugin\n")
    monkeypatch.setattr(monitoring.Path, "home", lambda: home)
    monkeypatch.setattr(monitoring, "plugin_source", lambda: shipped)
    monkeypatch.setattr(monitoring.location, "on_host", lambda: True)
    monkeypatch.setattr(monitoring.host, "claim", lambda _paths: None)
    # An older container linked the image's own copy, which the host cannot see.
    monitoring.plugin_link().symlink_to(shipped)

    assert monitoring.repair_plugin_link()
    link = monitoring.plugin_link()
    assert os.readlink(link) == ".netlab-ui/monitoring"  # relative: resolves on the host and here
    assert (link / "__init__.py").read_text() == "# plugin\n"
    assert monitoring.plugin_state()["managed"]


def test_container_setup_says_whether_netlab_runs_on_the_host_and_as_whom(monkeypatch):
    from netlab_ui.services import container_env

    monkeypatch.delenv("NETLAB_UI_NETLAB", raising=False)
    monkeypatch.setattr(host, "reachable", lambda: False)
    monkeypatch.setattr(host, "unreachable_reason", lambda: "start the container with privileged: true")
    check = container_env._host_netlab_check()
    assert not check["ok"] and check["severity"] == "error" and "privileged" in check["detail"]

    monkeypatch.setattr(host, "reachable", lambda: True)
    monkeypatch.setattr(host, "_user", lambda: host.HostUser("root", 0, 0, "/root", "/bin/sh"))
    check = container_env._host_netlab_check()
    assert not check["ok"] and check["severity"] == "warning" and "chown" in check["fix"]

    monkeypatch.setattr(host, "_user", lambda: ALICE)
    assert container_env._host_netlab_check()["title"] == "netlab runs on the host as alice"
    monkeypatch.setenv("NETLAB_UI_NETLAB", "container")
    assert container_env._host_netlab_check() is None
