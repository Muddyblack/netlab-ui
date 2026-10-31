"""Pre-deploy readiness checklist + config diff response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReadinessCheck(BaseModel):
    id: str
    category: str
    title: str
    status: Literal["pass", "warn", "fail", "info"]
    detail: str = ""
    items: list[str] = []
    hint: str | None = None
    objectRefs: list[str] = []


class ReadinessSummary(BaseModel):
    passed: int = 0
    warn: int = 0
    fail: int = 0


class ReadinessResult(BaseModel):
    ready: bool = False
    summary: ReadinessSummary = ReadinessSummary()
    checks: list[ReadinessCheck] = []


class ConfigDiffFile(BaseModel):
    path: str
    module: str
    leftPresent: bool = False
    rightPresent: bool = False
    identical: bool = False
    added: int = 0
    removed: int = 0
    hunks: list[str] = []
    leftContent: str = ""
    rightContent: str = ""


class ConfigDiffSummary(BaseModel):
    same: int = 0
    different: int = 0
    onlyLeft: int = 0
    onlyRight: int = 0


class ConfigDiffResult(BaseModel):
    available: bool = False
    left: str
    right: str
    files: list[ConfigDiffFile] = []
    summary: ConfigDiffSummary = ConfigDiffSummary()
