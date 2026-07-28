"""Generic / shared response models (command results, health, validation)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class CommandResult(BaseModel):
    """Result of running a netlab CLI verb (up/down/restart/exec/...)."""

    code: int
    stdout: str
    stderr: str


class OkResult(BaseModel):
    ok: bool


class OkMessageResult(BaseModel):
    ok: bool
    message: str


class RevisionResult(BaseModel):
    ok: bool
    revision: int


class NetlabComponentStatus(BaseModel):
    name: str
    version: str | None = None
    category: Literal["required", "optional", "ansible"]
    installed: bool


class HealthStatus(BaseModel):
    ok: bool
    appVersion: str | None = None
    netlab: bool
    containerlab: bool | None = None
    libvirt: bool | None = None
    netlabVersion: str | None = None
    containerlabVersion: str | None = None
    libvirtVersion: str | None = None
    netlabVersionSupported: bool | None = None
    minNetlabVersion: str | None = None
    netlabComponents: list[NetlabComponentStatus] = []


class VersionResult(BaseModel):
    version: str | None = None
    code: int | None = None
    error: str | None = None


class NetlabEnvironment(BaseModel):
    """Where netlab resolved to and how — drives the Settings UI and Info tab."""

    configured: str | None = None
    source: str
    command: str
    binPath: str | None = None
    found: bool
    binDir: str | None = None
    targetPython: str | None = None
    inBackendVenv: bool
    envVar: str
    configPath: str
    netlabVersion: str | None = None
    netlabVersionSupported: bool | None = None
    minNetlabVersion: str | None = None
    containerlab: bool = False
    libvirt: bool = False


class SetNetlabPathRequest(BaseModel):
    path: str | None = None


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    message: str
    entityType: Literal["node", "link", "topology"]
    entityId: str | None = None


class ValidationResult(CommandResult):
    issues: list[ValidationIssue] = []


class ConfigPreviewFile(BaseModel):
    path: str
    content: str


class ConfigPreviewResult(BaseModel):
    node: str
    files: list[ConfigPreviewFile] = []
    generated: bool = False
    message: str | None = None


class DeployDiffResult(BaseModel):
    changed: bool
    baselineExists: bool
    recordedAt: str | None = None
    diff: str = ""


class RuntimeInterfaceStats(BaseModel):
    rxBps: int | None = None
    txBps: int | None = None
    rxPps: int | None = None
    txPps: int | None = None
    rxBytes: int = 0
    txBytes: int = 0
    rxPackets: int = 0
    txPackets: int = 0
    statsIntervalSeconds: float | None = None


class RuntimeInterface(BaseModel):
    name: str
    alias: str
    label: str | None = None
    mac: str = ""
    mtu: int = 0
    state: str = "unknown"
    type: str = ""
    ifIndex: int | None = None
    stats: RuntimeInterfaceStats | None = None


class RuntimeContainer(BaseModel):
    name: str
    nodeName: str
    labName: str
    state: str
    kind: str = ""
    image: str = ""
    ipv4Address: str = ""
    ipv6Address: str = ""
    interfaces: list[RuntimeInterface] = []
