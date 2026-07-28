"""Lab surface response models — files, workspaces, images, icons."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class TopologyRef(BaseModel):
    topologyId: str
    labName: str
    yamlPath: str
    source: str


class LabFileEntry(BaseModel):
    endpointId: str
    filename: str
    path: str
    hasAnnotations: bool
    labName: str
    deploymentState: str
    topologyRef: TopologyRef
    workspace: str | None = None


class WorkspaceEntry(BaseModel):
    path: str
    exists: bool
    labCount: int = 0


class LabInstance(BaseModel):
    id: str
    name: str
    directory: str
    status: str
    providers: list[str] = []
    directoryExists: bool


class LabInstanceAction(BaseModel):
    action: Literal["cleanup", "force-cleanup", "forget"]


class FileTreeEntry(BaseModel):
    name: str
    path: str
    kind: str  # "file" | "dir"
    # True for netlab-generated artifacts (provider files, inventory, sidecars)
    # so the explorer can de-emphasize or group them below actual sources.
    generated: bool = False


class FileTreeResult(BaseModel):
    entries: list[FileTreeEntry]


class FileDocument(BaseModel):
    path: str
    content: str


class WorkspaceListResult(BaseModel):
    workspaces: list[WorkspaceEntry]


class FsEntry(BaseModel):
    """One directory entry returned by the filesystem browser."""

    name: str
    path: str
    isDir: bool


class FsBrowseResult(BaseModel):
    """A single directory level for the "add workspace" folder picker."""

    path: str
    parent: str | None = None
    entries: list[FsEntry]


class ExampleLab(BaseModel):
    """A curated example/demo lab repository the user can clone in one click."""

    name: str
    description: str
    repoUrl: str
    stars: int = 0


class ExampleLabListResult(BaseModel):
    labs: list[ExampleLab]


class DockerImage(BaseModel):
    id: str
    repoTags: list[str]
    repoDigests: list[str]
    size: str


class KindImageReference(BaseModel):
    """One kind->image pairing clab-ui's Image Manager uses to build its
    per-kind guidance catalog (matches its ``KindImageReference`` TS type)."""

    kind: str
    image: str
    source: Literal[
        "topology-defaults",
        "topology-kind",
        "topology-group",
        "topology-node",
        "custom-template",
        "running-lab",
        "pinned",
    ]
    label: str
    endpointId: str | None = None
    path: str | None = None
    nodeName: str | None = None
    type: str | None = None


class ImageOpResult(BaseModel):
    success: bool
    message: str | None = None
    output: str | None = None


class IconInfo(BaseModel):
    name: str
    source: str
    dataUri: str
    format: str


class IconListResult(BaseModel):
    icons: list[str]
    items: list[IconInfo] = []
