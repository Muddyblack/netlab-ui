import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { useTopoViewerStore } from "@srl-labs/clab-ui";
import { refreshTopologySnapshot } from "@srl-labs/clab-ui/session";
import type { ClabUiRuntime } from "@srl-labs/clab-ui/host";
import type { TopologyRef as ClabTopologyRef } from "@srl-labs/clab-ui/session";
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

  useEffect(() => () => { if (sessionId) void host.disposeSession(sessionId); }, [host, sessionId]);

  const clearActiveLabSession = useCallback(async () => {
    const rt = runtimeRef.current;
    const resetContext = () => rt?.session.setContext({ sessionId: undefined, topologyRef: undefined, mode: "view", deploymentState: "unknown" });

    if (!sessionId) {
      host.sessionId = null;
      if (rt) { resetContext(); await refreshTopologySnapshot({ externalChange: true }, rt.session); }
      return;
    }
    try { await host.disposeSession(sessionId); } catch (err) { console.warn("Failed to dispose session:", err); }
    finally {
      host.sessionId = null;
      setSessionId(null);
      if (rt) { resetContext(); await refreshTopologySnapshot({ externalChange: true }, rt.session); }
    }
  }, [host, runtimeRef, sessionId]);

  const activateLabTab = useCallback(async (tab: OpenLabTab, opts?: { skipDisposeCurrent?: boolean; fitView?: boolean }) => {
    const rt = runtimeRef.current;
    try {
      if (!opts?.skipDisposeCurrent && sessionId) {
        try { await host.disposeSession(sessionId); }
        catch (err) { console.warn("Failed to dispose previous session:", err); host.sessionId = null; }
      }
      const { sessionId: newSid } = await host.createSession(tab.topologyRef.yamlPath);
      host.sessionId = newSid;
      setSessionId(newSid);
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
  }, [host, runtimeRef, sessionId]);

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

  const getOrCreateSession = useCallback(async (topoRef: TopologyRef): Promise<string | null> => {
    try { return (await host.createSession(topoRef.yamlPath)).sessionId; }
    catch (err) { console.error("Failed to get/create session:", err); return null; }
  }, [host]);

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
    handleCreateLab, getOrCreateSession, restoreTabSession, restoreComplete
  };
}
