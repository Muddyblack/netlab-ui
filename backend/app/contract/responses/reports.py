"""Report catalog + run result response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReportDescriptor(BaseModel):
    id: str
    name: str
    description: str = ""
    format: Literal["table", "markdown", "html", "text"]
    source: Literal["builtin", "workspace", "user", "system"]
    structuredAdapter: Literal["addressing", "bgp-neighbor"] | None = None


class ReportCatalogResult(BaseModel):
    reports: list[ReportDescriptor] = []


class ReportTable(BaseModel):
    title: str = ""
    columns: list[str] = []
    rows: list[list[str]] = []
    objectRefs: list[list[str]] = []


class ReportRunResult(BaseModel):
    report: ReportDescriptor
    tables: list[ReportTable] = []
    raw: str = ""
    searchableText: str = ""


class ReportRunRequest(BaseModel):
    sessionId: str
    reportId: str
