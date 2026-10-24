import os
import tomllib
from pathlib import Path

import pytest

from netlab_ui import cli, config


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    for name in ("UVICORN_HOST", "UVICORN_PORT", "NETLAB_BIN", config.CONFIG_ENV):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))


def _write(tmp_path, text: str) -> Path:
    path = tmp_path / "config.toml"
    path.write_text(text)
    return path


def test_no_file_means_defaults(tmp_path):
    settings = config.load(tmp_path / "missing.toml")
    assert (settings.host, settings.port, settings.path, settings.netlab) == ("127.0.0.1", 8000, [], None)


def test_values_are_read_and_paths_expanded(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", "/home/alice")
    path = _write(
        tmp_path,
        (
            '[server]\nhost = "0.0.0.0"\nport = 9000\n'
            '[tools]\npath = ["~/.local/bin", "/opt/clab"]\nnetlab = "~/v/bin/netlab"\n'
        ),
    )
    settings = config.load(path)
    assert (settings.host, settings.port) == ("0.0.0.0", 9000)
    assert settings.path == ["/home/alice/.local/bin", "/opt/clab"]
    assert settings.netlab == "/home/alice/v/bin/netlab"


@pytest.mark.parametrize(
    "text",
    ["[server]\nport = 99999\n", '[server]\nport = "80"\n', '[tools]\npath = "/usr/bin"\n', "this is = = not toml"],
)
def test_a_bad_file_is_reported_not_ignored(tmp_path, text):
    with pytest.raises(config.ConfigError) as err:
        config.load(_write(tmp_path, text))
    assert "config.toml" in str(err.value)


def test_default_path_follows_the_environment(tmp_path, monkeypatch):
    assert config.default_path() == tmp_path / "xdg" / "netlab-ui" / "config.toml"
    monkeypatch.setenv(config.CONFIG_ENV, str(tmp_path / "elsewhere.toml"))
    assert config.default_path() == tmp_path / "elsewhere.toml"


def test_apply_tools_prepends_the_path_and_keeps_an_explicit_netlab_bin(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    monkeypatch.setenv("NETLAB_BIN", "")  # so the test restores it: apply_tools writes os.environ directly
    config.apply_tools(config.Settings(path=["/opt/a", "/usr/bin"], netlab="/opt/a/netlab"))
    assert os.environ["PATH"].split(os.pathsep) == ["/opt/a", "/usr/bin", "/bin"]
    assert os.environ["NETLAB_BIN"] == "/opt/a/netlab"
    monkeypatch.setenv("NETLAB_BIN", "/mine/netlab")
    config.apply_tools(config.Settings(netlab="/opt/a/netlab"))
    assert os.environ["NETLAB_BIN"] == "/mine/netlab"


def test_the_template_is_valid_toml_that_loads_back(tmp_path):
    path = _write(tmp_path, config.template(["/home/a/.local/bin", "/opt/clab/bin"]))
    assert tomllib.loads(path.read_text())["tools"]["path"] == ["/home/a/.local/bin", "/opt/clab/bin"]
    assert config.load(path).path == ["/home/a/.local/bin", "/opt/clab/bin"]
    assert config.load(_write(tmp_path, config.template([]))).path == []


def test_serve_uses_flag_then_env_then_file(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr("uvicorn.run", lambda _target, **kw: seen.update(kw))
    monkeypatch.setenv(config.CONFIG_ENV, str(_write(tmp_path, '[server]\nhost = "10.0.0.5"\nport = 9001\n')))

    cli.main(["serve"])
    assert (seen["host"], seen["port"]) == ("10.0.0.5", 9001)

    monkeypatch.setenv("UVICORN_PORT", "9002")
    cli.main(["serve"])
    assert (seen["host"], seen["port"]) == ("10.0.0.5", 9002)

    cli.main(["serve", "--port", "9003", "--host", "127.0.0.9"])
    assert (seen["host"], seen["port"]) == ("127.0.0.9", 9003)


def test_serve_refuses_a_broken_config_instead_of_starting(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("uvicorn.run", lambda *_a, **_kw: pytest.fail("must not start"))
    monkeypatch.setenv(config.CONFIG_ENV, str(_write(tmp_path, "[server]\nport = 0\n")))
    assert cli.main(["serve"]) == 2
    assert "config problem" in capsys.readouterr().err
