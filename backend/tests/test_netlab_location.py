from pathlib import Path

from services.netlab import location


def test_configured_netlab_wins_and_prepends_its_bin(tmp_path, monkeypatch):
    config = tmp_path / "config.json"
    bin_dir = tmp_path / "netlab-venv" / "bin"
    bin_dir.mkdir(parents=True)
    netlab = bin_dir / "netlab"
    netlab.write_text("#!/usr/bin/python3\n")
    monkeypatch.setenv(location.CONFIG_ENV, str(config))
    monkeypatch.setenv("PATH", "/usr/bin")

    location.set_configured_bin(str(netlab))
    resolved = location.resolve()

    assert resolved.source == "config"
    assert resolved.bin_path == str(netlab)
    assert location.child_path().split(":")[0] == str(bin_dir)


def test_clear_config_falls_back_to_environment(tmp_path, monkeypatch):
    config = tmp_path / "config.json"
    env_netlab = tmp_path / "netlab"
    env_netlab.write_text("#!/usr/bin/python3\n")
    monkeypatch.setenv(location.CONFIG_ENV, str(config))
    monkeypatch.setenv(location.BIN_ENV, str(env_netlab))

    location.set_configured_bin("/some/override")
    location.set_configured_bin(None)

    assert location.resolve().source == "env"
    assert location.resolve().bin_path == str(env_netlab)


def test_netsim_probe_uses_selected_interpreter(tmp_path, monkeypatch):
    package_dir = tmp_path / "site" / "netsim"
    package_dir.mkdir(parents=True)
    fake_python = tmp_path / "python"
    fake_python.write_text("")
    monkeypatch.setattr(location, "target_python", lambda: str(fake_python))
    monkeypatch.setattr(
        location,
        "resolve",
        lambda: location.Resolution(None, "path", "netlab", "/bin/netlab", True, "/bin"),
    )

    class Result:
        returncode = 0
        stdout = f'{{"packageDir": "{package_dir}", "version": "26.07"}}'

    calls: list[list[str]] = []

    def run(argv, **_kwargs):
        calls.append(argv)
        return Result()

    monkeypatch.setattr(location.subprocess, "run", run)
    location._probe_netsim.cache_clear()

    assert location.netsim_package_dir() == Path(package_dir)
    assert calls[0][0] == str(fake_python)
