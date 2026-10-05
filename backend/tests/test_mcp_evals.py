"""Evaluation tasks for the MCP tool surface.

Anthropic's advice for agent tools is to evaluate them on realistic tasks and fix the tools from
what goes wrong. TASKS is that set: what a user would ask, and the tools a good agent needs.

Offline, this file checks the part that can be checked without a model -- *discoverability*:
asking `how_to` the task in plain words must surface every tool the task needs, and the tool
surface must stay free of duplicates and bloat. To evaluate with a real agent, give each task
to it with the netlab MCP attached and compare the tools it called with `needs` (its transcript
shows where a description or a name misled it); then edit the tool, not the task.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from services.assistant import mcp_server

# (what the user says, tools a good agent uses to do it)
TASKS: list[tuple[str, set[str]]] = [
    ("what does r3 do in this lab", {"explain_node"}),
    ("why is the BGP session between r1 and r2 down", {"explain_node", "run_show_command", "query_metrics"}),
    ("what changed on the routers since the deploy", {"compare_configs"}),
    ("did the lab's validation tests pass", {"get_validation_results"}),
    ("show me the addressing table", {"get_reports"}),
    ("capture the OSPF hellos on r1 eth1", {"capture_packets"}),
    ("read packet 12 of the capture and show the hex", {"read_capture"}),
    ("scale this to 8 leaves and 2 spines", {"detect_topology_patterns", "propose_generator"}),
    ("change r2 from frr to eos", {"propose_topology_edit"}),
    ("which devices support the vxlan module", {"netlab_show"}),
    ("add a dashboard for BGP session state", {"list_metrics", "create_dashboard"}),
    ("alert me when an interface goes down", {"create_alert_rules"}),
    ("why did the link flap at 10:05", {"query_logs"}),
    ("flap the r1 r2 link three times and check the lab recovers", {"propose_fault_test"}),
    ("point at the link between r1 and r2", {"ui_highlight"}),
    ("open the generated ospf config for r1 on my screen", {"ui_open"}),
    ("let me capture on r1 eth1 in wireshark", {"ui_open"}),
    ("what can you show me in the ui", {"ui_list_actions"}),
    ("remember that r5 is the route reflector", {"save_lab_note"}),
]


def tools_for(task: str) -> set[str]:
    result = asyncio.run(mcp_server.how_to(task))
    found = {t["name"] for topic in result.get("topics", []) for t in topic["tools"]}
    return found | {t["name"] for t in result.get("also_matching", [])}


@pytest.mark.parametrize(("task", "needs"), TASKS, ids=[t for t, _ in TASKS])
def test_how_to_surfaces_the_tools_a_task_needs(task, needs):
    missing = needs - tools_for(task)
    assert not missing, f"how_to({task!r}) does not lead to {sorted(missing)}"


def test_every_task_uses_tools_that_exist():
    registered = set(mcp_server.tool_names())
    for task, needs in TASKS:
        assert needs <= registered, f"{task!r} names a tool that is not registered: {sorted(needs - registered)}"


def test_each_tool_name_and_description_is_distinct():
    entries = mcp_server._tool_entries()
    names = [e["name"] for e in entries]
    assert len(names) == len(set(names))
    descriptions = [e["description"] for e in entries]
    assert len(descriptions) == len(set(descriptions)), "two tools share one description"
    assert all(len(d) >= 30 for d in descriptions), "a description is too short to choose the tool by"


def test_the_context_cost_stays_bounded():
    """The always-loaded cost: instructions, descriptions and parameter schemas (about 4 chars/token)."""
    server = mcp_server.build_server()
    listed = server._tool_manager.list_tools()
    chars = len(mcp_server._INSTRUCTIONS) + sum(
        len(t.name) + len(t.description or "") + len(json.dumps(t.parameters, separators=(",", ":"))) for t in listed
    )
    assert len(listed) <= 52, "consolidate tools before adding more"
    assert chars <= 22_000, f"the MCP now costs ~{chars // 4} tokens up front; trim before adding more"
