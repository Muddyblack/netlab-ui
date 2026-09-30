"""Fault scenarios: metric parsing, 'missing vs topology', and a full flap run against fakes."""

import asyncio
import json

import pytest

from services import monitoring
from services import monitoring_scenarios as sc
from services.netlab import runner

EXPECTED = """\
# TYPE netlab_expected_bgp_session gauge
netlab_expected_bgp_session{lab="l",node="r1",peer="10.0.0.2",vrf="default"} 1
netlab_expected_ospf_adjacency{lab="l",node="r1",peer_node="r2",ifname="eth1"} 1
"""
UP = EXPECTED + (
    'netlab_bgp_session_up{lab="l",node="r1",peer="10.0.0.2",vrf="default"} 1\n'
    'netlab_bgp_session_last_change_timestamp_seconds{lab="l",node="r1",peer="10.0.0.2",vrf="default"} 100\n'
    'netlab_ospf_neighbor_up{lab="l",node="r1",peer_node="r2",ifname="eth1"} 1\n'
)
DOWN = EXPECTED + 'netlab_ospf_neighbor_up{lab="l",node="r1",peer_node="r2",ifname="eth1"} 0\n'


def test_parse_metrics_reads_labels_values_and_skips_comments():
    samples = sc.parse_metrics('# HELP x\nx{a="b\\"c",d="e"} 1.5\ny 2\nbroken line here\n')
    assert samples == [("x", {"a": 'b"c', "d": "e"}, 1.5), ("y", {}, 2.0)]


def test_missing_compares_what_is_up_with_the_topology():
    assert sc.missing(sc.parse_metrics(UP)) == set()
    assert sc.missing(sc.parse_metrics(DOWN)) == {
        ("BGP", "r1", "10.0.0.2", "default"),
        ("OSPF", "r1", "r2", "eth1"),
    }


def test_last_changes_keys_match_missing():
    changes = sc.last_changes(sc.parse_metrics(UP))
    assert changes == {("BGP", "r1", "10.0.0.2", "default"): 100.0}


def _lab(tmp_path, collector="http://collector"):
    mon = tmp_path / "monitoring"
    mon.mkdir()
    (mon / "stack.json").write_text(json.dumps({"lab": "l", "collector_url": collector}))
    plan = {"nodes": {"r1": {"provider": "clab", "container": "clab-l-r1", "interfaces": [{"ifname": "eth1"}]}}}
    (mon / "plan.json").write_text(json.dumps(plan))
    return tmp_path


def test_start_needs_a_running_stack_and_a_link(tmp_path):
    with pytest.raises(RuntimeError, match="not running"):
        asyncio.run(_start(_lab(tmp_path, collector=""), [{"node": "r1", "ifname": "eth1"}]))
    (tmp_path / "monitoring" / "stack.json").write_text(json.dumps({"lab": "l", "collector_url": "http://c"}))
    with pytest.raises(ValueError, match="at least one"):
        asyncio.run(_start(tmp_path, []))


async def _start(lab, links):
    return sc.start(lab, links, 1, 1, 1, 5)


def test_a_flap_run_measures_reaction_impact_and_recovery(tmp_path, monkeypatch):
    lab = _lab(tmp_path)
    link_up = {"state": True}
    calls, notes = [], []

    async def fake_set(container, dev, up, **_):
        calls.append((container, dev, up))
        link_up["state"] = up
        return runner.CommandResult(0, "", "")

    async def fake_sample(_url):
        return sc.parse_metrics(UP if link_up["state"] else DOWN)

    async def fake_annotate(_lab, text, tags):
        notes.append(("point", text, tuple(tags)))
        return len(notes)

    async def fake_end(_lab, ident, text):
        notes.append(("region", ident, text))
        return True

    monkeypatch.setattr(sc, "SAMPLE_INTERVAL", 0.01)
    monkeypatch.setattr(sc, "_sample", fake_sample)
    monkeypatch.setattr(runner, "set_interface_state", fake_set)
    monkeypatch.setattr(monitoring, "annotate", fake_annotate)
    monkeypatch.setattr(monitoring, "annotate_end", fake_end)

    job = sc.Scenario(
        id="t1",
        lab="l",
        links=[sc.LinkEnd("r1", "eth1")],
        cycles=2,
        downSeconds=0.05,
        upSeconds=0.05,
        settleSeconds=1,
    )
    asyncio.run(sc._run(job, lab))

    assert job.status == "done"
    assert calls == [("clab-l-r1", "eth1", False), ("clab-l-r1", "eth1", True)] * 2
    for cycle in job.results:
        assert cycle.impact == 2
        assert cycle.reactionSeconds is not None
        assert cycle.recoverySeconds is not None
        assert cycle.affected == ["BGP r1 10.0.0.2 default", "OSPF r1 r2 eth1"]
    assert job.as_dict()["summary"]["notRecovered"] == 0
    # each outage is one Grafana region: a point when it goes down, extended when it comes back
    assert [n[0] for n in notes] == ["point", "region"] * 2
    saved = list((lab / "monitoring" / "scenarios").glob("*-t1.json"))
    assert len(saved) == 1 and sc.history(lab)[0]["id"] == "t1"


def test_a_failed_link_change_restores_links_and_reports(tmp_path, monkeypatch):
    lab = _lab(tmp_path)
    calls = []

    async def fake_set(container, dev, up, **_):
        calls.append(up)
        return runner.CommandResult(0 if up else 1, "", "no such device")

    async def fake_sample(_url):
        return sc.parse_metrics(UP)

    async def quiet(*_args, **_kwargs):
        return None

    monkeypatch.setattr(sc, "_sample", fake_sample)
    monkeypatch.setattr(runner, "set_interface_state", fake_set)
    monkeypatch.setattr(monitoring, "annotate", quiet)
    job = sc.Scenario(
        id="t2", lab="l", links=[sc.LinkEnd("r1", "eth1")], cycles=1, downSeconds=1, upSeconds=1, settleSeconds=5
    )
    asyncio.run(sc._run(job, lab))
    assert job.status == "failed" and "no such device" in job.message
    assert calls == [False, True]  # the link is put back up
