import asyncio

import pytest

from services.lenses import teaching
from services.netlab import runner


def test_validation_tests_are_listed_with_description_and_nodes():
    transformed = {"validate": {"ping_r3": {"description": "r1 reaches r3", "nodes": ["r1"]}, "adj": {}}}
    assert teaching.validation_tests(transformed) == [
        {"name": "ping_r3", "description": "r1 reaches r3", "nodes": ["r1"]},
        {"name": "adj", "description": "", "nodes": []},
    ]
    assert teaching.validation_tests({}) == []
    as_list = {"validate": [{"name": "ping_r3", "description": "r1 reaches r3", "nodes": ["r1"]}, {"nodes": []}]}
    assert teaching.validation_tests(as_list) == [{"name": "ping_r3", "description": "r1 reaches r3", "nodes": ["r1"]}]


def _fake_validate(monkeypatch, output, code):
    calls = []

    async def run_command(args, cwd=None):
        calls.append(args)
        return runner.CommandResult(code=code, stdout=output, stderr="")

    monkeypatch.setattr(runner, "run_command", run_command)
    return calls


def test_step_passes_only_when_every_check_passes(tmp_path, monkeypatch):
    topology = tmp_path / "lab.yml"
    output = "[ping_r2] Ping r2 from r1\n[PASS] r1: ping succeeded\n[ping_r3] Ping r3\n[FAIL] r1: 100% packet loss\n"
    calls = _fake_validate(monkeypatch, output, 1)
    result = asyncio.run(teaching.check(topology, ["ping_r2", "ping_r3"]))
    assert calls == [["validate", "ping_r2", "ping_r3"]]
    assert result["passed"] is False
    assert {t["name"]: t["state"] for t in result["tests"]} == {"ping_r2": "passed", "ping_r3": "failed"}
    assert "packet loss" in result["tests"][1]["evidence"]

    _fake_validate(monkeypatch, "[ping_r2] Ping r2\n[PASS] r1: ok\n", 0)
    assert asyncio.run(teaching.check(topology, ["ping_r2"]))["passed"] is True


def test_exit_code_decides_a_test_without_a_verdict(tmp_path, monkeypatch):
    _fake_validate(monkeypatch, "some unrelated banner\n", 0)
    assert asyncio.run(teaching.check(tmp_path / "lab.yml", ["quiet"]))["tests"][0]["state"] == "passed"
    _fake_validate(monkeypatch, "", 1)
    assert asyncio.run(teaching.check(tmp_path / "lab.yml", ["quiet"]))["passed"] is False


def test_check_rejects_option_like_test_names(tmp_path):
    with pytest.raises(ValueError):
        asyncio.run(teaching.check(tmp_path / "lab.yml", ["--source=/etc/passwd"]))
    with pytest.raises(ValueError):
        asyncio.run(teaching.check(tmp_path / "lab.yml", []))
