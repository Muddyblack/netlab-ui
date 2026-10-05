"""Fault tests defined in the topology, and netlab validate results around them."""

import asyncio
import json

import pytest

from services import fault_tests, monitoring
from services import monitoring_scenarios as sc
from services.netlab import runner

VALIDATE_OUTPUT = """\
 [INFO] Reading validation tests from topology.yml
[ospf_r2] r1 has a Full OSPF adjacency with r2 [ node(s): r1 ]
[FAIL]    Node r1: There is no OSPFv2 neighbor 10.0.0.2

[ibgp]    iBGP r1 - r2 established [ node(s): r1 ]
[PASS]    r1: Neighbor 10.0.0.2 (r2) is in state Established
[PASS]    Test succeeded in 0.9 seconds

[FAIL]    2 tests completed, one test failed
"""


def test_validate_output_becomes_one_result_per_test():
    results = fault_tests.parse_validation("\x1b[31m" + VALIDATE_OUTPUT)
    assert [(r["test"], r["passed"], r["seconds"]) for r in results] == [
        ("ospf_r2", False, None),
        ("ibgp", True, 0.9),
    ]
    assert results[0]["message"] == "Node r1: There is no OSPFv2 neighbor 10.0.0.2"
    assert results[1]["description"] == "iBGP r1 - r2 established"


def test_definitions_read_netlab_dotted_keys():
    attrs = {
        "monitoring.faults": {
            "core": {"links": "r1-r2", "down": 5, "validate": True, "during": ["ping"], "expect.recovery": 3},
            "broken": "not a dict",
        },
        "validate": {"ping": {"description": "h1 reaches r3"}},
    }
    (core,) = fault_tests.definitions(attrs)
    assert core["links"] == ["r1-r2"] and core["down"] == 5 and core["cycles"] == 3
    assert core["validateAfter"] == [] and core["validateDuring"] == ["ping"] and core["expectRecovery"] == 3
    assert (
        fault_tests.definitions({"monitoring": {"faults": {"x": {"links": ["r1:eth1"]}}}})[0]["validateAfter"] is None
    )
    assert fault_tests.validation_tests(attrs) == [{"name": "ping", "description": "h1 reaches r3"}]


def _lab(tmp_path):
    mon = tmp_path / "monitoring"
    mon.mkdir()
    (mon / "stack.json").write_text(json.dumps({"lab": "l", "collector_url": "http://collector"}))
    plan = {
        "nodes": {"r1": {"provider": "clab", "container": "clab-l-r1", "interfaces": [{"ifname": "eth1"}]}},
        "links": [{"link": "r1-r2", "a_node": "r1", "a_ifname": "eth1", "b_node": "r2", "b_ifname": "eth1"}],
    }
    (mon / "plan.json").write_text(json.dumps(plan))
    return tmp_path


def test_links_resolve_by_name_or_end(tmp_path):
    lab = _lab(tmp_path)
    assert fault_tests.resolve_links(lab, ["r1-r2", "r2:eth1", "r2 eth1"]) == [
        {"node": "r1", "ifname": "eth1"},
        {"node": "r2", "ifname": "eth1"},
        {"node": "r2", "ifname": "eth1"},
    ]
    with pytest.raises(ValueError, match="not a lab link"):
        fault_tests.resolve_links(lab, ["r9:eth1"])


UP = (
    'netlab_expected_ospf_adjacency{node="r1",peer_node="r2",ifname="eth1"} 1\n'
    'netlab_ospf_neighbor_up{node="r1",peer_node="r2",ifname="eth1"} 1\n'
)
DOWN = 'netlab_expected_ospf_adjacency{node="r1",peer_node="r2",ifname="eth1"} 1\n'


def test_a_named_fault_test_runs_validate_and_gets_a_verdict(tmp_path, monkeypatch):
    lab = _lab(tmp_path)
    state = {"up": True}
    validations = []

    async def fake_set(container, dev, up, **_):
        state["up"] = up
        return runner.CommandResult(0, "", "")

    async def fake_sample(_url):
        return sc.parse_metrics(UP if state["up"] else DOWN)

    async def fake_validate(_lab_dir, tests, *, skip_wait=False):
        validations.append((tuple(tests), skip_wait, state["up"]))
        return [{"test": "ospf", "passed": state["up"], "seconds": 1.0 if state["up"] else None, "message": ""}]

    async def quiet(*_args, **_kwargs):
        return None

    monkeypatch.setattr(sc, "SAMPLE_INTERVAL", 0.01)
    monkeypatch.setattr(sc, "_sample", fake_sample)
    monkeypatch.setattr(runner, "set_interface_state", fake_set)
    monkeypatch.setattr(fault_tests, "run_validation", fake_validate)
    monkeypatch.setattr(monitoring, "annotate", quiet)
    attrs = {
        "monitoring.faults": {
            "core": {
                "links": ["r1-r2"],
                "cycles": 1,
                "down": 1,
                "up": 1,
                "validate": ["ospf"],
                "during": True,
                "expect.recovery": 30,
            }
        }
    }

    async def run():
        started = sc.start_named(lab, attrs, "core")
        await sc._tasks[started["id"]]
        return sc.get(started["id"])

    result = asyncio.run(run())
    assert result["name"] == "core" and result["status"] == "done"
    # while down: current state (--skip-wait), after: with the tests' own waits
    assert validations == [((), True, False), (("ospf",), False, True)]
    cycle = result["results"][0]
    assert cycle["during"][0]["passed"] is False and cycle["after"][0]["passed"] is True
    assert result["summary"]["verdict"] == {"result": "passed", "reasons": []}


def test_the_verdict_names_what_failed():
    job = sc.Scenario(
        id="x",
        lab="l",
        links=[],
        cycles=2,
        downSeconds=1,
        upSeconds=1,
        settleSeconds=60,
        status="done",
        expectRecovery=2,
    )
    job.results = [
        sc.Cycle(cycle=1, downAt=0, recoverySeconds=3.5, after=[{"test": "ibgp", "passed": False, "message": "Idle"}]),
        sc.Cycle(cycle=2, downAt=0, recoverySeconds=None),
    ]
    verdict = job.verdict()
    assert verdict["result"] == "failed"
    assert verdict["reasons"] == [
        "cycle 1: recovery 3.50 s > 2 s",
        "cycle 1: ibgp failed after recovery: Idle",
        "cycle 2: did not recover within 60 s",
    ]


def test_unknown_named_test_lists_the_known_ones(tmp_path):
    with pytest.raises(ValueError, match="core"):
        sc.start_named(_lab(tmp_path), {"monitoring.faults": {"core": {"links": ["r1-r2"]}}}, "nope")
