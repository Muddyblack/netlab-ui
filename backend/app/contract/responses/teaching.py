"""Guided-tour document model.

A tour is nothing more than an ordered list of *captured lens views* with a
caption — authored by using the lenses normally and snapshotting the canvas,
then replayed in a full-bleed presenter. There is deliberately no task/grading
machinery here: if a step needs to show pass/fail it simply captures the
validation or readiness lens, which already renders that.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

LensId = Literal[
    "physical", "addressing", "routing", "services", "paths", "deployment", "validation", "readiness", "changes"
]
RoutingLayer = Literal["bgp", "ospf", "isis", "bfd", "evpn"]
AddressFamily = Literal["ipv4", "ipv6"]


class TourView(BaseModel):
    """Everything needed to restore the canvas to how a step looked."""

    lens: LensId = "physical"
    family: AddressFamily = "ipv4"
    routingLayers: list[RoutingLayer] = []
    revealRefs: list[str] = []
    dimOthers: bool = True
    focusRef: str | None = None


class TeachingStep(BaseModel):
    id: str
    caption: str = ""
    note: str = ""
    view: TourView = TourView()


class TeachingDocument(BaseModel):
    schemaVersion: int = 2
    id: str = "default"
    title: str = "Guided tour"
    revision: str = ""
    steps: list[TeachingStep] = []


class TeachingSaveResult(BaseModel):
    ok: bool
    document: TeachingDocument


class TeachingSaveRequest(BaseModel):
    sessionId: str
    document: TeachingDocument
