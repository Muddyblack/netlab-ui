import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsLocked, useNodes, useTopoViewerActions } from "@srl-labs/clab-ui";
import {
  createClabUiRuntime,
  type ClabUiRuntime,
  type HostRuntimeContainer,
  type TopologyUiContext,
  type TopologyUiRequestOptions,
} from "@srl-labs/clab-ui/host";
import {
  applyRuntimeEdgeStatsToGraph,
  executeTopologyCommand,
  refreshTopologySnapshot,
  type TopologySessionClient,
  type TopologySnapshot,
} from "@srl-labs/clab-ui/session";
import { createApiClabUiHost, type AppClabUiHost } from "../host/createHost";
import { createDemoClabUiHost } from "../host/createDemoHost";
import { type DeploymentProgress } from "../components/CanvasDeploymentProgress";
import { api, HttpError, type AssistantCapabilities, type DeployDiffResult, type NetlabProjection } from "../api/client";
import { DEMO_MODE, defaultRuntimeSnackbar, type OpenLabTab, type RuntimeSnackbarState, type WorkspaceEntry } from "../lifecycle/types";
import { readLastOpenLabPath, readOpenTabSession, resolveOpenLabTab } from "../lifecycle/persistence";
import { persistAssistantOpen, readAssistantOpen } from "../panels/assistant/preferences";
import { type SettingsTab } from "../components/dialogs/SettingsDialog";

import {
  useAppData,
  usePortalInjection,
  useDeployLogCopyButton,
  useTabManager,
  useLabLifecycle,
  type ValidationIssue,
  useExplorerController,
  type ExplorerIncomingMessage,
  useSessionDock,
  type SessionTab,
  useBrowserNotifications,
  useNetlabLenses,
  useRightPanelTabMemory,
  useAutoOpenComposerTab,
  netlabNodeEditorTabs,
  useCustomPaletteTabs,
  useRenderDeployMenuItems,
} from "./appControllerDeps";

type Toast = (message: string, severity?: RuntimeSnackbarState["severity"]) => void;

async function openLabGraphPopup(sid: string, layout: "interactive" | "horizontal" | "vertical", addToast: Toast) {
  const popup = window.open("", "_blank");
  try {
    const result = await api.labGraph(sid, layout);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `netlab graph exited ${result.code}`);
    const blobUrl = URL.createObjectURL(new Blob([result.stdout], { type: "image/svg+xml" }));
    if (popup) popup.location.href = blobUrl;
    else window.open(blobUrl, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    popup?.close();
    addToast(`Could not create graph: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

// Real draw.io/mxGraph XML (containerlab --drawio, via clab-io-draw) - unlike
// the SVG graph above, browsers can't render this inline, so it downloads as
// a .drawio file for opening in the draw.io app instead.
async function exportDrawioDownload(sid: string, layout: "horizontal" | "vertical", addToast: Toast) {
  try {
    const result = await api.labGraphDrawio(sid, layout);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `containerlab graph --drawio exited ${result.code}`);
    const blobUrl = URL.createObjectURL(new Blob([result.stdout], { type: "application/xml" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = "topology.drawio";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    addToast("Downloaded topology.drawio", "success");
  } catch (err) {
    addToast(`Could not export draw.io diagram: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

type InspectOutputState = { loading: boolean; output: string | null; error: string | null } | null;

async function inspectLabAndSet(sid: string, setInspectOutput: (value: InspectOutputState) => void) {
  setInspectOutput({ loading: true, output: null, error: null });
  try {
    const result = await api.labInspect(sid);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `netlab inspect exited ${result.code}`);
    setInspectOutput({ loading: false, output: result.stdout, error: null });
  } catch (err) {
    setInspectOutput({ loading: false, output: null, error: err instanceof Error ? err.message : String(err) });
  }
}

async function runFcliPopup(sid: string, command: string, addToast: Toast) {
  const popup = window.open("", "_blank");
  try {
    const result = await api.labFcli(sid, command);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `fcli exited ${result.code}`);
    const blobUrl = URL.createObjectURL(new Blob([result.stdout], { type: "text/plain;charset=utf-8" }));
    if (popup) popup.location.href = blobUrl;
    else window.open(blobUrl, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    popup?.close();
    addToast(`Could not run fcli ${command}: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

function installEdgesharkAction(addToast: Toast) {
  addToast("Installing Edgeshark on the docker host — first install pulls images and can take a few minutes…", "info");
  api.installEdgeshark().then(
    () => addToast("Edgeshark is installed and running — packet capture is ready", "success"),
    (err) => addToast(`Edgeshark install failed: ${err instanceof Error ? err.message : String(err)}`, "error")
  );
}

function uninstallEdgesharkAction(addToast: Toast) {
  api.uninstallEdgeshark().then(
    () => addToast("Edgeshark removed", "success"),
    (err) => addToast(`Edgeshark uninstall failed: ${err instanceof Error ? err.message : String(err)}`, "error")
  );
}

function killAllWiresharkVncAction(addToast: Toast) {
  api.killAllWiresharkVnc().then(
    (result) => addToast(result.message, "success"),
    (err) => addToast(`Could not remove Wireshark containers: ${err instanceof Error ? err.message : String(err)}`, "error")
  );
}

// netlab reports transform failures as a block: a generic header, one line per
// offending node/link, then a "Fatal error" trailer. A toast only has room for
// one line, so skip the header/trailer noise and lead with the first line that
// actually names a cause, counting the rest so nothing looks hidden.
function firstLine(error: string): string {
  const lines = error
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^errors? encountered\b/i.test(line) && !/^fatal error in netlab\b/i.test(line));
  if (lines.length === 0) return error.trim().split("\n")[0] ?? "";
  return lines.length > 1 ? `${lines[0]} (+${lines.length - 1} more)` : lines[0];
}

export function useAppController() {
  const canvasNodes = useNodes();
  const canvasNodesRef = useRef(canvasNodes);
  canvasNodesRef.current = canvasNodes;
  const isTopologyLocked = useIsLocked();
  const topoViewerActions = useTopoViewerActions();
  // ── Dialog open states ───────────────────────────────────────────────────────
  const [imageManagerOpen, setImageManagerOpen] = useState(false);
  const [runningLabsOpen, setRunningLabsOpen] = useState(false);
  const [inspectOutput, setInspectOutput] = useState<{ loading: boolean; output: string | null; error: string | null } | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<string | undefined>(undefined);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [exampleLabsOpen, setExampleLabsOpen] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [newLabDialogOpen, setNewLabDialogOpen] = useState(false);
  const [multiserverEnabled, setMultiserverEnabled] = useState(false);
  // Null until probed, and stays null when the optional assistant backend
  // isn't installed — which is what keeps the Chat button out of the toolbar.
  const [assistantCapabilities, setAssistantCapabilities] = useState<AssistantCapabilities | null>(null);
  // The assistant is a floating overlay toggled from the toolbar, not a tab
  // in the Nodes/Groups/Plugins strip — a conversation shouldn't get swapped
  // out just because the user switches what they're looking at on the canvas.
  const [assistantOpen, setAssistantOpen] = useState(() => readAssistantOpen());
  const [assistantSettingsProviderId, setAssistantSettingsProviderId] = useState<string>();
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [deploymentProgress, setDeploymentProgress] = useState<DeploymentProgress | null>(null);
  const deploymentProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deployDiff, setDeployDiff] = useState<DeployDiffResult | null>(null);
  const [deployValidationIssues, setDeployValidationIssues] = useState<ValidationIssue[]>([]);
  const deployDecisionRef = useRef<((proceed: boolean) => void) | null>(null);

  useEffect(() => {
    persistAssistantOpen(assistantOpen);
  }, [assistantOpen]);

  // ── Left sidebar toggle ──────────────────────────────────────────────────────
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const handleToggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarOpen(prev => !prev);
  }, []);

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [runtimeSnackbar, setRuntimeSnackbar] = useState<RuntimeSnackbarState>(defaultRuntimeSnackbar);
  const addToast = useCallback((message: string, severity: RuntimeSnackbarState["severity"] = "info") => {
    setRuntimeSnackbar({ open: true, message, severity });
  }, []);
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const {
    supported: notificationsSupported,
    enabled: notificationsEnabled,
    permission: notificationPermission,
    toggle: toggleNotifications,
    notify: sendSystemNotification,
  } = useBrowserNotifications(addToast);

  // ── Stable refs for cross-hook wiring ────────────────────────────────────────
  const hostRef = useRef<AppClabUiHost | null>(null);
  const runtimeRef = useRef<ClabUiRuntime | null>(null);
  const runtimeSessionRef = useRef<TopologySessionClient | null>(null);
  const refreshCanvasRef = useRef<() => void>(() => { });
  const explorerSubscribers = useRef<Set<(msg: ExplorerIncomingMessage) => void>>(new Set());
  const tabRestoreAttemptedRef = useRef(false);

  // ── Hooks ────────────────────────────────────────────────────────────────────
  const handlePluginPanelChangedRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // Assigned in the transform-tracking block below, which is declared after
  // useAppData needs it.
  const handleTransformDoneRef = useRef<() => void>(() => { });
  // Assigned once the lenses hook exists, further down.
  const invalidateLensesRef = useRef<() => void>(() => { });

  const {
    startup, checkStartup,
    themeMode, handleThemeChange,
    labFiles, runningLabsStatus,
    workspaces, setWorkspaces,
    fetchFiles, refreshStatus,
    yamlSchema
  } = useAppData({
    hostRef,
    onFilesChanged: useCallback(() => {
      void handlePluginPanelChangedRef.current();
    }, []),
    onTransformDone: useCallback(() => {
      handleTransformDoneRef.current();
    }, []),
  });

  const { portalContainer, navbarPortalContainer, tabBarContainer, leftSidebarToggleContainer, netlabLinksPaletteContainer } = usePortalInjection();

  // Drop a "Copy" button into clab-ui's vendored deploy-progress modal.
  useDeployLogCopyButton();

  // Sync left sidebar open/closed state to the DOM.
  // Matches the structural selector used in usePortalInjection (no data-testid needed in clab-ui).
  useEffect(() => {
    const app = document.querySelector<HTMLElement>('[data-testid="topoviewer-app"]');
    const layoutRow = app?.children[1] as HTMLElement | undefined;
    const pane = layoutRow?.firstElementChild as HTMLElement | null;
    if (!pane) return;

    pane.style.transition = [
      "width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
      "min-width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
      "max-width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
      "border-color 250ms cubic-bezier(0.4, 0, 0.2, 1)"
    ].join(", ");

    if (isLeftSidebarOpen) {
      pane.style.width = "";
      pane.style.minWidth = "";
      pane.style.maxWidth = "";
      pane.style.borderRightWidth = "";
      pane.style.pointerEvents = "";
    } else {
      pane.style.width = "0px";
      pane.style.minWidth = "0px";
      pane.style.maxWidth = "0px";
      pane.style.borderRightWidth = "0px";
      pane.style.pointerEvents = "none";
    }
  }, [isLeftSidebarOpen]);

  // Stable data refs consumed by the explorer controller (avoids rebuilding controller on every render)
  const labFilesRef = useRef(labFiles); labFilesRef.current = labFiles;
  const runningLabsStatusRef = useRef(runningLabsStatus); runningLabsStatusRef.current = runningLabsStatus;
  const workspacesRef = useRef(workspaces); workspacesRef.current = workspaces;

  // ── Explorer bridge (must be created before host) ────────────────────────────
  const { explorerBridge } = useExplorerController({
    explorerSubscribers, labFilesRef, runningLabsStatusRef, workspacesRef,
    labFiles, runningLabsStatus, workspaces,
    callbacks: {
      openLab: (topoRef) => handleOpenLabRef.current(topoRef),
      openFileTab: (input) => handleOpenFileTabRef.current(input),
      getOrCreateSession: (topoRef) => getOrCreateSessionRef.current(topoRef),
      deployLab: (sid) => handleDeployLabRef.current(sid),
      destroyLab: (sid) => handleDestroyLabRef.current(sid),
      netlabInitial: (sid) => handleNetlabInitialRef.current(sid),
      netlabCreateConfigs: (sid) => handleNetlabCreateConfigsRef.current(sid),
      netlabRestart: (sid) => handleNetlabRestartRef.current(sid),
      netlabValidate: (sid) => handleNetlabValidateRef.current(sid),
      netlabCollect: (sid) => handleNetlabCollectRef.current(sid),
      openNewLabDialog: () => setNewLabDialogOpen(true),
      openCloneDialog: (target?: string) => { setCloneTarget(target); setCloneOpen(true); },
      openAddWorkspace: () => setFolderBrowserOpen(true),
      openExampleLabs: () => setExampleLabsOpen(true),
      newFolder: (parentPath) => setNewFolderParent(parentPath),
      removeWorkspace: async (path) => {
        const r = await api.removeWorkspace(path);
        setWorkspaces(r.workspaces as WorkspaceEntry[]);
        void fetchFiles();
      },
      openImageManager: () => setImageManagerOpen(true),
      openRunningLabs: () => setRunningLabsOpen(true),
      openLabGraph: (sid, layout) => openLabGraphPopup(sid, layout, addToast),
      exportDrawio: (sid, layout) => exportDrawioDownload(sid, layout, addToast),
      inspectLab: (sid) => inspectLabAndSet(sid, setInspectOutput),
      runFcli: (sid, command) => runFcliPopup(sid, command, addToast),
      openShell: (n) => openShellRef.current(n),
      showLogs: (n) => openLogsRef.current(n),
      openDrawioWizard: () => openDrawioWizardRef.current(),
      nodeLifecycle: (n, action) => handleNodeLifecycleRef.current(n, action),
      installEdgeshark: () => installEdgesharkAction(addToast),
      uninstallEdgeshark: () => uninstallEdgesharkAction(addToast),
      killAllWiresharkVNC: () => killAllWiresharkVncAction(addToast),
      addToast,
      getSessionId: () => sessionIdRef.current
    }
  });

  // ── Background netlab transform tracking ────────────────────────────────────
  // A snapshot arrives immediately while `netlab create` warms the projection
  // cache in the background (`projection.pending`). The backend already blends
  // that interim snapshot over the last real projection, so the canvas is
  // correct the whole time — all that's left here is to pick the finished
  // projection up. `onTransformDone` (a backend push event) is the primary
  // signal; the timer below is only a backstop for a dropped SSE stream, so it
  // backs off instead of hammering a fixed interval, and gives up rather than
  // re-requesting forever if `projection.pending` never clears.
  //
  // Progress is shown as a quiet inline pill (see TransformIndicator), not as
  // toasts — this state recurs on every edit, so a notification per transform
  // was pure noise. Toasts are kept for failures only, which are the one
  // outcome the user has to act on. `reportedError` dedupes those: the snapshot
  // is re-requested on every canvas interaction and keeps reporting the same
  // failure until the YAML is edited, which would otherwise bury the screen in
  // identical toasts.
  const TRANSFORM_POLL_CAP_MS = 5000;
  const TRANSFORM_POLL_ATTEMPTS = 15;
  const [transformRunning, setTransformRunning] = useState(false);
  const transformPollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: boolean; attempts: number; reportedError: string | null }>({ timer: null, pending: false, attempts: 0, reportedError: null });

  const clearTransformPoll = useCallback(() => {
    const state = transformPollRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.pending = false;
    state.attempts = 0;
    setTransformRunning(false);
  }, []);

  // netlab-specific field the backend adds to its snapshot response — not part
  // of clab-ui's own TopologySnapshot type. `source` says what the nodes/edges
  // actually are ("clab" is the real transform; the *-preview values say why
  // they are only an approximation).
  const handleTransformPendingRef = useRef<(snap: TopologySnapshot & { projection?: NetlabProjection }) => void>(() => { });
  handleTransformPendingRef.current = (snap) => {
    const state = transformPollRef.current;
    if (snap?.projection?.pending) {
      state.pending = true;
      setTransformRunning(true);
      if (!state.timer) {
        if (state.attempts >= TRANSFORM_POLL_ATTEMPTS) {
          clearTransformPoll();
          addToast("netlab is taking unusually long to transform this topology — reload to retry.", "error");
          return;
        }
        const delay = Math.min(750 * 2 ** state.attempts, TRANSFORM_POLL_CAP_MS);
        state.attempts += 1;
        state.timer = setTimeout(() => {
          state.timer = null;
          refreshCanvasRef.current();
        }, delay);
      }
      return;
    }
    clearTransformPoll();
    // A failed transform also clears `pending`, so the error is what tells the
    // user the canvas is showing an approximate preview rather than the real
    // transform.
    const error = snap?.projection?.error ?? null;
    if (error) {
      if (state.reportedError !== error) {
        state.reportedError = error;
        addToast(`netlab could not transform this topology — the canvas is showing an approximate preview. ${firstLine(error)}`, "error");
      }
      return;
    }
    state.reportedError = null;
  };

  // Backend push: a `netlab create` finished somewhere. Only refresh if this
  // canvas is actually waiting on one — the event carries no session identity,
  // and refreshing on an unrelated lab's transform would be wasted work.
  handleTransformDoneRef.current = () => {
    // Unconditional: a completed transform means the transformed topology the
    // lenses analyse has changed, whether or not this canvas was waiting on it.
    // The hook defers the actual refetch until a lens is on screen.
    invalidateLensesRef.current();
    const state = transformPollRef.current;
    if (!state.pending) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    refreshCanvasRef.current();
  };

  // ── Host + runtime ───────────────────────────────────────────────────────────
  const host = useMemo(() => {
    const base = DEMO_MODE
      ? createDemoClabUiHost({ explorer: explorerBridge, meta: { isDevMock: true } })
      : createApiClabUiHost({
          explorer: explorerBridge,
          meta: { isDevMock: true },
          onError: (message) => addToastRef.current(message, "error"),
        });
    // Override snapshot fetching *in place* so we keep `base`'s object identity.
    // The host's internal topoViewer dispatchers (onNodeAction)
    // read those callbacks off this exact object, so wrapping it in a new object
    // would silently drop handlers set on `host` later (canvas drops did nothing).
    const origTopology = base.topology;
    base.topology = {
      ...origTopology,
      requestSnapshot: async (ctx: TopologyUiContext, opts?: TopologyUiRequestOptions) => {
        if (!ctx.sessionId) {
          return { revision: 0, nodes: [], edges: [], annotations: {}, yamlFileName: "", annotationsFileName: "", yamlContent: "", annotationsContent: "", labName: "", mode: "view" as const, deploymentState: "unknown" as const, canUndo: false, canRedo: false };
        }
        const snap = await origTopology.requestSnapshot(ctx, opts);
        handleTransformPendingRef.current(snap);
        return snap;
      }
    };
    return base;
  }, [explorerBridge]);
  hostRef.current = host;

  const runtime = useMemo(() => createClabUiRuntime({
    host,
    initialContext: { sessionId: "", mode: "edit", deploymentState: "undeployed" },
    nodeEditorTabs: netlabNodeEditorTabs,
  }), [host]);
  runtimeRef.current = runtime;
  runtimeSessionRef.current = runtime.session;

  const refreshCanvas = useCallback(() => {
    if (runtime?.session) void refreshTopologySnapshot({ externalChange: true }, runtime.session);
  }, [runtime]);
  refreshCanvasRef.current = refreshCanvas;

  // ── Tab + session management ─────────────────────────────────────────────────
  const {
    sessionId, openTabs, activeTabId, activeFileTab,
    activateLabTab, handleOpenLab, handleActivateLabTab, handleCloseLab,
    handleOpenFileTab, handleFileTabChange, handleFileTabSave, handleFileTabReload, refreshOpenFiles,
    handleCreateLab, getOrCreateSession, restoreTabSession
  } = useTabManager({ host, fetchFiles, addToast, runtimeRef });

  // ── Session dock (node shells + log streams) ────────────────────────────────
  const sessionDock = useSessionDock(sessionId);
  const handleSessionPopOut = useCallback((tab: SessionTab) => {
    if (!sessionId) return;
    const params = new URLSearchParams({ popout: tab.kind, node: tab.node, sessionId });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    // Strip the browser chrome (address bar, menu, toolbar) so the pop-out
    // reads as a small app window rather than a second browser tab.
    const win = window.open(url, `netlab-${tab.kind}-${tab.node}`, "width=960,height=640,menubar=no,toolbar=no,location=no,status=no,resizable=yes");
    if (!win) {
      addToast("The browser blocked the pop-out window — allow pop-ups for this site.", "warning");
      return;
    }
    sessionDock.closeTab(tab.key);
  }, [sessionId, sessionDock, addToast]);

  // A conversation outlives the side panel, which gets swapped for
  // Nodes/Groups/Plugins as you work — so it can move to its own window.
  const handleAssistantPopOut = useCallback(() => {
    if (!sessionId) return;
    const params = new URLSearchParams({ popout: "assistant", sessionId });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    const win = window.open(url, "netlab-assistant", "width=560,height=820,menubar=no,toolbar=no,location=no,status=no,resizable=yes");
    if (!win) addToast("The browser blocked the pop-out window — allow pop-ups for this site.", "warning");
  }, [sessionId, addToast]);

  // Owned here (not inside the palette tab) so lens/inspector state survives
  // switching to another dock tab and back.
  const netlabLenses = useNetlabLenses(sessionId ?? "", activeTabId ?? undefined);
  const { applyDeploymentProgress } = netlabLenses;
  invalidateLensesRef.current = netlabLenses.invalidate;
  useRightPanelTabMemory();

  // When the tab open on the canvas is a unit file (lives in a `units/` dir),
  // a "Composer" tab joins clab-ui's native palette (Nodes/Groups/Plugins/…)
  // so composition can be edited in place, in the same drawer instead of a
  // second panel competing with it. Plain labs never trigger it.
  const activeUnitPath = useMemo(() => {
    const tab = openTabs.find((t) => t.id === activeTabId && t.kind === "topology");
    const path = tab?.kind === "topology" ? tab.topologyRef?.yamlPath : undefined;
    return path && /(^|\/)units\/[^/]+\.ya?ml$/i.test(path) ? path : null;
  }, [openTabs, activeTabId]);
  useAutoOpenComposerTab(activeUnitPath);

  const handleLifecycleFinished = useCallback((result: {
    label: string;
    success: boolean;
    errorMessage?: string;
  }) => {
    const activeTab = openTabs.find((tab) => tab.id === activeTabId && tab.kind === "topology");
    const labName = activeTab?.kind === "topology" ? activeTab.topologyRef?.labName : undefined;
    const subject = labName ? `${result.label} · ${labName}` : result.label;
    if (result.success) {
      addToast(`${subject} completed`, "success");
      sendSystemNotification("netlab job completed", subject, `netlab-job-${result.label}`);
    } else {
      const detail = result.errorMessage || `${result.label} failed`;
      addToast(`${subject} failed: ${detail}`, "error");
      sendSystemNotification("netlab job failed", `${subject}\n${detail}`, `netlab-job-${result.label}`);
    }
  }, [activeTabId, addToast, openTabs, sendSystemNotification]);

  const requestDeployApproval = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    try {
      const [validation, diff] = await Promise.all([
        api.labPreflight(sessionId),
        api.getDeployDiff(sessionId)
      ]);
      const issues = validation.issues as ValidationIssue[];
      setValidationIssues(issues);
      setDeployValidationIssues(issues);
      refreshCanvas();
      setDeployDiff(diff);
      // clab-ui opens its lifecycle progress modal before calling the host.
      // Hide that modal while the preflight review is awaiting a decision;
      // otherwise the review dialog sits behind it and deployment appears to
      // hang forever at "Waiting for command output".
      topoViewerActions.closeLifecycleModal();
      const proceed = await new Promise<boolean>((resolve) => {
        deployDecisionRef.current = resolve;
      });
      topoViewerActions.setProcessing(proceed, proceed ? "deploy" : undefined);
      return proceed;
    } catch (err) {
      addToast(`Could not prepare deploy review: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    }
  }, [addToast, refreshCanvas, sessionId, topoViewerActions]);

  const handleDeploymentProgress = useCallback((progress: DeploymentProgress) => {
    if (deploymentProgressTimerRef.current) clearTimeout(deploymentProgressTimerRef.current);
    setDeploymentProgress((current) => {
      const sameRun = Boolean(current && current.startedAt === progress.startedAt && current.action === progress.action);
      return { ...progress, nodes: sameRun && current ? { ...current.nodes, ...progress.nodes } : progress.nodes };
    });
    applyDeploymentProgress(progress);
    if (progress.done) {
      deploymentProgressTimerRef.current = setTimeout(() => setDeploymentProgress(null), 4000);
    }
  }, [applyDeploymentProgress]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      // Ctrl/Cmd+I toggles the AI assistant. Skip it while the user is typing
      // so it never fights a text field's own shortcuts.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "i") {
        const target = event.target as HTMLElement | null;
        const editable =
          target?.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
        if (editable) return;
        event.preventDefault();
        setAssistantOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Lab lifecycle commands ───────────────────────────────────────────────────
  const {
    handleDeployLab, handleDestroyLab,
    handleNetlabInitial, handleNetlabCreateConfigs, handleNetlabRestart,
    handleNetlabValidate, handleNetlabCollect
  } = useLabLifecycle({
    host,
    fetchFiles,
    refreshStatus,
    refreshCanvas,
    onValidationIssues: setValidationIssues,
    beforeDeploy: requestDeployApproval,
    onDeploymentProgress: handleDeploymentProgress,
    onLifecycleFinished: handleLifecycleFinished
  });

  const handleRerunDeployment = useCallback((action: string) => {
    if (!sessionId) return;
    if (action === "up") void handleDeployLab(sessionId);
    else if (action === "down") void handleDestroyLab(sessionId);
    else if (action === "initial") void handleNetlabInitial(sessionId);
    else if (action === "create-configs") void handleNetlabCreateConfigs(sessionId);
    else if (action === "restart") void handleNetlabRestart(sessionId);
    else addToast(`Cannot rerun unsupported deployment action: ${action}`, "warning");
  }, [addToast, handleDeployLab, handleDestroyLab, handleNetlabCreateConfigs, handleNetlabInitial, handleNetlabRestart, sessionId]);

  const quickActions = useMemo(() => [
    { id: "action:toggle-assistant", label: assistantOpen ? "Hide AI assistant" : "Open AI assistant", detail: "Toggle the assistant panel · Ctrl+I", run: () => setAssistantOpen((open) => !open) },
    { id: "action:new-lab", label: "Create a new lab", detail: "Start a topology in the current workspace", run: () => setNewLabDialogOpen(true) },
    { id: "action:image-manager", label: "Manage container images", detail: "Open the image manager", run: () => setImageManagerOpen(true) },
    { id: "action:fit", label: "Fit topology to canvas", detail: "Center and zoom to all nodes", run: () => host.emitTopoViewerEvent?.({ type: "fitViewport" }) },
    { id: "action:group", label: "Group selected canvas nodes", detail: "Same as Ctrl+G", run: () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "g", code: "KeyG", ctrlKey: true, bubbles: true })) },
    ...(sessionId && !isTopologyLocked ? [{
      id: "action:add-node",
      label: "Add a node",
      detail: "Create a new node at the canvas origin",
      run: () => {
        const used = new Set(canvasNodes.map((node) => node.id));
        let index = 1;
        while (used.has(`node${index}`)) index += 1;
        const id = `node${index}`;
        void executeTopologyCommand({ command: "addNode", payload: { id, name: id, position: { x: 0, y: 0 } } }, undefined, runtime.session)
          .then(() => {
            host.emitTopoViewerEvent?.({ type: "fitViewport" });
            topoViewerActions.selectNode(id);
            topoViewerActions.editNode(id);
          });
      }
    }] : []),
    ...(sessionId ? [
      { id: "action:validate", label: "Validate topology", detail: "Run netlab validate", run: () => void handleNetlabValidate(sessionId) },
      { id: "action:create-config", label: "Generate netlab configuration", detail: "Run netlab create", run: () => void handleNetlabCreateConfigs(sessionId) }
    ] : [])
  ], [assistantOpen, canvasNodes, handleNetlabCreateConfigs, handleNetlabValidate, host, isTopologyLocked, runtime.session, sessionId, topoViewerActions]);

  useEffect(() => {
    setValidationIssues([]);
    setDeployDiff(null);
    setDeployValidationIssues([]);
    deployDecisionRef.current?.(false);
    deployDecisionRef.current = null;
  }, [sessionId]);

  // Per-node container lifecycle: containerlab 0.77+ reconciles links via
  // `clab apply` after a start/restart (the backend runs it when available),
  // so individual node toggles are safe to expose.
  const handleNodeLifecycle = useCallback((nodeName: string, action: "start" | "stop" | "restart" | "pause" | "unpause" | "save") => {
    if (!sessionId) return;
    addToast(`Running ${action} on ${nodeName}…`, "info");
    void api.nodeAction(sessionId, nodeName, action)
      .then((res) => {
        if (res.code !== 0) addToast(`Node ${nodeName}: ${action} failed — ${res.stderr || res.stdout || `exit ${res.code}`}`, "error");
        // A zero exit with stderr is a success with a caveat (e.g. links not
        // reconciled on containerlab < 0.77) — surface it, don't swallow it.
        else if (res.stderr) addToast(`Node ${nodeName}: ${res.stderr}`, "warning");
        else addToast(`Node ${nodeName}: ${action} finished`, "success");
      })
      .catch((err: unknown) => addToast(`Node ${nodeName}: ${action} failed — ${String(err)}`, "error"))
      .finally(() => { void refreshStatus(); refreshCanvasRef.current(); });
  }, [sessionId, addToast, refreshStatus]);

  // Node shell action wiring
  React.useEffect(() => {
    host.onNodeAction = (action: string, nodeName: string) => {
      if (action === "shell" || action === "ssh") sessionDock.openTab("shell", nodeName);
      if (action === "logs") sessionDock.openTab("logs", nodeName);
      if (action === "start" || action === "stop" || action === "restart") {
        handleNodeLifecycle(nodeName, action);
      }
    };
    return () => { host.onNodeAction = undefined; };
  }, [host, sessionDock, handleNodeLifecycle]);

  useEffect(() => {
    host.onBeforeDeploy = requestDeployApproval;
    host.onDeploymentProgress = handleDeploymentProgress;
    host.onLifecycleFinished = handleLifecycleFinished;
    return () => {
      host.onBeforeDeploy = undefined;
      host.onDeploymentProgress = undefined;
      host.onLifecycleFinished = undefined;
    };
  }, [handleDeploymentProgress, handleLifecycleFinished, host, requestDeployApproval]);

  // Feed clab-ui its native runtime-container contract. Its public runtime
  // updater maps interface state/counters onto links and traffic annotations;
  // keeping this here avoids duplicating any canvas rendering in Netlab UI.
  useEffect(() => {
    if (!sessionId || DEMO_MODE) return;
    const activeLab = openTabs.find((tab): tab is OpenLabTab => tab.id === activeTabId && tab.kind === "topology");
    const labName = activeLab?.topologyRef?.labName ?? "";
    let cancelled = false;
    let running = false;
    let reestablishing = false;
    let lastStateSignature: string | null = null;
    const update = async () => {
      if (running) return;
      running = true;
      try {
        const containers = await api.getRuntime(sessionId) as HostRuntimeContainer[];
        if (cancelled) return;
        host.setRuntimeContainers(containers);
        runtime.session.setContext({ runtimeContainers: containers });
        // clab-ui only assigns the link-up/link-down edge classes when it can
        // consult the topology node map (to special-case bridges/host/mgmt-net
        // endpoints); without it every edge keeps its neutral gray class even
        // while interface states are known. /api/runtime is session-scoped, so
        // the containers' own labName is the authoritative lab key.
        const topologyNodes: Record<string, { kind?: string }> = {};
        for (const node of canvasNodesRef.current) {
          const device = (node.data as { device?: unknown } | undefined)?.device;
          topologyNodes[node.id] = device === "bridge" ? { kind: "bridge" } : {};
        }
        applyRuntimeEdgeStatsToGraph(containers, {
          currentLabName: containers[0]?.labName ?? labName,
          topology: { nodes: topologyNodes },
        });
        // Node state dots are baked into the snapshot server-side, so a
        // deploy/destroy would keep showing stale dots until a manual page
        // reload. Re-request the snapshot whenever a container state flips.
        const signature = containers.map((c) => `${c.name}=${c.state}`).sort().join(",");
        if (lastStateSignature !== null && signature !== lastStateSignature) {
          void refreshTopologySnapshot({ externalChange: true }, runtime.session);
        }
        lastStateSignature = signature;
      } catch (err) {
        // The backend's session store is in-memory and process-local — a
        // dev-server reload/restart wipes it while this tab keeps polling
        // with the now-unknown sessionId. Re-activate the lab tab to mint a
        // fresh session instead of 404ing forever; the effect re-runs (deps
        // include sessionId) once the new id lands, replacing this interval.
        if (err instanceof HttpError && err.status === 404 && !reestablishing && activeLab) {
          reestablishing = true;
          void activateLabTab(activeLab, { skipDisposeCurrent: true });
        }
        // Otherwise: a stopped/non-clab lab simply has no live telemetry.
      } finally {
        running = false;
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 3000);
    return () => {
      cancelled = true;
      host.setRuntimeContainers([]);
      window.clearInterval(timer);
    };
  }, [activateLabTab, activeTabId, host, openTabs, runtime, sessionId]);

  // Feed locally available docker images into clab-ui's node-template editor.
  // clab-ui's useDockerImages reads window.__DOCKER_IMAGES__ and listens for
  // the 'docker-images-updated' event; populating both turns the Image/Version
  // fields into autocomplete dropdowns of images that actually exist locally.
  React.useEffect(() => {
    if (DEMO_MODE || startup.status !== "ready") return;
    let cancelled = false;
    api.getImageReferences()
      .then((images) => {
        if (cancelled) return;
        window.__DOCKER_IMAGES__ = images;
        window.dispatchEvent(new CustomEvent("docker-images-updated", { detail: images }));
      })
      .catch(() => { /* dropdowns gracefully fall back to free-text inputs */ });
    return () => { cancelled = true; };
  }, [startup.status]);

  // Stable callback refs for explorer controller (avoids re-creating controller on dependency changes)
  const sessionIdRef = useRef(sessionId); sessionIdRef.current = sessionId;
  const openShell = useCallback((node: string) => sessionDock.openTab("shell", node), [sessionDock]);
  const openLogs = useCallback((node: string) => sessionDock.openTab("logs", node), [sessionDock]);
  const openDrawioWizard = useCallback(() => sessionDock.openTab("drawio", "diagram"), [sessionDock]);
  const openShellRef = useRef(openShell); openShellRef.current = openShell;
  const openLogsRef = useRef(openLogs); openLogsRef.current = openLogs;
  const openDrawioWizardRef = useRef(openDrawioWizard); openDrawioWizardRef.current = openDrawioWizard;
  const handleNodeLifecycleRef = useRef(handleNodeLifecycle); handleNodeLifecycleRef.current = handleNodeLifecycle;
  const handleOpenLabRef = useRef(handleOpenLab); handleOpenLabRef.current = handleOpenLab;
  const handleOpenFileTabRef = useRef(handleOpenFileTab); handleOpenFileTabRef.current = handleOpenFileTab;
  const getOrCreateSessionRef = useRef(getOrCreateSession); getOrCreateSessionRef.current = getOrCreateSession;
  const handleDeployLabRef = useRef(handleDeployLab); handleDeployLabRef.current = handleDeployLab;
  const handleDestroyLabRef = useRef(handleDestroyLab); handleDestroyLabRef.current = handleDestroyLab;
  const handleNetlabInitialRef = useRef(handleNetlabInitial); handleNetlabInitialRef.current = handleNetlabInitial;
  const handleNetlabCreateConfigsRef = useRef(handleNetlabCreateConfigs); handleNetlabCreateConfigsRef.current = handleNetlabCreateConfigs;
  const handleNetlabRestartRef = useRef(handleNetlabRestart); handleNetlabRestartRef.current = handleNetlabRestart;
  const handleNetlabValidateRef = useRef(handleNetlabValidate); handleNetlabValidateRef.current = handleNetlabValidate;
  const handleNetlabCollectRef = useRef(handleNetlabCollect); handleNetlabCollectRef.current = handleNetlabCollect;

  // Restore the complete previous workspace (labs, file editors, active tab,
  // and unsaved editor buffers) once the backend is ready. Older installs that
  // only persisted a last-open lab retain the previous fallback behavior.
  React.useEffect(() => {
    if (startup.status !== "ready" || tabRestoreAttemptedRef.current) return;
    tabRestoreAttemptedRef.current = true;
    const saved = readOpenTabSession();
    if (saved?.tabs.length) {
      void restoreTabSession(saved);
      return;
    }
    const lastPath = readLastOpenLabPath();
    if (!lastPath || labFiles.length === 0) {
      void restoreTabSession(null);
      return;
    }
    const match = labFiles.find((f) => f?.topologyRef?.yamlPath === lastPath);
    void restoreTabSession(
      match?.topologyRef
        ? { tabs: [resolveOpenLabTab(match.topologyRef)], activeTabId: String(match.topologyRef.yamlPath) }
        : null
    );
  }, [startup.status, labFiles, restoreTabSession]);

  // ── Palette tabs ─────────────────────────────────────────────────────────────
  const refreshMultiserverEnabled = useCallback(async () => {
    if (DEMO_MODE || !sessionId) {
      setMultiserverEnabled(false);
      return;
    }
    try {
      const multiserver = await api.getMultiserver(sessionId);
      setMultiserverEnabled(multiserver.enabled);
    } catch {
      setMultiserverEnabled(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshMultiserverEnabled();
  }, [refreshMultiserverEnabled]);

  // Probed once per app load: the endpoint 404s when the assistant extra is
  // not installed, and the toolbar button simply never appears.
  const refreshAssistantCapabilities = useCallback(() => {
    void api
      .assistantCapabilities()
      .then((capabilities) => setAssistantCapabilities(capabilities.enabled ? capabilities : null))
      .catch(() => setAssistantCapabilities(null));
  }, []);

  useEffect(() => {
    refreshAssistantCapabilities();
  }, [refreshAssistantCapabilities]);

  const handlePluginPanelChanged = useCallback(async () => {
    if (runtime?.session) {
      await refreshTopologySnapshot({ externalChange: true }, runtime.session);
      refreshCanvas();
    }
    await refreshMultiserverEnabled();
    await refreshOpenFiles();
  }, [runtime, refreshCanvas, refreshMultiserverEnabled, refreshOpenFiles]);
  handlePluginPanelChangedRef.current = handlePluginPanelChanged;

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("netlab_gui_events");
      bc.onmessage = (event) => {
        if (event.data?.type === "topology_changed" || event.data?.type === "file_changed") {
          void handlePluginPanelChangedRef.current();
        }
      };
    } catch { /* BroadcastChannel fallback */ }

    const onWindowMessage = (event: MessageEvent) => {
      if (event.data?.type === "netlab_topology_changed" || event.data?.type === "netlab_file_changed") {
        void handlePluginPanelChangedRef.current();
      }
    };
    window.addEventListener("message", onWindowMessage);
    return () => {
      bc?.close();
      window.removeEventListener("message", onWindowMessage);
    };
  }, []);

  const customPaletteTabs = useCustomPaletteTabs({
    sessionId,
    activeUnitPath,
    activeTabId,
    multiserverEnabled,
    assistantCapabilities,
    assistantOpen,
    handleAssistantPopOut,
    handlePluginPanelChanged,
    refreshCanvas,
    netlabLenses,
    validationIssues,
    addToast,
    handleRerunDeployment,
    refreshAssistantCapabilities,
    setAssistantOpen,
    setAssistantSettingsProviderId,
    setSettingsTab,
    setSettingsOpen,
  });

  // The active lab is "running" when its name/path/directory shows up in the
  // live `netlab status` snapshot (same match clab-ui's explorer uses).
  // `netlab status --all` instance summaries only carry `dir` — no lab name,
  // no topology path — so the directory-prefix match is the one that actually
  // fires for netlab-managed labs.
  const activeLabRunning = useMemo(() => {
    const activeLab = openTabs.find((tab) => tab.id === activeTabId && tab.kind === "topology");
    if (activeLab?.kind !== "topology") return false;
    const labName = activeLab.topologyRef?.labName;
    const yamlPath = activeLab.topologyRef?.yamlPath;
    return Object.values(runningLabsStatus).some((info) =>
      (!!labName && info.name === labName) ||
      (!!yamlPath && info.path === yamlPath) ||
      (!!yamlPath && !!info.dir && yamlPath.startsWith(`${info.dir}/`))
    );
  }, [openTabs, activeTabId, runningLabsStatus]);

  // null until the lens bundle loads; then reflects whether the topology
  // defines any `validate:` tests.
  const hasValidateTests = netlabLenses.bundle ? netlabLenses.bundle.validation.available : null;

  const renderDeployMenuItems = useRenderDeployMenuItems({
    sessionId,
    activeLabRunning,
    hasValidateTests,
    handleNetlabInitial,
    handleNetlabCreateConfigs,
    handleNetlabRestart,
    handleNetlabValidate,
    handleNetlabCollect,
  });

  // Layer dynamic values onto the session-stable runtime.
  // yamlSchema loads async — keeping it out of the runtime useMemo prevents the
  // TopologySessionClient from being recreated when the schema arrives.
  // Palette labels/render hooks are passed via the runtime so clab-ui needs no extra props.
  const appRuntime = useMemo<ClabUiRuntime>(
    () => ({
      ...runtime,
      customPaletteTabs,
      yamlSchema,
      paletteTabLabels: { json: "Annotation JSON" },
      renderDeployMenuItems
    }),
    [runtime, customPaletteTabs, yamlSchema, renderDeployMenuItems]
  );

  return {
    runtime, appRuntime, host,
    sessionId, openTabs, activeTabId, activeFileTab,
    handleOpenLab, handleActivateLabTab, handleCloseLab,
    handleFileTabChange, handleFileTabSave, handleFileTabReload,
    handleCreateLab, getOrCreateSession,
    portalContainer, navbarPortalContainer, tabBarContainer, leftSidebarToggleContainer, netlabLinksPaletteContainer,
    isLeftSidebarOpen, handleToggleLeftSidebar,
    themeMode, handleThemeChange,
    labFiles, workspaces, setWorkspaces, fetchFiles,
    startup, checkStartup,
    transformRunning,
    refreshCanvas, addToast,
    validationIssues, setValidationIssues,
    deploymentProgress,
    netlabLenses, sessionDock, openShell, handleSessionPopOut,
    settingsOpen, setSettingsOpen, settingsTab, setSettingsTab,
    notificationsSupported, notificationsEnabled, notificationPermission, toggleNotifications,
    assistantCapabilities, assistantOpen, setAssistantOpen, assistantSettingsProviderId,
    refreshAssistantCapabilities,
    deployDiff, deployValidationIssues, setDeployDiff, setDeployValidationIssues, deployDecisionRef,
    quickOpen, setQuickOpen,
    isTopologyLocked, quickActions,
    imageManagerOpen, setImageManagerOpen,
    inspectOutput, setInspectOutput,
    runningLabsOpen, setRunningLabsOpen, refreshStatus, handleDestroyLab,
    cloneOpen, cloneTarget, setCloneOpen, setCloneTarget,
    folderBrowserOpen, setFolderBrowserOpen,
    exampleLabsOpen, setExampleLabsOpen,
    newFolderParent, setNewFolderParent,
    newLabDialogOpen, setNewLabDialogOpen,
    runtimeSnackbar, setRuntimeSnackbar,
  };
}
