"""Schema/docs response models — device kind picker + rendered docs pages."""

from __future__ import annotations

from pydantic import BaseModel


class DeviceEntry(BaseModel):
    kind: str
    label: str


class DocsDocument(BaseModel):
    title: str
    markdown: str
    docs_url: str | None = None
