"""What the direct-API providers send to, and get back from, a vendor.

Gemini's function-declaration schema is an OpenAPI 3.0 subset and its API
rejects unknown keys outright, so a schema keyword Pydantic emits for a Python
type hint can 400 every Gemini turn. That failure only shows up against the
live API, which no test can reach — hence these.
"""

from __future__ import annotations

import json

import pytest

pytest.importorskip("mcp")

from services.assistant import mcp_server
from services.assistant.providers.mcp_agent import describe_vendor_error, json_schema_for_vendor

# Keys that made the Gemini API reject the whole request.
FORBIDDEN = ("additionalProperties", "$schema", "$defs", "$ref", "allOf", "oneOf", '"null"')


def test_nested_additional_properties_is_stripped():
    """The regression: `list[dict[str, Any]]` nests it under items."""
    schema = {
        "type": "object",
        "properties": {
            "commands": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        },
    }
    cleaned = json_schema_for_vendor(schema)
    assert "additionalProperties" not in json.dumps(cleaned)
    # The useful structure survives.
    assert cleaned["properties"]["commands"]["items"] == {"type": "object"}


def test_optional_argument_becomes_nullable():
    """Gemini's type enum has no null, so `X | None` needs rewriting."""
    schema = {
        "type": "object",
        "properties": {
            "session_id": {"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Session Id"},
        },
    }
    field = json_schema_for_vendor(schema)["properties"]["session_id"]
    assert field["type"] == "string"
    assert field["nullable"] is True
    assert "anyOf" not in field
    assert field["title"] == "Session Id"


def test_multiple_non_null_branches_are_kept():
    field = json_schema_for_vendor({"anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]})
    assert field["nullable"] is True
    assert field["anyOf"] == [{"type": "string"}, {"type": "integer"}]


def test_unknown_keywords_are_dropped():
    """Allowlist, not denylist — a new keyword must not reach the vendor."""
    cleaned = json_schema_for_vendor(
        {"type": "string", "const": "x", "examples": ["a"], "$comment": "hi", "description": "keep"}
    )
    assert cleaned == {"type": "string", "description": "keep"}


def test_every_registered_tool_is_vendor_safe():
    """Guards tools added later, which is how this broke in the first place."""
    server = mcp_server.build_server()
    for tool in server._tool_manager.list_tools():
        rendered = json.dumps(json_schema_for_vendor(tool.parameters))
        for forbidden in FORBIDDEN:
            assert forbidden not in rendered, f"{tool.name} still carries {forbidden}"


class _VendorError(Exception):
    """Stands in for a vendor SDK error: stringifies as the raw API payload."""

    def __init__(self, code: int, payload: dict) -> None:
        super().__init__(f"{code} {payload}")
        self.code = code
        self.message = payload


def test_quota_errors_are_readable():
    """A 429 arrives as several hundred characters of nested JSON."""
    exc = _VendorError(
        429,
        {
            "error": {
                "code": 429,
                "message": "You exceeded your current quota.\n* Quota exceeded for metric: "
                "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",
                "status": "RESOURCE_EXHAUSTED",
            }
        },
    )
    described = describe_vendor_error(exc)
    assert "quota" in described.lower()
    assert "{" not in described  # not a JSON dump
    assert "\n" not in described


def test_credential_errors_say_so():
    exc = _VendorError(400, {"error": {"message": "API key not valid. Please pass a valid API key."}})
    assert "credentials" in describe_vendor_error(exc)


def test_plain_exceptions_pass_through():
    assert describe_vendor_error(RuntimeError("connection reset")) == "connection reset"
