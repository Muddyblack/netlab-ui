"""Response models for the AI agents API (MCP connection + proposals).

Declared as Pydantic models so they land in the OpenAPI schema and the frontend
can consume generated types (``npm run gen:api``) instead of hand-rolled shapes.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class AssistantMcpInfo(BaseModel):
    """Everything a user needs to attach their own agent to this lab."""

    url: str
    authHeader: str
    tools: list[str] = []
    clientConfig: str = ""


class AssistantConnectHelp(BaseModel):
    """How to connect an agent that cannot be wired up automatically."""

    where: str
    text: str


class AssistantHarness(BaseModel):
    """An agent CLI netlab-ui can start in a terminal tab, pre-connected over MCP."""

    id: str
    name: str
    available: bool
    homepage: str = ""
    # How it gets connected: per run ("session"), by registering in its own config
    # before starting ("register"), or by hand ("manual", see `connect`).
    mcp: Literal["session", "register", "manual"] = "session"
    connect: AssistantConnectHelp | None = None
    # Whether netlab-ui knows the flag that makes this agent stop asking for permission.
    skipPermissions: bool = False


class AssistantCapabilities(BaseModel):
    enabled: bool
    mcp: AssistantMcpInfo | None = None
    harnesses: list[AssistantHarness] = []
    # False when agent terminals are refused for this client (remote, no login).
    harnessesAllowed: bool = True
    # Where agent CLIs are looked for and started: this machine ("native"), the host the container
    # runs on ("host"), or only inside the container ("container", see agentsNote for why).
    agentsRunOn: Literal["native", "host", "container"] = "native"
    agentsNote: str = ""


class AssistantProposal(BaseModel):
    id: str
    sessionId: str
    kind: Literal["edit", "action"]
    baseRevision: int
    rationale: str = ""
    summary: str = ""
    status: Literal["pending", "applied", "rejected", "stale"]
    diff: str = ""
    action: dict[str, Any] | None = None
    createdAt: float = 0.0


class AssistantProposalList(BaseModel):
    proposals: list[AssistantProposal] = []


class AssistantProposalResult(BaseModel):
    ok: bool
    proposal: AssistantProposal
    revision: int | None = None
    error: str | None = None


class AssistantAck(BaseModel):
    ok: bool = True
