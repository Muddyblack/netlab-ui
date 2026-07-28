import { useCallback, useEffect, useState } from "react";

export type SessionKind = "shell" | "logs" | "drawio";
export type SessionTab = { key: string; kind: SessionKind; node: string };

export const sessionTabKey = (kind: SessionKind, node: string) => `${kind}:${node}`;

const RECENT_NODES_KEY = "netlab:shell-recent-nodes";
const MAX_RECENT_NODES = 12;

export function loadRecentShellNodes(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_NODES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((node): node is string => typeof node === "string") : [];
  } catch {
    return [];
  }
}

function recordRecentShellNode(node: string): void {
  try {
    const next = [node, ...loadRecentShellNodes().filter((item) => item !== node)].slice(0, MAX_RECENT_NODES);
    localStorage.setItem(RECENT_NODES_KEY, JSON.stringify(next));
  } catch {
    // best-effort; ignore storage failures.
  }
}

/** Tab state for the bottom session dock (node shells + log streams). Tabs stay
 * mounted while the dock is collapsed so their WebSockets survive; the whole
 * set is dropped when the topology session changes, since shells and log
 * streams are bound to a sessionId. */
export function useSessionDock(sessionId: string | null) {
  const [state, setState] = useState<{ tabs: SessionTab[]; activeKey: string | null }>({ tabs: [], activeKey: null });
  const [open, setOpen] = useState(true);

  const openTab = useCallback((kind: SessionKind, node: string) => {
    if (kind === "shell") recordRecentShellNode(node);
    const key = sessionTabKey(kind, node);
    setState((current) => ({
      tabs: current.tabs.some((tab) => tab.key === key) ? current.tabs : [...current.tabs, { key, kind, node }],
      activeKey: key
    }));
    setOpen(true);
  }, []);

  const selectTab = useCallback((key: string) => {
    setState((current) => ({ ...current, activeKey: key }));
    setOpen(true);
  }, []);

  const closeTab = useCallback((key: string) => {
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.key === key);
      const tabs = current.tabs.filter((tab) => tab.key !== key);
      const activeKey = current.activeKey === key
        ? (tabs[Math.min(index, tabs.length - 1)]?.key ?? null)
        : current.activeKey;
      return { tabs, activeKey };
    });
  }, []);

  useEffect(() => {
    setState({ tabs: [], activeKey: null });
  }, [sessionId]);

  return { tabs: state.tabs, activeKey: state.activeKey, open, setOpen, openTab, selectTab, closeTab };
}
