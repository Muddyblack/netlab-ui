import { blurActiveElement } from "../utils/focus";
import type { LabFileEntry } from "../api/client";

const LAST_OPEN_LAB_KEY = "netlab:last-open-lab";
const EXPLORER_UI_STATE_KEY = "netlab:explorer-ui-state";
const OPEN_TABS_KEY = "netlab:open-tabs-v1";
const RECENT_LABS_KEY = "netlab:recent-labs-v1";
const PINNED_LABS_KEY = "netlab:pinned-labs-v1";

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

export function persistLastOpenLabPath(yamlPath: string | null) {
  try {
    if (yamlPath) {
      window.localStorage.setItem(LAST_OPEN_LAB_KEY, yamlPath);
      const recent = readRecentLabPaths().filter((path) => path !== yamlPath);
      window.localStorage.setItem(RECENT_LABS_KEY, JSON.stringify([yamlPath, ...recent].slice(0, 12)));
    } else {
      window.localStorage.removeItem(LAST_OPEN_LAB_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

function readStringArray(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function readRecentLabPaths(): string[] {
  return readStringArray(RECENT_LABS_KEY);
}

export function readPinnedLabPaths(): string[] {
  return readStringArray(PINNED_LABS_KEY);
}

export function togglePinnedLabPath(path: string): string[] {
  const current = readPinnedLabPaths();
  const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
  try { window.localStorage.setItem(PINNED_LABS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}

export function readLastOpenLabPath(): string | null {
  try {
    return window.localStorage.getItem(LAST_OPEN_LAB_KEY);
  } catch {
    return null;
  }
}

export function persistOpenTabSession(session: PersistedTabSession) {
  try {
    if (session.tabs.length === 0) {
      window.localStorage.removeItem(OPEN_TABS_KEY);
      return;
    }
    window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(session));
  } catch {
    // Storage can be disabled or full; tab persistence is best-effort.
  }
}

export function readOpenTabSession(): PersistedTabSession | null {
  try {
    const raw = window.localStorage.getItem(OPEN_TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs)) return null;
    const tabs = (parsed.tabs as unknown[]).filter((tab): tab is PersistedTab => {
      if (!tab || typeof tab !== "object" || typeof (tab as { id?: unknown }).id !== "string") return false;
      const candidate = tab as { kind?: unknown; topologyRef?: { yamlPath?: unknown }; path?: unknown; endpointId?: unknown };
      if (candidate.kind === "topology") return typeof candidate.topologyRef?.yamlPath === "string";
      return candidate.kind === "file" && typeof candidate.path === "string" && typeof candidate.endpointId === "string";
    });
    return {
      tabs,
      activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null
    };
  } catch {
    return null;
  }
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
    const raw = window.localStorage.getItem(EXPLORER_UI_STATE_KEY);
    if (!raw) return defaultExplorerUiState();

    const parsed = JSON.parse(raw);
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
  try {
    window.localStorage.setItem(EXPLORER_UI_STATE_KEY, JSON.stringify(state ?? defaultExplorerUiState()));
  } catch {
    // ignore storage failures
  }
}

export function closeExplorerTransientUi() {
  const eventInit: KeyboardEventInit = { key: "Escape", code: "Escape", bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  blurActiveElement();
}
