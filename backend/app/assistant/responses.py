"""Response models for the assistant API.

Declared as Pydantic models so they land in the OpenAPI schema and the frontend
can consume generated types (``npm run gen:api``) instead of hand-rolled shapes.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class AssistantProvider(BaseModel):
    id: str
    name: str
    available: bool
    version: str | None = None
    note: str | None = None
    configurable: bool = False
    takesModel: bool = False
    apiKeyUrl: str | None = None


class AssistantMcpInfo(BaseModel):
    """Everything a user needs to attach their own agent to this lab."""

    url: str
    authHeader: str
    tools: list[str] = []
    clientConfig: str = ""


class AssistantCapabilities(BaseModel):
    enabled: bool
    providers: list[AssistantProvider] = []
    modes: list[str] = ["ask", "plan", "build", "tutor"]
    mcp: AssistantMcpInfo | None = None


class AssistantChatInfo(BaseModel):
    chatId: str
    providerId: str
    sessionId: str
    mode: str
    model: str = ""
    busy: bool = False
    title: str = "New conversation"
    createdAt: float = 0.0


class AssistantHistory(BaseModel):
    chat: AssistantChatInfo
    events: list[dict[str, Any]] = []


class AssistantChatList(BaseModel):
    chats: list[AssistantChatInfo] = []


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


class AssistantModelList(BaseModel):
    """Model ids a provider advertises, for the settings picker."""

    models: list[str] = []


class AssistantProviderSettings(BaseModel):
    """A provider's stored settings, as shown/edited in the UI.

    ``hasApiKey`` says whether a key is configured without ever sending the
    key itself back down; ``apiKey`` only appears in the PUT request body.
    ``baseUrl`` is not a secret (it names an endpoint), so it round-trips
    directly — it is only meaningful for OpenAI-compatible providers.
    """

    hasApiKey: bool = False
    model: str = ""
    baseUrl: str = ""
    envLocked: list[str] = []
