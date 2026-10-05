"""The free-text `how_to` tool (services.assistant.howto)."""

from __future__ import annotations

import asyncio

from services.assistant import howto, mcp_server


def ask(question: str) -> dict:
    return asyncio.run(mcp_server.how_to(question))


def test_every_tool_belongs_to_a_topic_and_every_topic_tool_exists():
    registered = set(mcp_server.tool_names()) - {"how_to"}
    listed = {name for _title, _approach, names in howto.TOPICS.values() for name in names}
    assert registered - listed == set(), "add these tools to a topic in howto.TOPICS"
    assert listed - registered == set(), "howto.TOPICS names tools that do not exist"


def test_plain_language_finds_the_right_topic_and_its_tools():
    result = ask("capture BGP traffic on r1")
    assert result["topics"][0]["topic"] == "packets"
    tools = {t["name"]: t for t in result["topics"][0]["tools"]}
    assert "capture_packets" in tools and "seconds" in tools["capture_packets"]["parameters"]
    assert "lab" not in tools["capture_packets"]["parameters"].split(", ")
    assert ask("I want to add a dashboard")["topics"][0]["topic"] == "monitoring"
    assert ask("highlight the link for the user")["topics"][0]["topic"] == "show"
    assert ask("scale the lab to 8 leaves")["topics"][0]["topic"] == "edit"


def test_any_word_in_a_tool_description_finds_it_even_outside_topics():
    result = ask("hex dump")
    names = [t["name"] for topic in result.get("topics", []) for t in topic["tools"]]
    names += [t["name"] for t in result.get("also_matching", [])]
    assert "read_capture" in names


def test_nothing_is_ever_a_dead_end():
    for question in ("", "zzzqqq xyzzy"):
        result = ask(question)
        assert "topics" not in result and result["topics_available"] and "how_to" in result["all_tools"]
        assert result["note"]


def test_how_to_is_registered_and_listed_first():
    assert "how_to" in mcp_server.tool_names()
    assert mcp_server._tool_entries()[0]["name"] == "how_to"


def test_slim_schema_drops_boilerplate_but_keeps_every_parameter():
    schema = {
        "title": "xArguments",
        "type": "object",
        "properties": {
            "lab": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None, "title": "Lab"},
            "title": {"type": "string", "title": "Title"},
            "n": {"type": "integer", "default": 5, "title": "N"},
        },
        "required": ["title"],
    }
    assert mcp_server.slim_schema(schema) == {
        "type": "object",
        "properties": {"lab": {"type": "string"}, "title": {"type": "string"}, "n": {"type": "integer", "default": 5}},
        "required": ["title"],
    }


def test_tools_still_accept_their_arguments_after_slimming():
    server = mcp_server.build_server()
    tools = {t.name: t for t in server._tool_manager.list_tools()}
    assert "title" not in tools["netlab_inspect"].parameters
    assert "title" in tools["create_teaching_document"].parameters["properties"]
    result = asyncio.run(server.call_tool("how_to", {"question": "capture packets"}))
    assert "capture_packets" in str(result)
