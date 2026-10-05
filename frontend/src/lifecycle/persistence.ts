import { blurActiveElement } from "../utils/focus";
import { readUserState, writeUserState } from "../api/userState";
import { loadBuffers, saveBuffers, type FileBuffer } from "../utils/bufferStore";
import { readJson, readStored, removeStored, writeJson, writeStored } from "../utils/storage";
import type { LabFileEntry } from "../api/client";

const LAST_OPEN_LAB_KEY = "netlab:last-open-lab";
const EXPLORER_UI_STATE_KEY = "netlab:explorer-ui-state";
const OPEN_TABS_KEY = "netlab:open-tabs-v1";

export type PersistedTab =
  | {
      kind: "topology";
      id: string;
      title: string;
      subtitle: string;
      topologyRef: LabFileEntry["topologyRef"];
    }
  | {
      kind: "file";
      id: string;
      title: string;
      subtitle: string;
      path: string;
      endpointId: string;
      /** Kept so an unsaved editor buffer is not lost on a browser reload. */
      content: string;
      originalContent: string;
    }
  | {
      kind: "web";
      id: string;
      title: string;
      subtitle: string;
      url: string;
    };

export type PersistedTabSession = {
  tabs: PersistedTab[];
  activeTabId: string | null;
};

export function resolveOpenLabTab(topologyRef: LabFileEntry["topologyRef"]) {
  const path = String(topologyRef?.yamlPath ?? "");
  const fileName = path.split("/").pop() ?? "";
  const title = topologyRef?.labName || fileName.replace(/\.(ya?ml)$/i, "") || "Topology";
  return {
    kind: "topology" as const,
    id: path || String(topologyRef?.topologyId ?? title),
    title,
    subtitle: "Local workspace",
    topologyRef
  };
}

export function buildFileTabId(endpointId: string, path: string): string {
  return `file:${endpointId}:${path}`;
}

export function buildWebTabId(url: string): string {
  return `web:${url}`;
}

export function persistLastOpenLabPath(yamlPath: string | null) {
  if (!yamlPath) {
    removeStored(LAST_OPEN_LAB_KEY);
    return;
  }
  writeStored(LAST_OPEN_LAB_KEY, yamlPath);
  const recent = readRecentLabPaths().filter((path) => path !== yamlPath);
  writeUserState("recentLabs", [yamlPath, ...recent].slice(0, 12));
}

export function readRecentLabPaths(): string[] {
  return readUserState("recentLabs");
}

export function readPinnedLabPaths(): string[] {
  return readUserState("pinnedLabs");
}

export function togglePinnedLabPath(path: string): string[] {
  const current = readPinnedLabPaths();
  const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
  writeUserState("pinnedLabs", next);
  return next;
}

export function readLastOpenLabPath(): string | null {
  return readStored(LAST_OPEN_LAB_KEY);
}

/** What the tab session says about a file tab. The text normally lives in
 * IndexedDB (see bufferStore.ts); `content` is only inlined when that is
 * unavailable, and by sessions saved before buffers moved there. */
type StoredFileTab = Omit<Extract<PersistedTab, { kind: "file" }>, "content" | "originalContent"> &
  Partial<FileBuffer>;
type StoredTab = Exclude<PersistedTab, { kind: "file" }> | StoredFileTab;

/** How a save went: "ok" in IndexedDB, "inline" when it had to fall back to
 * localStorage, "failed" when neither could hold the unsaved edits. */
export type SessionSaveResult = "ok" | "inline" | "failed";

export async function persistOpenTabSession(session: PersistedTabSession): Promise<SessionSaveResult> {
  if (session.tabs.length === 0) {
    removeStored(OPEN_TABS_KEY);
    await saveBuffers({});
    return "ok";
  }
  const buffers: Record<string, FileBuffer> = {};
  const light: StoredTab[] = session.tabs.map((tab) => {
    if (tab.kind !== "file") return tab;
    buffers[tab.id] = { content: tab.content, originalContent: tab.originalContent };
    const { content: _content, originalContent: _original, ...rest } = tab;
    return rest;
  });
  if (await saveBuffers(buffers)) {
    return writeJson(OPEN_TABS_KEY, { tabs: light, activeTabId: session.activeTabId }) ? "ok" : "failed";
  }
  // IndexedDB is unavailable (some private modes): keep the old behavior.
  return writeJson(OPEN_TABS_KEY, session) ? "inline" : "failed";
}

function isStoredTab(tab: unknown): tab is StoredTab {
  if (!tab || typeof tab !== "object" || typeof (tab as { id?: unknown }).id !== "string") return false;
  const candidate = tab as { kind?: unknown; topologyRef?: { yamlPath?: unknown }; path?: unknown; endpointId?: unknown; url?: unknown };
  if (candidate.kind === "web") return typeof candidate.url === "string";
  if (candidate.kind === "topology") return typeof candidate.topologyRef?.yamlPath === "string";
  return candidate.kind === "file" && typeof candidate.path === "string" && typeof candidate.endpointId === "string";
}

export async function readOpenTabSession(): Promise<PersistedTabSession | null> {
  const parsed = readJson<{ tabs?: unknown; activeTabId?: unknown } | null>(OPEN_TABS_KEY, null);
  if (!Array.isArray(parsed?.tabs)) return null;
  const stored = (parsed.tabs as unknown[]).filter(isStoredTab);
  const buffers = stored.some((tab) => tab.kind === "file") ? await loadBuffers() : new Map<string, FileBuffer>();
  const tabs: PersistedTab[] = [];
  for (const tab of stored) {
    if (tab.kind !== "file") {
      tabs.push(tab);
      continue;
    }
    const inline =
      typeof tab.content === "string" && typeof tab.originalContent === "string"
        ? { content: tab.content, originalContent: tab.originalContent }
        : null;
    const buffer = buffers.get(tab.id) ?? inline;
    // A file tab whose text is gone cannot be restored; the file can be reopened from disk.
    if (buffer) tabs.push({ ...tab, ...buffer });
  }
  return {
    tabs,
    activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null
  };
}

function defaultExplorerUiState() {
  return {
    collapsedBySection: {
      runningLabs: false,
      localLabs: false,
      fileExplorer: false,
      helpFeedback: false
    },
    expandedBySection: {
      runningLabs: [
        "endpoint:local",
        "endpoint-section:running:local",
        "endpoint-section:local:local"
      ],
      fileExplorer: ["file-root:local"]
    }
  };
}

export function readPersistedExplorerUiState() {
  try {
    const parsed = readJson<any>(EXPLORER_UI_STATE_KEY, null);
    if (!parsed) return defaultExplorerUiState();

    const expandedBySection = {
      ...defaultExplorerUiState().expandedBySection,
      ...(parsed?.expandedBySection ?? {})
    };

    // Migrate older custom file explorer IDs to upstream-style IDs.
    if (Array.isArray(expandedBySection.fileExplorer)) {
      expandedBySection.fileExplorer = expandedBySection.fileExplorer
        .map((id: string) => {
          if (id === "file-explorer:root") return "file-root:local";
          if (id.startsWith("file-explorer:file:")) return id.replace(/^file-explorer:file:/, "file:local:");
          if (id.startsWith("file-root:")) return "file-root:local";
          const fileMatch = id.match(/^file:[^:]+:(.+)$/);
          if (fileMatch) return `file:local:${fileMatch[1]}`;
          return id;
        })
        .filter((id: string, index: number, arr: string[]) => arr.indexOf(id) === index);

      if (!expandedBySection.fileExplorer.includes("file-root:local")) {
        expandedBySection.fileExplorer.unshift("file-root:local");
      }
    }

    return {
      ...defaultExplorerUiState(),
      ...parsed,
      collapsedBySection: {
        ...defaultExplorerUiState().collapsedBySection,
        ...(parsed?.collapsedBySection ?? {})
      },
      expandedBySection
    };
  } catch {
    return defaultExplorerUiState();
  }
}

export function persistExplorerUiState(state: unknown) {
  writeJson(EXPLORER_UI_STATE_KEY, state ?? defaultExplorerUiState());
}

export function closeExplorerTransientUi() {
  const eventInit: KeyboardEventInit = { key: "Escape", code: "Escape", bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  blurActiveElement();
}
