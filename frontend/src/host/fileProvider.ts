import type React from "react";
import { getApiBase } from "../api/endpoint";
import type { LabFileEntry } from "../api/client";
import type { WorkspaceEntry } from "../lifecycle/types";

interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

interface FileTreeNode {
  id: string;
  label: string;
  description?: string;
  tooltip: string;
  contextValue: string;
  endpointId: string;
  labName?: string;
  resourceKind: "file" | "directory";
  resourcePath: string;
  hasChildren: boolean;
  collapsibleState: 0 | 1;
  topologyRef?: unknown;
  children: FileTreeNode[];
  command?: { command: string; title: string; arguments: unknown[] };
}

// Per-directory listing cache. Explorer snapshots rebuild on every data
// change (running-lab node status ticks during a deploy, plus an unconditional
// 15 s timer in useExplorerController) and each rebuild re-resolves every
// expanded directory. This TTL must stay comfortably above that rebuild
// cadence — a shorter TTL (this used to be 4000, well under the 15 s timer)
// is *always* expired by the next rebuild, so every expanded directory gets
// refetched on every cycle: an endless GET storm that scales with however
// many directories are expanded, not with anything that actually changed.
const DIR_TTL_MS = 30000;
const dirCache = new Map<string, { at: number; entries: TreeEntry[] }>();
const dirInflight = new Map<string, Promise<TreeEntry[]>>();

async function listDir(path: string): Promise<TreeEntry[]> {
  const cached = dirCache.get(path);
  if (cached && Date.now() - cached.at < DIR_TTL_MS) return cached.entries;
  const inflight = dirInflight.get(path);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const res = await fetch(
        `${getApiBase()}/api/lab/files/tree?path=${encodeURIComponent(path)}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      const entries: TreeEntry[] = data.entries ?? [];
      dirCache.set(path, { at: Date.now(), entries });
      return entries;
    } catch {
      return [];
    } finally {
      dirInflight.delete(path);
    }
  })();
  dirInflight.set(path, promise);
  return promise;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function fileNode(entry: TreeEntry, labFileByPath: Map<string, LabFileEntry>): FileTreeNode {
  const labFile = labFileByPath.get(entry.path);
  const openArgs = {
    id: `file:local:${entry.path}`,
    contextValue: "containerlabFileTopology",
    endpointId: "local",
    topologyRef: labFile?.topologyRef,
    path: entry.path,
    title: entry.name,
    label: entry.name,
    resourcePath: entry.path
  };
  return {
    id: `file:local:${entry.path}`,
    label: entry.name,
    tooltip: entry.path,
    // clab-ui's snapshot adapter only wires a primary click action for
    // contextValues it knows; plain files reuse the topology-file context so
    // single-click opens them in the editor.
    contextValue: "containerlabFileTopology",
    endpointId: "local",
    labName: labFile?.labName,
    resourceKind: "file",
    resourcePath: entry.path,
    hasChildren: false,
    collapsibleState: 0,
    topologyRef: labFile?.topologyRef,
    children: [],
    command: {
      command: "containerlab.file.open",
      title: "Open File",
      arguments: [openArgs]
    }
  };
}

function dirNode(entry: TreeEntry): FileTreeNode {
  return {
    id: `file-dir:local:${entry.path}`,
    label: entry.name,
    tooltip: entry.path,
    // Native clab-ui folder context: enables the built-in "New Folder" action
    // and lets contributed file actions attach (see useExplorerController).
    contextValue: "containerlabFileFolder",
    endpointId: "local",
    resourceKind: "directory",
    resourcePath: entry.path,
    hasChildren: true,
    collapsibleState: 1,
    children: []
  };
}

/** Children of one directory, listed as-is with no filtering or grouping. */
async function dirChildren(dirPath: string, labFileByPath: Map<string, LabFileEntry>) {
  const entries = await listDir(dirPath);
  return entries.map((e) => (e.kind === "dir" ? dirNode(e) : fileNode(e, labFileByPath)));
}

export function buildFileProvider(
  labFilesRef: React.RefObject<LabFileEntry[]>,
  workspacesRef: React.RefObject<WorkspaceEntry[]>
) {
  const labFileByPath = () =>
    new Map((labFilesRef.current ?? []).map((f) => [f.path, f] as const));

  return {
    async getChildren(element?: FileTreeNode) {
      if (!element) {
        const wsList = workspacesRef.current ?? [];
        return wsList.map((ws) => ({
          id: `file-ws:local:${ws.path}`,
          label: basename(ws.path),
          description: wsList.length > 1 ? ws.path : undefined,
          tooltip: ws.path,
          // Native clab-ui root context: surfaces "New Folder" plus our
          // contributed "Clone Repo Here" / "Remove From Workspace" actions.
          contextValue: "containerlabFileExplorerRoot",
          endpointId: "local",
          resourceKind: "directory",
          resourcePath: ws.path,
          hasChildren: true,
          collapsibleState: 1,
          children: []
        }));
      }

      const id: string = element.id ?? "";
      if (id.startsWith("file-ws:local:") || id.startsWith("file-dir:local:")) {
        return dirChildren(element.resourcePath, labFileByPath());
      }
      return element.children || [];
    }
  };
}
