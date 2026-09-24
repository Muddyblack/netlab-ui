from services import container_env


def _fake(monkeypatch, info, workspaces):
    monkeypatch.setattr(container_env, "in_container", lambda: True)
    monkeypatch.setattr(container_env, "_inspect_self", lambda: info)
    monkeypatch.setattr(container_env.workspaces, "load", lambda: workspaces)
    monkeypatch.setattr(container_env.Path, "exists", lambda self: str(self) == "/var/run/docker.sock")


def _by_id(result):
    return {check["id"]: check for check in result["checks"]}


def test_outside_container_reports_nothing(monkeypatch):
    monkeypatch.setattr(container_env, "in_container", lambda: False)
    assert container_env.diagnose(refresh=True) == {"inContainer": False, "inspected": False, "checks": []}


def test_well_configured_container_passes(monkeypatch, tmp_path):
    home = str(container_env.Path("~/.netlab").expanduser())
    info = {
        "HostConfig": {"Privileged": True, "NetworkMode": "host", "PidMode": "host"},
        "Mounts": [
            {"Type": "bind", "Source": "/home/me/labs", "Destination": "/home/me/labs"},
            {"Type": "bind", "Source": "/home/me/.netlab", "Destination": home},
        ],
    }
    _fake(monkeypatch, info, ["/home/me/labs/project"])
    result = container_env.diagnose(refresh=True)
    assert result["inspected"] is True
    assert all(check["ok"] for check in result["checks"]), result["checks"]


def test_misconfigured_container_explains_each_problem(monkeypatch):
    info = {
        "HostConfig": {"Privileged": False, "NetworkMode": "bridge", "PidMode": ""},
        "Mounts": [{"Type": "bind", "Source": "/home/me/labs", "Destination": "/work"}],
    }
    _fake(monkeypatch, info, ["/work", "/root/labs"])
    checks = _by_id(container_env.diagnose(refresh=True))

    assert not checks["privileged"]["ok"] and checks["privileged"]["fix"] == "--privileged"
    assert not checks["host-network"]["ok"]
    assert not checks["host-pid"]["ok"]
    # Mounted, but at a different host path: containerlab bind mounts break.
    assert not checks["workspace:/work"]["ok"]
    assert checks["workspace:/work"]["fix"] == "-v /home/me/labs:/home/me/labs -e NETLAB_WORKSPACE=/home/me/labs"
    # Not mounted at all.
    assert not checks["workspace:/root/labs"]["ok"]
    assert not checks["netlab-state"]["ok"]
