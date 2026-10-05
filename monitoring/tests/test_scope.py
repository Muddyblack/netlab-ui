"""Which nodes get monitored: selector syntax, picks, excludes, host-only nodes, and what the plan does with them."""

import pytest
from netlab_monitoring import plan, scope


def fabric(**monitoring) -> dict:
    """3 spines (a group) and 12 leaves in 3 pods, as netlab's transformed topology shows them."""
    nodes = {}
    for i in range(1, 4):
        nodes[f"spine{i}"] = {"device": "srlinux", "role": "router", "module": ["ospf", "bgp"]}
    for i in range(1, 13):
        nodes[f"leaf{i}"] = {"device": "frr" if i <= 8 else "eos", "module": ["ospf"]}
    nodes["host1"] = {"device": "linux", "role": "host"}
    groups = {
        "core": {"members": ["spine1", "spine2", "spine3"]},
        "pod1": {"members": [f"leaf{i}" for i in range(1, 5)]},
        "pod2": {"members": [f"leaf{i}" for i in range(5, 9)]},
        "pod3": {"members": [f"leaf{i}" for i in range(9, 13)]},
        "fabric": {"members": ["core", "pod1", "pod2", "pod3"]},  # a group of groups
    }
    return {"name": "dc", "provider": "clab", "nodes": nodes, "groups": groups, "monitoring": monitoring}


def monitored(**monitoring) -> list[str]:
    return scope.resolve(fabric(**monitoring)).monitored


def leaves(*numbers: int) -> list[str]:
    return [f"leaf{n}" for n in numbers]


# ---------------------------------------------------------------- parsing


@pytest.mark.parametrize(
    ("text", "kind", "pattern", "exclude", "pick", "count"),
    [
        ("r1", "name", "r1", False, "", 0),
        ("leaf*", "glob", "leaf*", False, "", 0),
        ("leaf[12]", "glob", "leaf[12]", False, "", 0),
        ("!leaf9*", "glob", "leaf9*", True, "", 0),
        ("re:leaf[0-9]+", "regex", "leaf[0-9]+", False, "", 0),
        ("group:pod*", "group", "pod*", False, "", 0),
        ("group:pod* | first 10", "group", "pod*", False, "first", 10),
        ("leaf* |last 2", "glob", "leaf*", False, "last", 2),
        ("  ! leaf* | random 3  ", "glob", "leaf*", True, "random", 3),
        ("re:^(a|b)$ | first 2", "regex", "^(a|b)$", False, "first", 2),  # a | inside the regex is not a pick
        ("device=srlinux", "attribute", "srlinux", False, "", 0),
        ("role=host | first 1", "attribute", "host", False, "first", 1),
    ],
)
def test_selectors_parse(text, kind, pattern, exclude, pick, count):
    selector = scope.parse(text)
    assert (selector.kind, selector.pattern, selector.exclude, selector.pick, selector.count) == (
        kind,
        pattern,
        exclude,
        pick,
        count,
    )


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("", "non-empty string"),
        ("   ", "non-empty string"),
        (5, "non-empty string"),
        ("!", "nothing to select"),
        ("re:[", "bad regular expression"),
        ("group:", "name a group"),
        ("color=red", "unknown attribute 'color'"),
        ("device=", "give a value"),
        ("leaf* | first 0", "at least 1"),
        ("two words", "no spaces"),
    ],
)
def test_bad_selectors_say_what_is_wrong(text, message):
    with pytest.raises(scope.SelectorError, match=message):
        scope.parse(text)


# ---------------------------------------------------------------- selecting


def test_everything_is_monitored_by_default():
    result = scope.resolve(fabric())
    assert len(result.monitored) == 16 and result.total == 16 and result.light == []
    assert result.monitored == [*(f"spine{i}" for i in range(1, 4)), *leaves(*range(1, 13)), "host1"]  # topology order


def test_names_groups_globs_regexes_and_attributes():
    assert monitored(nodes=["leaf3", "spine1"]) == ["spine1", "leaf3"]  # topology order, not written order
    assert monitored(nodes=["pod2"]) == leaves(5, 6, 7, 8)  # a group
    assert monitored(nodes=["fabric"]) == monitored(nodes=["core", "pod1", "pod2", "pod3"])  # nested groups
    assert monitored(nodes=["leaf1?"]) == leaves(10, 11, 12)
    assert monitored(nodes=["spine*", "leaf1"]) == ["spine1", "spine2", "spine3", "leaf1"]
    assert monitored(nodes=["re:leaf(1|2)"]) == leaves(1, 2)  # the whole name must match
    assert monitored(nodes=["re:leaf"]) == []
    assert monitored(nodes=["device=eos"]) == leaves(9, 10, 11, 12)
    assert monitored(nodes=["device=s*"]) == ["spine1", "spine2", "spine3"]
    assert monitored(nodes=["role=host"]) == ["host1"]
    assert monitored(nodes=["module=bgp"]) == ["spine1", "spine2", "spine3"]
    assert monitored(nodes=["provider=clab", "!role=host", "!leaf*"]) == ["spine1", "spine2", "spine3"]


def test_picks_take_the_first_last_or_a_random_few():
    assert monitored(nodes=["leaf* | first 3"]) == leaves(1, 2, 3)
    assert monitored(nodes=["leaf* | last 2"]) == leaves(11, 12)
    assert monitored(nodes=["pod3 | first 2"]) == leaves(9, 10)
    assert monitored(nodes=["leaf* | first 50"]) == leaves(*range(1, 13))  # fewer matches than asked for is fine


def test_a_group_pick_applies_to_each_group_on_its_own():
    assert monitored(nodes=["group:pod* | first 2"]) == leaves(1, 2, 5, 6, 9, 10)
    assert monitored(nodes=["group:pod* | last 1"]) == leaves(4, 8, 12)
    assert monitored(nodes=["group:core"]) == ["spine1", "spine2", "spine3"]
    assert monitored(nodes=["group:p*d1"]) == leaves(1, 2, 3, 4)
    assert monitored(nodes=["group:nothing*"]) == []


def test_random_picks_are_stable_and_follow_the_seed():
    first = monitored(nodes=["leaf* | random 4"], seed=1)
    assert len(first) == 4 and set(first) <= set(leaves(*range(1, 13)))
    assert first == monitored(nodes=["leaf* | random 4"], seed=1)  # the same sample on every run
    assert first == sorted(first, key=lambda name: int(name[4:]))  # still in topology order
    samples = {tuple(monitored(nodes=["leaf* | random 4"], seed=seed)) for seed in range(8)}
    assert len(samples) > 1  # a different seed samples differently
    assert monitored(nodes=["leaf* | random 99"]) == leaves(*range(1, 13))
    # one random pick per pod: 2 from each of the 3 pods
    per_pod = monitored(nodes=["group:pod* | random 2"], seed=3)
    assert len(per_pod) == 6
    assert all(
        sum(1 for name in per_pod if name in group["members"]) == 2
        for g, group in fabric()["groups"].items()
        if g.startswith("pod")
    )


def test_excludes_take_matches_out_again():
    assert monitored(nodes=["pod1", "!leaf2"]) == leaves(1, 3, 4)
    assert monitored(nodes=["leaf*", "!leaf1?", "!re:leaf[1-3]"]) == leaves(4, 5, 6, 7, 8, 9)
    # a list that starts with an exclude starts from every node
    assert monitored(nodes=["!leaf*", "!host1"]) == ["spine1", "spine2", "spine3"]
    # order matters: a later selector can add back what an earlier one took out
    assert monitored(nodes=["!pod1", "leaf1"]) == [n for n in monitored() if n not in leaves(2, 3, 4)]
    assert monitored(nodes=["pod1", "!pod1", "leaf1"]) == leaves(1)
    assert monitored(nodes=["leaf* | first 4", "!leaf* | last 1"]) == leaves(1, 2, 3, 4)  # nothing of leaf12 was in


def test_opted_out_nodes_and_monitoring_components_are_never_monitored():
    topology = fabric(nodes=["pod1"])
    topology["nodes"]["leaf2"]["monitoring"] = {"enabled": False}
    topology["nodes"]["leaf3"]["_monitoring_component"] = True
    result = scope.resolve(topology)
    assert result.monitored == leaves(1, 4) and result.total == 14  # 16 minus the two that cannot be monitored


def test_a_single_string_works_as_a_list():
    assert monitored(nodes="pod1") == leaves(1, 2, 3, 4)


# ---------------------------------------------------------------- host-only nodes


def test_light_marks_monitored_nodes_as_host_only():
    result = scope.resolve(fabric(light=["leaf*", "!leaf1"]))
    assert result.light == leaves(*range(2, 13))
    assert result.full == ["spine1", "spine2", "spine3", "leaf1", "host1"]
    # a light list that starts with an exclude starts from every monitored node
    assert scope.resolve(fabric(light=["!spine*", "!host1"])).light == leaves(*range(1, 13))
    assert scope.resolve(fabric()).light == []


def test_light_can_only_mark_nodes_that_are_monitored():
    result = scope.resolve(fabric(nodes=["pod1"], light=["leaf1", "leaf9", "pod3"]))
    assert result.light == ["leaf1"]
    assert "monitoring.light: selector 'leaf9' matches no monitored node" in result.warnings
    assert "monitoring.light: selector 'pod3' matches no monitored node" in result.warnings


def test_problems_are_reported_by_the_list_they_are_in():
    result = scope.resolve(fabric(nodes=["pod1", "nope*", "re:("], light=["leaf1 leaf2"]))
    assert result.monitored == leaves(1, 2, 3, 4)  # the bad selector is skipped, the rest still count
    assert len(result.errors) == 2
    assert result.errors[0].startswith("monitoring.nodes: selector 're:(': bad regular expression")
    assert result.errors[1].startswith("monitoring.light: selector 'leaf1 leaf2': a node or group name has no spaces")
    assert result.warnings == ["monitoring.nodes: selector 'nope*' matches no node"]


def test_a_summary_line():
    assert scope.describe(scope.resolve(fabric())) == "16 of 16 nodes"
    assert scope.describe(scope.resolve(fabric(nodes=["pod1"], light=["leaf1"]))) == "4 of 16 nodes (1 host-only)"


# ---------------------------------------------------------------- in the plan


def test_a_host_only_node_gets_no_protocol_collection_and_expects_no_sessions(topology):
    full = plan.build(topology)
    assert "frr" in full["nodes"]["r1"] and full["nodes"]["r1"]["detail"] == "full"
    assert any(e["node"] == "r1" for e in full["expected"]["bgp"])

    topology["monitoring"]["light"] = ["r1"]
    light = plan.build(topology)
    assert light["nodes"]["r1"]["methods"] == ["host"] and "frr" not in light["nodes"]["r1"]
    assert light["nodes"]["r1"]["detail"] == "host" and light["nodes"]["r2"]["detail"] == "full"
    # what r1 would have reported is not expected of it ...
    assert not any(e["node"] == "r1" for e in light["expected"]["bgp"] + light["expected"]["ospf"])
    # ... while r2 still expects its sessions with r1, which it reports itself
    assert any(e["node"] == "r2" and e["peer_node"] == "r1" for e in light["expected"]["bgp"])
    assert light["scope"] == {"monitored": 4, "light": 1, "total": 4}


def test_the_plan_only_describes_the_selected_nodes(topology):
    topology["monitoring"]["nodes"] = ["r1", "r2"]
    result = plan.build(topology)
    assert set(result["nodes"]) == {"r1", "r2"}
    assert result["scope"] == {"monitored": 2, "light": 0, "total": 4}
    assert all(e["node"] in {"r1", "r2"} and e["peer_node"] in {"r1", "r2"} for e in result["expected"]["bgp"])
