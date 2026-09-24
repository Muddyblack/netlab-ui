import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { useTopoViewerStore } from "@containerlab/clab-ui";
import { refreshTopologySnapshot } from "@containerlab/clab-ui/session";
import type { ClabUiRuntime } from "@containerlab/clab-ui/host";
import type { TopologyRef as ClabTopologyRef } from "@containerlab/clab-ui/session";
import { getApiBase } from "../api/endpoint";
import {
  resolveOpenLabTab,
  buildFileTabId,
  persistLastOpenLabPath,
  persistOpenTabSession,
  type PersistedTabSession
} from "../lifecycle/persistence";
import type { OpenLabTab, OpenFileTab, OpenTab, RuntimeSnackbarState } from "../lifecycle/types";
import type { AppClabUiHost } from "../host/createHost";
import type { LabFileEntry } from "../api/client";

export type TopologyRef = LabFileEntry["topologyRef"];

interface Options {
  host: AppClabUiHost;
  fetchFiles: () => Promise<void>;
  addToast: (message: string, severity?: RuntimeSnackbarState["severity"]) => void;
  runtimeRef: React.RefObject<ClabUiRuntime | null>;
}

export function useTabManager({ host, fetchFiles, addToast, runtimeRef }: Options) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [restoreComplete, setRestoreComplete] = useState(false);

  // The live backend session, read through a ref: activations overlap (a
  // double-click in the explorer fires several opens), and each one must
  // dispose whatever session is current *now*, not the one its render closed
  // over — otherwise every overlapping open leaks a backend session and later
  // requests hit 404s on the stale ids.
  const sessionIdRef = useRef<string | null>(null);
  const activationSeq = useRef(0);
  const inflight = useRef<{ tabId: string; promise: Promise<void> } | null>(null);
  // Topology the active session belongs to, and background sessions opened
  // for explorer actions on labs that are not the active tab (keyed by YAML
  // path, reused, and never made the host's active session).
  const activePathRef = useRef<string | null>(null);
  const helperSessions = useRef(new Map<string, Promise<string>>());
  const sessionPaths = useRef(new Map<string, string>());
  const setCurrentSession = useCallback((sid: string | null, yamlPath: string | null = null) => {
    sessionIdRef.current = sid;
    activePathRef.current = sid ? yamlPath : null;
    host.activateSession(sid);
    setSessionId(sid);
  }, [host]);

  // Dispose on unmount and on page unload (keepalive lets the DELETE outlive
  // the page), so reloads do not pile up orphaned sessions in the backend.
  useEffect(() => {
    const onPageHide = () => {
      const release = (sid: string) => {
        try {
          void fetch(`${getApiBase()}/api/topology/sessions/${sid}`, { method: "DELETE", keepalive: true });
        } catch { /* best effort */ }
      };
      if (sessionIdRef.current) release(sessionIdRef.current);
      for (const pending of helperSessions.current.values()) void pending.then(release, () => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      const sid = sessionIdRef.current;
      if (sid) void host.disposeSession(sid).catch(() => undefined);
    };
  }, [host]);

  const clearActiveLabSession = useCallback(async () => {
    const rt = runtimeRef.current;
    const resetContext = () => rt?.session.setContext({ sessionId: undefined, topologyRef: undefined, mode: "view", deploymentState: "unknown" });
    // Invalidate any activation still in flight so it cannot resurrect a tab
    // that was just closed.
    activationSeq.current += 1;
    inflight.current = null;
    const sid = sessionIdRef.current;
    setCurrentSession(null);
    if (sid) {
      try { await host.disposeSession(sid); } catch (err) { console.warn("Failed to dispose session:", err); }
    }
    if (rt) { resetContext(); await refreshTopologySnapshot({ externalChange: true }, rt.session); }
  }, [host, runtimeRef, setCurrentSession]);

  const activateLabTab = useCallback((tab: OpenLabTab, opts?: { skipDisposeCurrent?: boolean; fitView?: boolean }): Promise<void> => {
    // Collapse repeated activations of the same tab into the one in flight.
    if (inflight.current?.tabId === tab.id) return inflight.current.promise;
    const seq = ++activationSeq.current;
    const run = async () => {
      const rt = runtimeRef.current;
      try {
        const previous = sessionIdRef.current;
        if (!opts?.skipDisposeCurrent && previous) {
          setCurrentSession(null);
          try { await host.disposeSession(previous); }
          catch (err) { console.warn("Failed to dispose previous session:", err); }
        }
        const { sessionId: newSid } = await host.createSession(tab.topologyRef.yamlPath);
        if (seq !== activationSeq.current) {
          // A newer activation (or a close) superseded this one while the
          // session was being created — drop it instead of leaking it.
          void host.disposeSession(newSid).catch(() => undefined);
          return;
        }
        // skipDisposeCurrent callers already released the old session; make
        // sure nothing that raced in is left behind.
        const raced = sessionIdRef.current;
        if (raced && raced !== newSid) void host.disposeSession(raced).catch(() => undefined);
        sessionPaths.current.set(newSid, tab.topologyRef.yamlPath);
        setCurrentSession(newSid, tab.topologyRef.yamlPath);
        setActiveTabId(tab.id);
        persistLastOpenLabPath(tab.topologyRef.yamlPath);
        if (rt) {
          // Open every topology view-first. Editing remains one click away via
          // clab-ui's lock button, but an initial click/drag cannot move nodes.
          useTopoViewerStore.setState({ isLocked: true });
          // This app always sets source: "standalone" — the backend's TopologyRef
          // schema types it as a plain string, clab-ui's as a narrower union.
          rt.session.setContext({ sessionId: newSid, topologyRef: tab.topologyRef as ClabTopologyRef, mode: "edit", deploymentState: "undeployed" });
          await refreshTopologySnapshot({ externalChange: true }, rt.session);
          // Units keep the canvas coordinates of the lab they were drawn in, so
          // without a fit the viewport can open miles away from the nodes
          // ("blank canvas"). clab-ui consumes the request once React Flow has
          // the nodes, so firing right after the snapshot refresh is safe.
          if (opts?.fitView) host.emitTopoViewerEvent?.({ type: "fitViewport" });
        }
      } catch (err) { console.error("Failed to activate lab tab:", err); }
    };
    const promise = run().finally(() => {
      if (inflight.current?.promise === promise) inflight.current = null;
    });
    inflight.current = { tabId: tab.id, promise };
    return promise;
  }, [host, runtimeRef, setCurrentSession]);

  const handleOpenLab = useCallback(async (topoRef: TopologyRef, opts?: { fitView?: boolean }) => {
    const tab = resolveOpenLabTab(topoRef);
    setOpenTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === tab.id);
      if (idx >= 0) { const next = [...cur]; next[idx] = tab; return next; }
      return [...cur, tab];
    });
    await activateLabTab(tab, { fitView: opts?.fitView });
  }, [activateLabTab]);

  const handleActivateLabTab = useCallback(async (tabId: string) => {
    const tab = openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    if (tab.kind === "file") return;
    if (activeTabId === tabId && sessionId) return;
    await activateLabTab(tab);
  }, [activeTabId, activateLabTab, openTabs, sessionId]);

  const handleCloseLab = useCallback(async (tabId?: string) => {
    const targetId = tabId ?? activeTabId;
    if (!targetId) return;
    const idx = openTabs.findIndex((t) => t.id === targetId);
    if (idx < 0) return;
    const nextTabs = openTabs.filter((t) => t.id !== targetId);
    const wasActive = activeTabId === targetId;
    setOpenTabs(nextTabs);
    if (!wasActive) return;
    const closedTab = openTabs[idx];
    const nextActive = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
    if (closedTab?.kind === "topology") await clearActiveLabSession();
    if (!nextActive) { setActiveTabId(null); persistLastOpenLabPath(null); return; }
    setActiveTabId(nextActive.id);
    if (nextActive.kind === "topology") await activateLabTab(nextActive, { skipDisposeCurrent: true });
  }, [activeTabId, activateLabTab, clearActiveLabSession, openTabs]);

  const handleOpenFileTab = useCallback(async (input: { endpointId: string; path: string; title?: string }) => {
    const tabId = buildFileTabId(input.endpointId, input.path);
    const existing = openTabs.find((t): t is OpenFileTab => t.kind === "file" && t.id === tabId);
    if (existing) { setActiveTabId(existing.id); return; }
    try {
      const res = await fetch(
        `${getApiBase()}/api/runtime/file-explorer/file?path=${encodeURIComponent(input.path)}`,
        { headers: { "x-endpoint-id": input.endpointId } }
      );
      if (!res.ok) throw new Error(await res.text());
      const doc = await res.json();
      const content = String(doc?.content ?? "");
      const tab: OpenFileTab = {
        kind: "file", id: tabId,
        title: input.title?.trim() || input.path.split("/").pop() || "File",
        subtitle: "Local workspace",
        path: input.path, endpointId: input.endpointId,
        content, originalContent: content, saving: false
      };
      setOpenTabs((cur) => [...cur, tab]);
      setActiveTabId(tab.id);
    } catch (err) { addToast(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`, "error"); }
  }, [addToast, openTabs]);

  const handleFileTabChange = useCallback((tabId: string, content: string) => {
    setOpenTabs((cur) => cur.map((t) => t.kind === "file" && t.id === tabId ? { ...t, content } : t));
  }, []);

  const handleFileTabSave = useCallback(async (tabId: string) => {
    const fileTab = openTabs.find((t): t is OpenFileTab => t.kind === "file" && t.id === tabId);
    if (!fileTab || fileTab.saving) return;
    setOpenTabs((cur) => cur.map((t) => t.kind === "file" && t.id === tabId ? { ...t, saving: true, error: undefined } : t));
    try {
      const res = await fetch(
        `${getApiBase()}/api/runtime/file-explorer/file?path=${encodeURIComponent(fileTab.path)}`,
        { method: "PUT", headers: { "Content-Type": "application/json", "x-endpoint-id": fileTab.endpointId }, body: JSON.stringify({ path: fileTab.path, content: fileTab.content }) }
      );
      if (!res.ok) throw new Error(await res.text());
      setOpenTabs((cur) => cur.map((t) => t.kind === "file" && t.id === tabId ? { ...t, originalContent: t.content, saving: false, error: undefined, staleOnDisk: false, diskContent: undefined } : t));
      addToast(`Saved ${fileTab.path}`, "success");
      void fetchFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenTabs((cur) => cur.map((t) => t.kind === "file" && t.id === tabId ? { ...t, saving: false, error: msg } : t));
      addToast(`Failed to save file: ${msg}`, "error");
    }
  }, [addToast, fetchFiles, openTabs]);

  const refreshOpenFiles = useCallback(async (targetPath?: string) => {
    const fileTabs = openTabs.filter(
      (t): t is OpenFileTab =>
        t.kind === "file" &&
        (!targetPath || t.path === targetPath || t.path.endsWith(targetPath))
    );
    if (fileTabs.length === 0) return;

    for (const tab of fileTabs) {
      try {
        const res = await fetch(
          `${getApiBase()}/api/runtime/file-explorer/file?path=${encodeURIComponent(tab.path)}`,
          { headers: { "x-endpoint-id": tab.endpointId } }
        );
        if (!res.ok) continue;
        const doc = await res.json();
        const nextContent = String(doc?.content ?? "");
        setOpenTabs((cur) =>
          cur.map((t) => {
            if (t.kind !== "file" || t.id !== tab.id) return t;
            // A clean tab has no edits to protect — reload it in place.
            if (t.content === t.originalContent) {
              return { ...t, content: nextContent, originalContent: nextContent, staleOnDisk: false, diskContent: undefined, error: undefined };
            }
            // A dirty tab keeps the user's edits. If the disk copy diverged from
            // the base we loaded, flag it stale (and stash the newer content) so
            // the editor can offer a manual reload instead of silently going out
            // of date. If disk still matches our base, there's nothing new.
            if (nextContent !== t.originalContent) {
              return { ...t, staleOnDisk: true, diskContent: nextContent };
            }
            return { ...t, staleOnDisk: false, diskContent: undefined };
          })
        );
      } catch (err) {
        console.warn(`Failed to refresh open file ${tab.path}:`, err);
      }
    }
  }, [openTabs]);

  // Explicit user opt-in: replace unsaved edits with the newer disk content
  // surfaced by the stale-on-disk indicator.
  const handleFileTabReload = useCallback((tabId: string) => {
    setOpenTabs((cur) =>
      cur.map((t) => {
        if (t.kind !== "file" || t.id !== tabId || t.diskContent === undefined) return t;
        return { ...t, content: t.diskContent, originalContent: t.diskContent, staleOnDisk: false, diskContent: undefined, error: undefined };
      })
    );
  }, []);

  // Session for an action on `topoRef`: the active tab's session when it is
  // that topology, otherwise a reusable background session. Never falls back
  // to "whatever is open" — that would run e.g. Destroy on the wrong lab.
  const getOrCreateSession = useCallback(async (topoRef: TopologyRef): Promise<string | null> => {
    if (sessionIdRef.current && activePathRef.current === topoRef.yamlPath) return sessionIdRef.current;
    const key = topoRef.yamlPath;
    let pending = helperSessions.current.get(key);
    if (!pending) {
      pending = host.createSession(key).then((r) => { sessionPaths.current.set(r.sessionId, key); return r.sessionId; });
      helperSessions.current.set(key, pending);
      pending.catch(() => helperSessions.current.delete(key));
    }
    try { return await pending; }
    catch (err) { console.error("Failed to get/create session:", err); return null; }
  }, [host]);

  /** Topology path a session was opened for (null for unknown ids). */
  const topologyPathForSession = useCallback((sid: string): string | null => sessionPaths.current.get(sid) ?? null, []);

  const handleCreateLab = useCallback(async (labName: string) => {
    try {
      if (host.createLab) {
        const data = await host.createLab(labName);
        await fetchFiles(); await handleOpenLab(data.topologyRef); return;
      }
      const res = await fetch(`${getApiBase()}/api/lab/new`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: labName })
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); addToast(`Failed to create lab: ${err.detail || res.statusText}`, "error"); return; }
      const data = await res.json();
      await fetchFiles(); await handleOpenLab(data.topologyRef);
    } catch (err) { addToast(`Failed to create lab: ${err}`, "error"); }
  }, [addToast, fetchFiles, handleOpenLab, host]);

  const restoreTabSession = useCallback(async (saved: PersistedTabSession | null) => {
    if (restoreComplete) return;
    const tabs: OpenTab[] = (saved?.tabs ?? []).map((tab) =>
      tab.kind === "file"
        ? { ...tab, saving: false }
        : tab
    );
    setOpenTabs(tabs);

    const requestedActive = tabs.find((tab) => tab.id === saved?.activeTabId) ?? tabs[0] ?? null;
    if (!requestedActive) {
      setRestoreComplete(true);
      return;
    }

    setActiveTabId(requestedActive.id);
    if (requestedActive.kind === "topology") {
      await activateLabTab(requestedActive, { skipDisposeCurrent: true });
    }
    setRestoreComplete(true);
  }, [activateLabTab, restoreComplete]);

  useEffect(() => {
    if (!restoreComplete) return;
    persistOpenTabSession({
      activeTabId,
      tabs: openTabs.map((tab) =>
        tab.kind === "file"
          ? {
              kind: tab.kind,
              id: tab.id,
              title: tab.title,
              subtitle: tab.subtitle,
              path: tab.path,
              endpointId: tab.endpointId,
              content: tab.content,
              originalContent: tab.originalContent
            }
          : tab
      )
    });
  }, [activeTabId, openTabs, restoreComplete]);

  const activeFileTab = openTabs.find((t): t is OpenFileTab => t.kind === "file" && t.id === activeTabId) ?? null;

  return {
    sessionId, openTabs, activeTabId, activeFileTab,
    activateLabTab, handleOpenLab, handleActivateLabTab, handleCloseLab,
    handleOpenFileTab, handleFileTabChange, handleFileTabSave, handleFileTabReload, refreshOpenFiles,
    handleCreateLab, getOrCreateSession, topologyPathForSession, restoreTabSession, restoreComplete
  };
}
