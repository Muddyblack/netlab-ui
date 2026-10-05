"""Selecting nodes by expression ("run on r1-r3", "leaf*") instead of picking each one."""

import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.lab import broadcast
from app.main import app
from app.sessions.store import store
from services import nodeset
from services.netlab import runner

LAB = ["r1", "r2", "r3", "r10", "r11", "leaf01", "leaf02", "leaf10", "spine-a", "spine-b", "h1", "Host2"]


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("r1-r3", ["r1", "r2", "r3"]),  # range, prefix repeated
        ("r1-3", ["r1", "r2", "r3"]),  # range, prefix once
        ("r2-r11", ["r2", "r3", "r10", "r11"]),  # numeric, not alphabetical
        ("r[1-3,10]", ["r1", "r2", "r3", "r10"]),  # hostlist, the notation the UI shows
        ("r[2]", ["r2"]),
        ("leaf[01-02]", ["leaf01", "leaf02"]),  # zero padding fixes the width
        ("leaf01-leaf10", ["leaf01", "leaf02", "leaf10"]),
        ("leaf*", ["leaf01", "leaf02", "leaf10"]),  # bulk-link wildcards
        ("r#", ["r1", "r2", "r3", "r10", "r11"]),
        ("r?", ["r1", "r2", "r3"]),
        ("spine-?", ["spine-a", "spine-b"]),
        ("host*", ["Host2"]),  # case-insensitive, like the bulk-link dialog
        ("(spine|border)-[ab]", ["spine-a", "spine-b"]),  # a regular expression must match the whole name
        ("r(1|3)", ["r1", "r3"]),
    ],
)
def test_selectors(expression, expected):
    assert nodeset.select(expression, LAB) == expected


def test_a_plain_name_is_not_a_selector_and_a_miss_is_empty():
    assert nodeset.select("r1", LAB) is None  # the caller treats exact names itself
    assert nodeset.select("", LAB) is None
    assert nodeset.select("zzz*", LAB) == []
    assert nodeset.select("r[40-50]", LAB) == []


def test_a_broken_regular_expression_is_reported():
    with pytest.raises(ValueError, match="not a valid pattern"):
        nodeset.select("r(1", LAB)


def test_ranges_are_found_by_walking_the_names_so_huge_labs_stay_fast():
    names = [f"pc{n}" for n in range(1, 200_001)]
    started = time.monotonic()
    assert len(nodeset.select("pc1-pc150000", names)) == 150_000
    assert nodeset.select("pc[7,199999-200000]", names) == ["pc7", "pc199999", "pc200000"]
    assert len(nodeset.select("pc1*", names)) == 111_111
    assert time.monotonic() - started < 10


def test_expand_targets_takes_patterns_next_to_names_groups_and_all():
    nodes = ["r1", "r2", "r3", "h1"]
    groups = {"core": ["r1", "r2"]}
    assert broadcast.expand_targets(["r2-r3", "h1"], nodes, groups) == ["r2", "r3", "h1"]
    assert broadcast.expand_targets(["core", "r[3]"], nodes, groups) == ["r1", "r2", "r3"]
    assert broadcast.expand_targets(["r*", "r1"], nodes, groups) == ["r1", "r2", "r3"]  # no duplicates
    assert broadcast.expand_targets(["R#"], nodes, groups) == ["r1", "r2", "r3"]
    # an exact node wins over reading its name as a range
    assert broadcast.expand_targets(["a1-3"], ["a1-3", "a1", "a2", "a3"], {}) == ["a1-3"]


def test_expand_targets_explains_what_does_not_work():
    with pytest.raises(HTTPException, match="matches no node"):
        broadcast.expand_targets(["x*"], ["r1"], {})
    with pytest.raises(HTTPException, match="patterns work too"):
        broadcast.expand_targets(["nope"], ["r1"], {})
    with pytest.raises(HTTPException, match="not a valid pattern"):
        broadcast.expand_targets(["r(1"], ["r1"], {})


@pytest.fixture
def session(tmp_path, monkeypatch):
    path = tmp_path / "topology.yml"
    path.write_text("name: t\ndefaults.device: frr\nnodes: [r1, r2, r3, r4, h1]\n")

    async def status_for(_path):
        return {"nodes": {f"r{n}": {"status": "running", "provider": "clab"} for n in range(1, 5)}}

    monkeypatch.setattr(runner, "status_for", status_for)
    return store.create(str(path)).id


def resolve(session, nodes):
    res = TestClient(app).post("/api/lab/exec/resolve", json={"sessionId": session, "nodes": nodes})
    assert res.status_code == 200
    return res.json()


def test_the_preview_says_what_a_selection_matches(session):
    assert resolve(session, ["r1-r3"]) == {"count": 3, "first": ["r1", "r2", "r3"], "error": ""}
    assert resolve(session, ["all"])["count"] == 4  # the running ones
    assert resolve(session, [])["count"] == 0


def test_the_preview_reports_a_bad_selection_instead_of_failing(session):
    assert "matches no node" in resolve(session, ["zz*"])["error"]
    assert "not a valid pattern" in resolve(session, ["r(1"])["error"]
    assert resolve(session, ["zz*"])["count"] == 0


def test_the_preview_shows_only_a_handful_of_names_for_a_big_match(session):
    body = resolve(session, ["r*"])
    assert body["count"] == 4 and len(body["first"]) <= broadcast.PREVIEW_NAMES
