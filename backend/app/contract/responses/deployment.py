"""Deployment/Ansible progress response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

DeploymentNodeState = Literal["queued", "creating", "configuring", "ready", "failed", "stopping", "stopped"]
DeploymentStage = Literal["preparing", "generating", "creating", "configuring", "stopping", "complete", "failed"]


class DeploymentSummary(BaseModel):
    total: int = 0
    queued: int = 0
    creating: int = 0
    configuring: int = 0
    ready: int = 0
    failed: int = 0
    stopping: int = 0
    stopped: int = 0


class DeploymentOverview(BaseModel):
    available: bool = False
    action: str | None = None
    running: bool = False
    done: bool = False
    exitCode: int | None = None
    stage: DeploymentStage = "preparing"
    currentTask: str | None = None
    startedAt: str | None = None
    finishedAt: str | None = None
    summary: DeploymentSummary = DeploymentSummary()
    nodes: dict[str, DeploymentNodeState] = {}


class DeploymentRecap(BaseModel):
    ok: int = 0
    changed: int = 0
    unreachable: int = 0
    failed: int = 0
    skipped: int = 0
    rescued: int = 0
    ignored: int = 0


class DeploymentEvent(BaseModel):
    sequence: int
    timestamp: str
    status: str
    task: str | None = None
    message: str | None = None


class DeploymentNodeDetail(BaseModel):
    available: bool = False
    node: str
    state: DeploymentNodeState | None = None
    currentTask: str | None = None
    lastError: str | None = None
    recap: DeploymentRecap = DeploymentRecap()
    events: list[DeploymentEvent] = []


class DeploymentLogLine(BaseModel):
    stream: Literal["stdout", "stderr"] = "stdout"
    line: str = ""
    section: DeploymentStage | None = None


class DeploymentLog(BaseModel):
    available: bool = False
    action: str | None = None
    running: bool = False
    done: bool = False
    exitCode: int | None = None
    startedAt: str | None = None
    finishedAt: str | None = None
    lines: list[DeploymentLogLine] = []
