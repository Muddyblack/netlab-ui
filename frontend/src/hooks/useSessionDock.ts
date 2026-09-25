import { useCallback, useMemo, useState } from "react";

export type SessionKind = "shell" | "logs" | "drawio" | "multi";
export type SessionTab = { key: string; kind: SessionKind; node: string; sessionId?: string | null };

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
 * mounted while the dock is collapsed so their WebSockets survive. Each tab is
 * tagged with the topology session it was opened for and only tabs of the
 * current session are shown, since shells and log streams are bound to a
 * sessionId. Tagging (rather than clearing on switch) lets a caller open a lab
 * and a shell into it in one go without the switch wiping the new tab. */
export function useSessionDock(sessionId: string | null) {
  const [state, setState] = useState<{ tabs: SessionTab[]; activeKey: string | null }>({ tabs: [], activeKey: null });
  const [open, setOpen] = useState(true);

  const openTab = useCallback((kind: SessionKind, node: string, forSession?: string | null) => {
    if (kind === "shell") recordRecentShellNode(node);
    const key = sessionTabKey(kind, node);
    const sid = forSession === undefined ? sessionId : forSession;
    setState((current) => {
      const kept = current.tabs.filter((tab) => tab.sessionId === sid);
      return {
        tabs: kept.some((tab) => tab.key === key) ? kept : [...kept, { key, kind, node, sessionId: sid }],
        activeKey: key
      };
    });
    setOpen(true);
  }, [sessionId]);

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

  const tabs = useMemo(() => state.tabs.filter((tab) => tab.sessionId === sessionId), [state.tabs, sessionId]);
  const activeKey = tabs.some((tab) => tab.key === state.activeKey) ? state.activeKey : (tabs[0]?.key ?? null);

  return { tabs, activeKey, open, setOpen, openTab, selectTab, closeTab };
}
