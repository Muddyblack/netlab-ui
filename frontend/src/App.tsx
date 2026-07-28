import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App as ClabUiApp, useIsLocked, useNodes, useTopoViewerActions } from "@srl-labs/clab-ui";
import { LabTabsBar } from "./components/LabTabsBar";
import {
  createClabUiRuntime,
  type CustomPaletteTab,
  type ClabUiRuntime,
  type HostRuntimeContainer,
  type TopologyUiContext,
  type TopologyUiRequestOptions,
} from "@srl-labs/clab-ui/host";
import { ContainerlabImageManagerDialog } from "@srl-labs/clab-ui/image-manager";
import {
  applyRuntimeEdgeStatsToGraph,
  executeTopologyCommand,
  refreshTopologySnapshot,
  type TopologySessionClient,
  type TopologySnapshot,
} from "@srl-labs/clab-ui/session";
import { MuiThemeProvider } from "@srl-labs/clab-ui/theme";
import { createApiClabUiHost, type AppClabUiHost } from "./host/createHost";
import { createDemoClabUiHost } from "./host/createDemoHost";
import { INITIAL_GRAPH_DATA } from "./icons";
import { Box, IconButton, Tooltip } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@srl-labs/clab-ui/styles/global.css";
import "highlight.js/styles/github-dark.css";

import { PluginsPanel } from "./panels/Plugins";
import { AttractorEmptyState } from "./components/AttractorEmptyState";
import { NetlabBasicTab } from "./components/node-editor/NetlabBasicTab";
import { NetlabConfigTab } from "./components/node-editor/NetlabConfigTab";
import { NetlabAdvancedTab } from "./components/node-editor/NetlabAdvancedTab";
import { NetlabModulesTab } from "./components/node-editor/NetlabModulesTab";
import { NodeEditorSessionProvider } from "./components/node-editor/NodeEditorSessionContext";
import { UnitsDock } from "./panels/UnitsDock";
import { UnitComposer } from "./panels/UnitComposer";
import { useAutoOpenComposerTab } from "./hooks/useAutoOpenComposerTab";
import { GroupsPanel } from "./panels/Groups";
import { NetlabLinks } from "./panels/NetlabLinks";
import { WorkersPanel } from "./panels/Workers";
import { AssistantPanel } from "./panels/assistant/AssistantPanel";
import { ProviderSettingsDialog } from "./panels/assistant/ProviderSettingsDialog";
import {
  persistAssistantOpen,
  readAssistantOpen,
} from "./panels/assistant/preferences";
import { RuntimeSnackbarView } from "./components/RuntimeSnackbarView";
import { StartupGate } from "./components/StartupGate";
import { EnvWarningBanner } from "./components/EnvWarningBanner";
import { NetlabDeployMenuItems } from "./components/NetlabDeployMenuItems";
import { CanvasValidationSummary } from "./components/CanvasValidationSummary";
import { DeployDiffDialog } from "./components/DeployDiffDialog";
import { CanvasDeploymentProgress, type DeploymentProgress } from "./components/CanvasDeploymentProgress";
import { QuickOpenDialog } from "./components/QuickOpenDialog";
import { api, HttpError, type AssistantCapabilities, type DeployDiffResult } from "./api/client";

import { DEMO_MODE, defaultRuntimeSnackbar, type OpenLabTab, type RuntimeSnackbarState, type WorkspaceEntry } from "./lifecycle/types";
import { readLastOpenLabPath, readOpenTabSession, resolveOpenLabTab } from "./lifecycle/persistence";

import { useAppData } from "./hooks/useAppData";
import { usePortalInjection } from "./hooks/usePortalInjection";
import { useDeployLogCopyButton } from "./hooks/useDeployLogCopyButton";
import { useTabManager } from "./hooks/useTabManager";
import { useLabLifecycle } from "./hooks/useLabLifecycle";
import type { ValidationIssue } from "./hooks/useLabLifecycle";
import { useExplorerController, type ExplorerIncomingMessage } from "./hooks/useExplorerController";
import { useSessionDock, type SessionTab } from "./hooks/useSessionDock";
import { useBrowserNotifications } from "./hooks/useBrowserNotifications";
import { NetlabLenses } from "./components/lenses/NetlabLenses";
import { LensesPanel } from "./components/lenses/LensesPanel";
import { useNetlabLenses } from "./hooks/useNetlabLenses";
import { useRightPanelTabMemory } from "./hooks/useRightPanelTabMemory";
import { WorkspaceDialogs } from "./components/WorkspaceDialogs";
import { AppToolbarActions } from "./app/AppToolbarActions";
import { RunningLabsDialog } from "./components/dialogs/RunningLabsDialog";
import { CommandOutputDialog } from "./components/dialogs/CommandOutputDialog";
import { SettingsDialog, type SettingsTab } from "./components/dialogs/SettingsDialog";

// Monaco (file editor) and xterm (node shell) dominate the initial bundle but
// are only needed once the user opens a file tab or a shell — load them lazily
// so first paint doesn't pay for them.
const FileEditorTabPanel = lazy(() =>
  import("./components/FileEditorTabPanel").then((m) => ({ default: m.FileEditorTabPanel }))
);
const SessionDock = lazy(() => import("./terminal/SessionDock").then((m) => ({ default: m.SessionDock })));

const netlabNodeEditorTabs = [
  { id: "basic", label: "Basic", component: NetlabBasicTab },
  { id: "components", label: "Modules", component: NetlabModulesTab },
  { id: "config", label: "Configuration", component: NetlabConfigTab },
  { id: "advanced", label: "Advanced", component: NetlabAdvancedTab }
];

export default function App() {
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
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
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
      openLabGraph: async (sid, layout) => {
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
      },
      // Real draw.io/mxGraph XML (containerlab --drawio, via clab-io-draw) -
      // unlike the SVG graph above, browsers can't render this inline, so it
      // downloads as a .drawio file for opening in the draw.io app instead.
      exportDrawio: async (sid, layout) => {
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
      },
      inspectLab: async (sid) => {
        setInspectOutput({ loading: true, output: null, error: null });
        try {
          const result = await api.labInspect(sid);
          if (result.code !== 0) throw new Error(result.stderr || result.stdout || `netlab inspect exited ${result.code}`);
          setInspectOutput({ loading: false, output: result.stdout, error: null });
        } catch (err) {
          setInspectOutput({ loading: false, output: null, error: err instanceof Error ? err.message : String(err) });
        }
      },
      runFcli: async (sid, command) => {
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
      },
      openShell: (n) => openShellRef.current(n),
      showLogs: (n) => openLogsRef.current(n),
      openDrawioWizard: () => openDrawioWizardRef.current(),
      nodeLifecycle: (n, action) => handleNodeLifecycleRef.current(n, action),
      installEdgeshark: () => {
        addToast("Installing Edgeshark on the docker host — first install pulls images and can take a few minutes…", "info");
        api.installEdgeshark().then(
          () => addToast("Edgeshark is installed and running — packet capture is ready", "success"),
          (err) => addToast(`Edgeshark install failed: ${err instanceof Error ? err.message : String(err)}`, "error")
        );
      },
      uninstallEdgeshark: () => {
        api.uninstallEdgeshark().then(
          () => addToast("Edgeshark removed", "success"),
          (err) => addToast(`Edgeshark uninstall failed: ${err instanceof Error ? err.message : String(err)}`, "error")
        );
      },
      killAllWiresharkVNC: () => {
        api.killAllWiresharkVnc().then(
          (result) => addToast(result.message, "success"),
          (err) => addToast(`Could not remove Wireshark containers: ${err instanceof Error ? err.message : String(err)}`, "error")
        );
      },
      addToast,
      getSessionId: () => sessionIdRef.current
    }
  });

  // ── Background netlab transform tracking ────────────────────────────────────
  // Snapshots arrive instantly from the YAML model while `netlab create` warms
  // the projection cache in the background (`transformPending: true`). Poll the
  // snapshot until the transform lands, with a toast at start and finish.
  const transformPollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; announced: boolean }>({ timer: null, announced: false });
  // netlab-specific field the backend adds to its snapshot response — not part
  // of clab-ui's own TopologySnapshot type.
  const handleTransformPendingRef = useRef<(snap: TopologySnapshot & { transformPending?: boolean }) => void>(() => { });
  handleTransformPendingRef.current = (snap) => {
    const state = transformPollRef.current;
    if (snap?.transformPending) {
      if (!state.announced) {
        state.announced = true;
        addToast("netlab is transforming the topology in the background — showing a quick preview", "info");
      }
      if (!state.timer) {
        state.timer = setTimeout(() => {
          state.timer = null;
          refreshCanvasRef.current();
        }, 3000);
      }
    } else if (state.announced) {
      state.announced = false;
      addToast("Topology transform complete", "success");
    }
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
    netlabLenses.applyDeploymentProgress(progress);
    if (progress.done) {
      deploymentProgressTimerRef.current = setTimeout(() => setDeploymentProgress(null), 4000);
    }
  }, [netlabLenses.applyDeploymentProgress]);

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

  // ── Canvas drop ──────────────────────────────────────────────────────────────

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

  const customPaletteTabs = useMemo<CustomPaletteTab[]>(() => {
    if (!sessionId) return [];
    const tabs: CustomPaletteTab[] = [];
    // Leads the tab strip when present — it's the reason you're looking at
    // this file, so it shouldn't be buried after the general-purpose tabs.
    if (activeUnitPath) {
      tabs.push({
        id: "netlab-composer",
        label: "Composer",
        render: () => (
          <UnitComposer sessionId={sessionId} unitPath={activeUnitPath} refreshKey={activeTabId ?? undefined} onSaved={refreshCanvas} onToast={addToast} />
        )
      });
    }
    tabs.push({
      id: "netlab-lenses",
      label: "Lenses",
      render: () => <LensesPanel state={netlabLenses} validationIssues={validationIssues} onToast={addToast} onRerunDeployment={handleRerunDeployment} />
    });
    if (!DEMO_MODE) {
      tabs.push(
        { id: "netlab-groups", label: "Groups", render: () => <GroupsPanel sessionId={sessionId} onChanged={refreshCanvas} /> },
        { id: "netlab-plugins", label: "Plugins", render: () => <PluginsPanel sessionId={sessionId} onChanged={handlePluginPanelChanged} /> }
      );
    }
    if (multiserverEnabled) {
      tabs.push({ id: "netlab-workers", label: "Workers", render: () => <WorkersPanel sessionId={sessionId} onChanged={handlePluginPanelChanged} /> });
    }
    // The Assistant tab only exists in the strip while toggled on from the
    // navbar Chat button — clab-ui owns which palette tab is active and
    // exposes no way to select one from outside, so this is the only lever
    // the host has to make the button feel like it "opens" the assistant.
    if (assistantCapabilities && assistantOpen) {
      tabs.push({
        id: "netlab-assistant",
        label: "Assistant",
        render: () => (
          <AssistantPanel
            capabilities={assistantCapabilities}
            sessionId={sessionId}
            onApplied={handlePluginPanelChanged}
            onPopOut={handleAssistantPopOut}
            onClose={() => setAssistantOpen(false)}
            onOpenSettings={(providerId) => {
              setAssistantSettingsProviderId(providerId || undefined);
              setAssistantSettingsOpen(true);
            }}
            onCapabilitiesChanged={refreshAssistantCapabilities}
          />
        )
      });
    }
    return tabs;
  }, [sessionId, activeUnitPath, activeTabId, multiserverEnabled, assistantCapabilities, assistantOpen, handleAssistantPopOut, handlePluginPanelChanged, refreshCanvas, netlabLenses, validationIssues, addToast, handleRerunDeployment, refreshAssistantCapabilities]);

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

  const renderDeployMenuItems = useCallback(
    ({ closeMenu }: { isViewerMode: boolean; closeMenu: () => void }) =>
      sessionId && !DEMO_MODE ? (
        <NetlabDeployMenuItems
          sessionId={sessionId}
          isRunning={activeLabRunning}
          hasTests={hasValidateTests}
          closeMenu={closeMenu}
          onInitial={() => void handleNetlabInitial(sessionId)}
          onCreate={() => void handleNetlabCreateConfigs(sessionId)}
          onRestart={() => void handleNetlabRestart(sessionId)}
          onValidate={() => void handleNetlabValidate(sessionId)}
          onCollect={() => void handleNetlabCollect(sessionId)}
        />
      ) : null,
    [sessionId, activeLabRunning, hasValidateTests, handleNetlabInitial, handleNetlabCreateConfigs, handleNetlabRestart, handleNetlabValidate, handleNetlabCollect]
  );

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

  // ── Render ───────────────────────────────────────────────────────────────────
  const toolbarActions = (
    <AppToolbarActions
      notificationsSupported={notificationsSupported}
      notificationsEnabled={notificationsEnabled}
      notificationPermission={notificationPermission}
      onToggleNotifications={() => void toggleNotifications()}
      onOpenSettings={() => {
        setSettingsTab("general");
        setSettingsOpen(true);
      }}
      assistantAvailable={Boolean(assistantCapabilities && sessionId)}
      assistantOpen={assistantOpen}
      onToggleAssistant={() => setAssistantOpen((open) => !open)}
    />
  );

  return (
    <MuiThemeProvider>
      {startup.status !== "ready" ? (
        <StartupGate startup={startup} onRetry={checkStartup} />
      ) : (
        <Box
          sx={{
            display: "flex",
            height: "100vh",
            width: "100vw",
            bgcolor: "background.default",
            color: "text.primary",
            overflow: "hidden",
            position: "relative",
            '& [data-testid="navbar-about"], & [aria-label*="About"], & [title*="About"], & [aria-label*="about"]': {
              display: "none !important",
            },
            ...(!sessionId ? {
              // clab-ui keeps its topology toolbar mounted (disabled) without
              // an active session. Hide those lab-only controls in the empty
              // workspace while retaining global workspace/theme/About actions.
              '& [data-testid="navbar-deploy"], & [data-testid="navbar-deploy-menu"], & [data-testid="navbar-lock"], & [data-testid="navbar-lab-settings"], & [data-testid="navbar-undo"], & [data-testid="navbar-redo"], & [data-testid="navbar-bulk-link"], & [data-testid="navbar-fit-viewport"], & [data-testid="navbar-split-view"], & [data-testid="navbar-layout"], & [data-testid="navbar-find-node"], & [data-testid="navbar-link-labels"], & [data-testid="navbar-capture"], & [data-testid="navbar-shortcuts"], & [data-testid="navbar-shortcut-display"]': {
                display: "none",
              },
              '& [data-testid="topoviewer-app"] > .MuiAppBar-root .MuiDivider-root': {
                display: "none",
              },
            } : {}),
          }}
        >
          {runtime && (
            <NodeEditorSessionProvider value={sessionId}>
              <ClabUiApp
                initialData={INITIAL_GRAPH_DATA}
                runtime={appRuntime}
              />
            </NodeEditorSessionProvider>
          )}

          {!sessionId && !activeFileTab && portalContainer && createPortal(
            <AttractorEmptyState
              labs={labFiles}
              onOpenLab={(topologyRef) => void handleOpenLab(topologyRef)}
            />,
            portalContainer
          )}

          {navbarPortalContainer && createPortal(toolbarActions, navbarPortalContainer)}
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            initialTab={settingsTab}
            themeMode={themeMode}
            onToggleTheme={() => handleThemeChange(themeMode === "dark" ? "light" : "dark")}
            notificationsSupported={notificationsSupported}
            notificationsEnabled={notificationsEnabled}
            notificationPermission={notificationPermission}
            onToggleNotifications={() => void toggleNotifications()}
            workspaces={workspaces}
            onAddWorkspace={async (path) => {
              const r = await api.addWorkspace(path);
              setWorkspaces(r.workspaces as WorkspaceEntry[]);
              void fetchFiles();
            }}
            onRemoveWorkspace={async (path) => {
              const r = await api.removeWorkspace(path);
              setWorkspaces(r.workspaces as WorkspaceEntry[]);
              void fetchFiles();
            }}
            onEnvironmentChanged={() => void checkStartup()}
            health={startup.health}
          />

          {sessionId && netlabLinksPaletteContainer && createPortal(
            <NetlabLinks sessionId={sessionId} onChanged={refreshCanvas} onToast={addToast} />,
            netlabLinksPaletteContainer
          )}

          {leftSidebarToggleContainer && createPortal(
            <Tooltip title={isLeftSidebarOpen ? "Hide left sidebar" : "Show left sidebar"} placement="right">
              <IconButton
                size="small"
                onClick={handleToggleLeftSidebar}
                data-testid="left-sidebar-toggle"
                sx={{
                  width: 20,
                  height: 48,
                  borderRadius: "0 4px 4px 0",
                  border: 1,
                  borderLeft: 0,
                  borderColor: "divider",
                  bgcolor: "background.paper",
                  color: "text.secondary",
                  p: 0,
                  "&:hover": { bgcolor: "action.hover" }
                }}
              >
                {isLeftSidebarOpen
                  ? <ChevronLeftIcon sx={{ fontSize: 16 }} />
                  : <ChevronRightIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>,
            leftSidebarToggleContainer
          )}

          {tabBarContainer && openTabs.length > 0 && createPortal(
            <LabTabsBar
              activeTabId={activeTabId}
              tabs={openTabs.map((t) => ({ id: t.id, title: t.title, subtitle: t.subtitle, path: t.kind === "topology" ? t.topologyRef?.yamlPath : t.path, dirty: t.kind === "file" ? t.content !== t.originalContent : false }))}
              onActivate={(id) => void handleActivateLabTab(id)}
              onClose={(id) => void handleCloseLab(id)}
            />,
            tabBarContainer
          )}

          {portalContainer && activeFileTab && createPortal(
            <Suspense fallback={null}>
              <FileEditorTabPanel tab={activeFileTab} themeMode={themeMode} onChange={handleFileTabChange} onClose={(id) => void handleCloseLab(id)} onSave={(id) => void handleFileTabSave(id)} onReload={handleFileTabReload} />
            </Suspense>,
            portalContainer
          )}

          {portalContainer && sessionId && !activeFileTab && !DEMO_MODE && createPortal(
            <>
              <CanvasValidationSummary issues={validationIssues} onClose={() => setValidationIssues([])} />
              <CanvasDeploymentProgress progress={deploymentProgress} />
              <UnitsDock
                sessionId={sessionId}
                refreshKey={activeTabId ?? undefined}
                onRefresh={refreshCanvas}
                onToast={addToast}
                onOpenUnit={(unit) =>
                  void handleOpenLab(
                    {
                      topologyId: `standalone:local::${unit.path}`,
                      labName: unit.name,
                      yamlPath: unit.path,
                      source: "standalone"
                    },
                    // Unit layouts keep the coordinates of the lab they were
                    // drawn in — fit the viewport or the canvas looks blank.
                    { fitView: true }
                  )
                }
              />
              <NetlabLenses
                sessionId={sessionId}
                container={portalContainer as HTMLElement}
                state={netlabLenses}
                themeMode={themeMode}
                onToast={addToast}
              />
            </>,
            portalContainer
          )}

          <DeployDiffDialog
            diff={deployDiff}
            validationIssues={deployValidationIssues}
            onCancel={() => {
              setDeployDiff(null);
              setDeployValidationIssues([]);
              deployDecisionRef.current?.(false);
              deployDecisionRef.current = null;
            }}
            onDeploy={() => {
              setDeployDiff(null);
              setDeployValidationIssues([]);
              deployDecisionRef.current?.(true);
              deployDecisionRef.current = null;
            }}
          />

          <QuickOpenDialog
            open={quickOpen}
            onClose={() => setQuickOpen(false)}
            sessionId={sessionId}
            isLocked={isTopologyLocked}
            labs={labFiles}
            actions={quickActions}
            onOpenLab={(topologyRef) => void handleOpenLab(topologyRef)}
            onOpenUnit={(unit) => void handleOpenLab({ topologyId: `standalone:local::${unit.path}`, labName: unit.name, yamlPath: unit.path, source: "standalone" }, { fitView: true })}
            onInstantiateUnit={(unit) => {
              if (!sessionId) return;
              if (isTopologyLocked) {
                addToast("Unlock the lab before placing a unit.", "warning");
                return;
              }
              void api.instantiateUnit(sessionId, unit.name)
                .then(() => {
                  refreshCanvas();
                  host.emitTopoViewerEvent?.({ type: "fitViewport" });
                  addToast(`Instantiated ${unit.name}`, "success");
                })
                .catch((err) => addToast(`Could not instantiate ${unit.name}: ${err instanceof Error ? err.message : String(err)}`, "error"));
            }}
          />

          {/* Session dock lives in the canvas overlay container but renders for
              file tabs too (VS Code-style panel over the editor) so shells and
              log streams survive tab switches. */}
          {portalContainer && sessionId && !DEMO_MODE && sessionDock.tabs.length > 0 && createPortal(
            <Suspense fallback={null}>
              <SessionDock
                sessionId={sessionId}
                tabs={sessionDock.tabs}
                activeKey={sessionDock.activeKey}
                open={sessionDock.open}
                onSelect={sessionDock.selectTab}
                onClose={sessionDock.closeTab}
                onToggleOpen={() => sessionDock.setOpen((value) => !value)}
                onOpenShell={openShell}
                onPopOut={handleSessionPopOut}
              />
            </Suspense>,
            portalContainer
          )}

          {assistantCapabilities && (
            <ProviderSettingsDialog
              open={assistantSettingsOpen}
              onClose={() => setAssistantSettingsOpen(false)}
              providers={assistantCapabilities.providers ?? []}
              initialProviderId={assistantSettingsProviderId}
              onChanged={refreshAssistantCapabilities}
            />
          )}

          {runtime && <ContainerlabImageManagerDialog open={imageManagerOpen} runtime={runtime} onClose={() => setImageManagerOpen(false)} endpointOptions={[{ id: "local", label: "local" }]} />}

          <CommandOutputDialog
            open={inspectOutput !== null}
            onClose={() => setInspectOutput(null)}
            title="netlab inspect"
            loading={inspectOutput?.loading ?? false}
            output={inspectOutput?.output ?? null}
            errorMessage={inspectOutput?.error ?? null}
            themeMode={themeMode}
            language="yaml"
          />

          <RunningLabsDialog
            open={runningLabsOpen}
            onClose={() => setRunningLabsOpen(false)}
            onChanged={() => { void refreshStatus(); void fetchFiles(); }}
            onToast={addToast}
            getOrCreateSession={getOrCreateSession}
            handleDestroyLab={handleDestroyLab}
          />

          <WorkspaceDialogs
            setWorkspaces={setWorkspaces}
            fetchFiles={fetchFiles}
            addToast={addToast}
            cloneOpen={cloneOpen}
            cloneTarget={cloneTarget}
            onCloneClose={() => { setCloneOpen(false); setCloneTarget(undefined); }}
            folderBrowserOpen={folderBrowserOpen}
            onFolderBrowserClose={() => setFolderBrowserOpen(false)}
            exampleLabsOpen={exampleLabsOpen}
            onExampleLabsClose={() => setExampleLabsOpen(false)}
            newFolderParent={newFolderParent}
            onNewFolderClose={() => setNewFolderParent(null)}
            newLabDialogOpen={newLabDialogOpen}
            onNewLabDialogClose={() => setNewLabDialogOpen(false)}
            onCreateLab={handleCreateLab}
          />

          <EnvWarningBanner health={DEMO_MODE ? null : startup.health} />

          <RuntimeSnackbarView snackbar={runtimeSnackbar} onClose={() => setRuntimeSnackbar(defaultRuntimeSnackbar)} />
        </Box>
      )}
    </MuiThemeProvider>
  );
}
