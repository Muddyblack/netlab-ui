import { useEffect, useMemo, useRef } from "react";
import type React from "react";
import { createExplorerController } from "@srl-labs/clab-ui/host";
import type { TopologyRef } from "@srl-labs/clab-ui/session";
import { buildFileProvider } from "../host/fileProvider";
import { buildRunningProvider, buildHelpProvider } from "../host/runningProvider";
import { readPersistedExplorerUiState, persistExplorerUiState, closeExplorerTransientUi } from "../lifecycle/persistence";
import type { WorkspaceEntry } from "../lifecycle/types";
import type { LabFileEntry } from "../api/client";
import type { RunningLabsStatus } from "./useAppData";

type ExplorerControllerOptions = Parameters<typeof createExplorerController>[0];
type ExplorerActionInvocation = Parameters<ExplorerControllerOptions["executeAction"]>[0];
export type ExplorerIncomingMessage = Parameters<ExplorerControllerOptions["publish"]>[0];
type ExplorerUiState = NonNullable<ExplorerControllerOptions["initialUiState"]>;
type ExplorerSnapshotOptions = Awaited<ReturnType<NonNullable<ExplorerControllerOptions["getSnapshotOptions"]>>>;

export interface ExplorerActionCallbacks {
  openLab: (topoRef: TopologyRef) => Promise<void>;
  openFileTab: (input: { endpointId: string; path: string; title?: string }) => Promise<void>;
  getOrCreateSession: (topoRef: TopologyRef) => Promise<string | null>;
  deployLab: (sid: string) => Promise<void>;
  destroyLab: (sid: string) => Promise<void>;
  netlabInitial: (sid: string) => Promise<void>;
  netlabCreateConfigs: (sid: string) => Promise<void>;
  netlabRestart: (sid: string) => Promise<void>;
  netlabValidate: (sid: string) => Promise<void>;
  netlabCollect: (sid: string) => Promise<void>;
  openNewLabDialog: () => void;
  openCloneDialog: (targetWorkspace?: string) => void;
  openAddWorkspace: () => void;
  openExampleLabs: () => void;
  newFolder: (parentPath: string) => void;
  removeWorkspace: (path: string) => void;
  openImageManager: () => void;
  openRunningLabs: () => void;
  openLabGraph: (sid: string, layout: "interactive" | "horizontal" | "vertical") => Promise<void>;
  exportDrawio: (sid: string, layout: "horizontal" | "vertical") => Promise<void>;
  /** Opens the interactive draw.io layout wizard as a session-dock terminal
   * tab (like openShell, it always targets the *currently active* lab
   * session — there's no per-tab session id, same as node shells). */
  openDrawioWizard: () => void;
  inspectLab: (sid: string) => Promise<void>;
  runFcli: (sid: string, command: string) => Promise<void>;
  openShell: (nodeName: string) => void;
  showLogs: (nodeName: string) => void;
  nodeLifecycle: (nodeName: string, action: "start" | "stop" | "restart" | "pause" | "unpause" | "save") => void;
  installEdgeshark: () => void;
  uninstallEdgeshark: () => void;
  killAllWiresharkVNC: () => void;
  addToast: (message: string, severity?: "info" | "success" | "warning" | "error") => void;
  getSessionId: () => string | null;
}

interface Options {
  explorerSubscribers: React.RefObject<Set<(msg: ExplorerIncomingMessage) => void>>;
  labFilesRef: React.RefObject<LabFileEntry[]>;
  runningLabsStatusRef: React.RefObject<RunningLabsStatus>;
  workspacesRef: React.RefObject<WorkspaceEntry[]>;
  labFiles: LabFileEntry[];
  runningLabsStatus: RunningLabsStatus;
  workspaces: WorkspaceEntry[];
  callbacks: ExplorerActionCallbacks;
}

function toFileSignature(file: LabFileEntry) {
  const topologyRef = file?.topologyRef ?? {};
  return {
    filename: file?.filename ?? "",
    labName: file?.labName ?? "",
    path: file?.path ?? "",
    workspace: file?.workspace ?? "",
    topologyId: topologyRef.topologyId ?? "",
    yamlPath: topologyRef.yamlPath ?? "",
    source: topologyRef.source ?? ""
  };
}

function buildExplorerDataSignature(
  labFiles: LabFileEntry[],
  runningLabsStatus: RunningLabsStatus,
  workspaces: WorkspaceEntry[]
): string {
  const files = (labFiles ?? [])
    .map(toFileSignature)
    .sort((a, b) => a.path.localeCompare(b.path));

  const runningLabs = Object.entries(runningLabsStatus ?? {})
    .map(([key, labInfo]) => ({
      key,
      name: labInfo?.name ?? "",
      path: labInfo?.path ?? "",
      dir: labInfo?.dir ?? "",
      status: labInfo?.status ?? "",
      nodes: Object.entries(labInfo?.nodes ?? {})
        .map(([nodeName, nodeInfo]) => ({
          name: nodeName,
          status: nodeInfo?.status ?? ""
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const workspaceList = (workspaces ?? [])
    .map((workspace) => ({ path: workspace.path ?? "" }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return JSON.stringify({ files, runningLabs, workspaces: workspaceList });
}

type ActionItem = {
  topologyRef?: TopologyRef;
  path?: string;
  resourcePath?: string;
  endpointId?: string;
  title?: string;
  label?: string;
  name?: string;
  containerName?: unknown;
  mgmtIp?: unknown;
  kind?: unknown;
  image?: unknown;
};

interface ActionCtx {
  cb: ExplorerActionCallbacks;
  item: ActionItem | undefined;
  topoRef: TopologyRef | undefined;
  args: unknown[];
  runningLabsStatusRef: React.RefObject<RunningLabsStatus>;
}

async function resolveSession(cb: ExplorerActionCallbacks, ref: TopologyRef): Promise<string | null> {
  let sid = cb.getSessionId();
  if (!sid) sid = await cb.getOrCreateSession(ref);
  return sid;
}

// Same directory-prefix match App.tsx's `activeLabRunning` uses: `netlab
// status --all` instance summaries only carry `dir`, no lab name or
// topology path, so that's the match that actually fires for netlab-managed
// labs.
function findRunningNodeNames(runningLabsStatusRef: React.RefObject<RunningLabsStatus>, ref: TopologyRef): string[] {
  const labName = ref.labName;
  const yamlPath = ref.yamlPath;
  const info = Object.values(runningLabsStatusRef.current ?? {}).find((entry) =>
    (!!labName && entry.name === labName) ||
    (!!yamlPath && entry.path === yamlPath) ||
    (!!yamlPath && !!entry.dir && yamlPath.startsWith(`${entry.dir}/`))
  );
  return Object.keys(info?.nodes ?? {});
}

async function handleOpenTopoViewer({ cb, topoRef }: ActionCtx) {
  if (topoRef) await cb.openLab(topoRef);
}

// clab-io-draw's assign-levels wizard needs a real TTY — opened as a
// session-dock terminal tab (PTY/WebSocket bridge) instead of a plain
// request/response export like horizontal/vertical below.
async function handleDrawioInteractive({ cb, topoRef }: ActionCtx) {
  if (!topoRef) return;
  const sid = await resolveSession(cb, topoRef);
  if (sid) cb.openDrawioWizard();
}

function makeDrawioExportHandler(layout: "horizontal" | "vertical") {
  return async ({ cb, topoRef }: ActionCtx) => {
    if (!topoRef) return;
    const sid = await resolveSession(cb, topoRef);
    if (sid) await cb.exportDrawio(sid, layout);
  };
}

function makeNetlabSvgGraphHandler(layout: "interactive" | "horizontal" | "vertical") {
  return async ({ cb, topoRef }: ActionCtx) => {
    if (!topoRef) return;
    const sid = await resolveSession(cb, topoRef);
    if (sid) await cb.openLabGraph(sid, layout);
  };
}

async function handleInspectOneLab({ cb, topoRef }: ActionCtx) {
  if (!topoRef) return;
  const sid = await resolveSession(cb, topoRef);
  if (sid) await cb.inspectLab(sid);
}

const FCLI_COMMAND_BY_ID: Record<string, string> = {
  "containerlab.lab.fcli.bgpPeers": "bgp-peers",
  "containerlab.lab.fcli.bgpRib": "bgp-rib",
  "containerlab.lab.fcli.ipv4Rib": "ipv4-rib",
  "containerlab.lab.fcli.lldp": "lldp",
  "containerlab.lab.fcli.mac": "mac",
  "containerlab.lab.fcli.ni": "ni",
  "containerlab.lab.fcli.subif": "subif",
  "containerlab.lab.fcli.sysInfo": "sys-info"
};

function makeFcliHandler(command: string) {
  return async ({ cb, topoRef }: ActionCtx) => {
    if (!topoRef) return;
    const sid = await resolveSession(cb, topoRef);
    if (sid) await cb.runFcli(sid, command);
  };
}

async function handleOpenFile({ cb, item }: ActionCtx) {
  const path = item?.path || item?.resourcePath || item?.topologyRef?.yamlPath;
  if (path) await cb.openFileTab({ endpointId: item?.endpointId || "local", path, title: item?.title || item?.label });
}

async function handleDeployLab({ cb, topoRef }: ActionCtx) {
  if (!topoRef) return;
  const sid = await resolveSession(cb, topoRef);
  if (sid) await cb.deployLab(sid);
}

async function handleDestroyLab({ cb, topoRef }: ActionCtx) {
  if (!topoRef) return;
  const sid = await resolveSession(cb, topoRef);
  if (sid) await cb.destroyLab(sid);
}

async function handleNetlabRestart({ cb, topoRef }: ActionCtx) {
  if (!topoRef) return;
  const sid = await resolveSession(cb, topoRef);
  if (sid) await cb.netlabRestart(sid);
}

async function handleSshToAllNodes({ cb, topoRef, runningLabsStatusRef }: ActionCtx) {
  if (!topoRef) return;
  const sid = await resolveSession(cb, topoRef);
  const nodeNames = findRunningNodeNames(runningLabsStatusRef, topoRef);
  if (sid && nodeNames.length === 0) {
    cb.addToast("No running nodes found for this lab", "warning");
  } else if (sid) {
    nodeNames.forEach((nodeName) => cb.openShell(nodeName));
  }
}

async function handleCopyPath({ cb, item }: ActionCtx) {
  const path = item?.topologyRef?.yamlPath || item?.path || item?.resourcePath;
  if (path) {
    void navigator.clipboard.writeText(path).then(
      () => cb.addToast(`Copied: ${path}`, "success"),
      () => cb.addToast("Clipboard write failed", "error")
    );
  } else {
    cb.addToast("Nothing to copy for this lab", "warning");
  }
}

function handleOpenNewLabDialog({ cb }: ActionCtx) {
  cb.openNewLabDialog();
}

function handleOpenLink({ args }: ActionCtx) {
  if (typeof args[0] === "string") window.open(args[0], "_blank");
}

function handleOpenCloneDialog({ cb }: ActionCtx) {
  cb.openCloneDialog();
}

function handleCloneHere({ cb, item }: ActionCtx) {
  cb.openCloneDialog(item?.resourcePath);
}

function handleAddToWorkspace({ cb }: ActionCtx) {
  cb.openAddWorkspace();
}

function handleRemoveWorkspace({ cb, item }: ActionCtx) {
  if (item?.resourcePath) cb.removeWorkspace(item.resourcePath);
}

function handleBrowseExamples({ cb }: ActionCtx) {
  cb.openExampleLabs();
}

function handleNewFolder({ cb, item }: ActionCtx) {
  if (item?.resourcePath) cb.newFolder(item.resourcePath);
}

function handleManageImages({ cb }: ActionCtx) {
  cb.openImageManager();
}

function handleOpenRunningLabs({ cb }: ActionCtx) {
  cb.openRunningLabs();
}

function handleNodeShell({ cb, item }: ActionCtx) {
  const nodeName = item?.name || item?.label;
  if (nodeName) cb.openShell(nodeName);
}

function handleNodeLogs({ cb, item }: ActionCtx) {
  const nodeName = item?.name || item?.label;
  if (nodeName) cb.showLogs(nodeName);
}

function makeNodeLifecycleHandler(action: "start" | "stop" | "restart" | "pause" | "unpause" | "save") {
  return ({ cb, item }: ActionCtx) => {
    const nodeName = item?.name || item?.label;
    if (nodeName) cb.nodeLifecycle(nodeName, action);
  };
}

function handleInstallEdgeshark({ cb }: ActionCtx) {
  cb.installEdgeshark();
}

function handleUninstallEdgeshark({ cb }: ActionCtx) {
  cb.uninstallEdgeshark();
}

function handleKillWiresharkVnc({ cb }: ActionCtx) {
  cb.killAllWiresharkVNC();
}

function handleManageImpairments({ cb }: ActionCtx) {
  cb.addToast(
    "Select one of the node's links on the canvas and use the link editor's impairment fields (delay/jitter/loss/rate/corruption).",
    "info"
  );
}

function makeNodeCopyHandler(field: "name" | "containerName" | "mgmtIp" | "kind" | "image") {
  return ({ cb, item }: ActionCtx) => {
    const value = field === "name" ? item?.name || item?.label : item?.[field];
    if (typeof value === "string" && value) {
      void navigator.clipboard.writeText(value).then(
        () => cb.addToast(`Copied: ${value}`, "success"),
        () => cb.addToast("Clipboard write failed", "error")
      );
    } else {
      cb.addToast("Nothing to copy for this node", "warning");
    }
  };
}

function makeNetlabLifecycleHandler(
  action: "netlabInitial" | "netlabCreateConfigs" | "netlabRestart" | "netlabValidate" | "netlabCollect"
) {
  return async ({ cb, topoRef }: ActionCtx) => {
    if (!topoRef) return;
    const sid = await resolveSession(cb, topoRef);
    if (sid) await cb[action](sid);
  };
}

// Dispatch table keyed by exact commandId. Every id below is enumerated
// (rather than matched via startsWith) so this stays a flat lookup — that's
// what keeps executeAction itself down to a single branch instead of a long
// if/else chain.
const ACTION_HANDLERS: Record<string, (ctx: ActionCtx) => void | Promise<void>> = {
  "containerlab.lab.graph.topoViewer": handleOpenTopoViewer,
  "containerlab.editor.topoViewerEditor.open": handleOpenTopoViewer,
  "containerlab.lab.graph.drawio.interactive": handleDrawioInteractive,
  "containerlab.lab.graph.drawio.horizontal": makeDrawioExportHandler("horizontal"),
  "containerlab.lab.graph.drawio.vertical": makeDrawioExportHandler("vertical"),
  "containerlab.lab.graph.netlabSvg.interactive": makeNetlabSvgGraphHandler("interactive"),
  "containerlab.lab.graph.netlabSvg.vertical": makeNetlabSvgGraphHandler("vertical"),
  "containerlab.lab.graph.netlabSvg.horizontal": makeNetlabSvgGraphHandler("horizontal"),
  "containerlab.inspectOneLab": handleInspectOneLab,
  ...Object.fromEntries(Object.entries(FCLI_COMMAND_BY_ID).map(([id, command]) => [id, makeFcliHandler(command)])),
  "containerlab.lab.openFile": handleOpenFile,
  "containerlab.file.open": handleOpenFile,
  // "Redeploy"/"Start Nodes" and their cleanup variants all resolve to the
  // same `netlab up` streamed run as canvas Deploy — mirrors how
  // topoViewerHost.runLifecycle collapses these in createHost.ts.
  "containerlab.lab.deploy": handleDeployLab,
  "containerlab.lab.deploy.cleanup": handleDeployLab,
  "containerlab.lab.redeploy": handleDeployLab,
  "containerlab.lab.redeploy.cleanup": handleDeployLab,
  "containerlab.lab.start": handleDeployLab,
  // "Destroy (Cleanup)"/"Stop Nodes" all resolve to the same `netlab down`
  // run as canvas Destroy.
  "containerlab.lab.destroy": handleDestroyLab,
  "containerlab.lab.destroy.cleanup": handleDestroyLab,
  "containerlab.lab.stop": handleDestroyLab,
  "containerlab.lab.restart": handleNetlabRestart,
  "containerlab.lab.sshToAllNodes": handleSshToAllNodes,
  "containerlab.lab.copyPath": handleCopyPath,
  "containerlab.editor.topoViewerEditor": handleOpenNewLabDialog,
  "containerlab.file.newFile": handleOpenNewLabDialog,
  "containerlab.openLink": handleOpenLink,
  "containerlab.lab.cloneRepo": handleOpenCloneDialog,
  "netlab.lab.cloneRepo": handleOpenCloneDialog,
  "netlab.workspace.cloneHere": handleCloneHere,
  "netlab.workspace.addToWorkspace": handleAddToWorkspace,
  "netlab.workspace.remove": handleRemoveWorkspace,
  "netlab.examples.browse": handleBrowseExamples,
  "containerlab.file.newFolder": handleNewFolder,
  "containerlab.images.manage": handleManageImages,
  "netlab.labs.running": handleOpenRunningLabs,
  "containerlab.node.ssh": handleNodeShell,
  "containerlab.node.attachShell": handleNodeShell,
  "containerlab.node.telnet": handleNodeShell,
  "containerlab.node.showLogs": handleNodeLogs,
  "containerlab.node.showlogs": handleNodeLogs,
  "containerlab.node.start": makeNodeLifecycleHandler("start"),
  "containerlab.node.stop": makeNodeLifecycleHandler("stop"),
  "containerlab.node.restart": makeNodeLifecycleHandler("restart"),
  "containerlab.node.pause": makeNodeLifecycleHandler("pause"),
  "containerlab.node.unpause": makeNodeLifecycleHandler("unpause"),
  "containerlab.node.save": makeNodeLifecycleHandler("save"),
  "containerlab.install.edgeshark": handleInstallEdgeshark,
  "containerlab.uninstall.edgeshark": handleUninstallEdgeshark,
  "containerlab.capture.killAllWiresharkVNC": handleKillWiresharkVnc,
  "containerlab.node.manageImpairments": handleManageImpairments,
  "containerlab.node.copyName": makeNodeCopyHandler("name"),
  "containerlab.node.copyID": makeNodeCopyHandler("containerName"),
  "containerlab.node.copyIPv4Address": makeNodeCopyHandler("mgmtIp"),
  "containerlab.node.copyKind": makeNodeCopyHandler("kind"),
  "containerlab.node.copyImage": makeNodeCopyHandler("image"),
  "netlab.lab.initial": makeNetlabLifecycleHandler("netlabInitial"),
  "netlab.lab.create-configs": makeNetlabLifecycleHandler("netlabCreateConfigs"),
  "netlab.lab.restart": makeNetlabLifecycleHandler("netlabRestart"),
  "netlab.lab.validate": makeNetlabLifecycleHandler("netlabValidate"),
  "netlab.lab.collect": makeNetlabLifecycleHandler("netlabCollect")
};

export function useExplorerController({
  explorerSubscribers,
  labFilesRef,
  runningLabsStatusRef,
  workspacesRef,
  labFiles,
  runningLabsStatus,
  workspaces,
  callbacks
}: Options) {
  const explorerControllerRef = useRef<ReturnType<typeof createExplorerController> | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const explorerDataSignature = useMemo(
    () => buildExplorerDataSignature(labFiles, runningLabsStatus, workspaces),
    [labFiles, runningLabsStatus, workspaces]
  );

  const publish = useMemo(() => (message: ExplorerIncomingMessage) => {
    let outgoing = message;
    if (message.command === "snapshot") {
      const localLabsSection = message.sections.find((s) => s.id === "localLabs");
      const localLabToolbarActions = (localLabsSection?.toolbarActions ?? []).filter((a) =>
        a?.commandId === "containerlab.editor.topoViewerEditor" ||
        a?.commandId === "containerlab.lab.cloneRepo"
      );
      outgoing = {
        ...message,
        sections: message.sections.flatMap((section) => {
          if (section.id === "runningLabs") {
            return [{
              ...section,
              label: "Endpoints",
              count: 1,
              appearance: "bareTree" as const,
              toolbarActions: [...(section.toolbarActions ?? []), ...localLabToolbarActions]
            }];
          }
          if (section.id === "localLabs") return [];
          return [section];
        })
      };
    }
    explorerSubscribers.current?.forEach((handler) => handler(outgoing));
  }, [explorerSubscribers]);

  const explorerController = useMemo(() => {
    const controller = createExplorerController({
      initialFilterText: "",
      initialUiState: readPersistedExplorerUiState(),
      debounceMs: 90,
      publish,
      // Rebuild the snapshot when fileExplorer expansion changes: children of
      // file tree nodes are only resolved for expanded ids, so without this
      // the tree stays empty no matter how often the user clicks.
      refreshOnUiStateChanged: (prev: ExplorerUiState, next: ExplorerUiState) =>
        JSON.stringify(prev?.expandedBySection?.fileExplorer ?? []) !==
        JSON.stringify(next?.expandedBySection?.fileExplorer ?? []),
      getSnapshotOptions: (): ExplorerSnapshotOptions => ({
        hideNonOwnedLabs: false,
        // Browser capture is launched from the topology canvas through the
        // host callback. The Explorer's "local capture" command belongs to
        // the VS Code extension host and is not available here.
        isLocalCaptureAllowed: false,
        expandedBySection:
          explorerControllerRef.current?.getUiState()?.expandedBySection ??
          readPersistedExplorerUiState()?.expandedBySection,
        sectionOrder: ["runningLabs", "localLabs", "fileExplorer", "helpFeedback"],
        hiddenCommandIds: [
          "containerlab.lab.deploy.specificFile",
          // Containerlab multi-user feature: filters running labs by `clab-owner`
          // container label. netlab has no per-user owner concept (status --all
          // lists all netlab-managed labs with no owner field), so the toggle is
          // a no-op here — hide the button rather than leave it dead.
          "containerlab.treeView.runningLabs.hideNonOwnedLabs",
          "containerlab.treeView.runningLabs.showNonOwnedLabs",
          // File-explorer built-ins we don't implement yet — keep the menu to
          // the netlab-supported actions (New Folder + our contributed ones).
          "containerlab.file.newFile",
          "containerlab.file.rename",
          "containerlab.file.delete",
          "containerlab.file.copyPath",
          // These are VS Code/remote-endpoint host commands. Keep them out of
          // the web adapter until each has a real backend implementation.
          "containerlab.set.sessionHostname",
          "containerlab.endpoint.reconnect",
          "containerlab.endpoint.remove",
          "containerlab.endpoint.copyUrl",
          // Replaced by the netlab-aware manager (normal cleanup, forced
          // cleanup and stale-record repair).
          "containerlab.inspectAll",
          "containerlab.lab.apply",
          "containerlab.lab.addToWorkspace",
          "containerlab.lab.toggleFavorite",
          "containerlab.lab.openFolderInNewWindow",
          "containerlab.lab.delete",
          "containerlab.lab.fcli.custom",
          // No backend support yet: per-lab config save-all, and the
          // gotty/sshx terminal-sharing tunnels. Hide rather than leave a menu
          // item that silently does nothing when clicked.
          "containerlab.lab.save",
          "containerlab.lab.sshx.attach",
          "containerlab.lab.sshx.copyLink",
          "containerlab.lab.sshx.detach",
          "containerlab.lab.sshx.reattach",
          "containerlab.lab.gotty.attach",
          "containerlab.lab.gotty.copyLink",
          "containerlab.lab.gotty.detach",
          "containerlab.lab.gotty.reattach"
        ],
        commandMetadata: {
          // Workspace/repo actions folded into the file explorer (matches the
          // containerlab-app workflow): per-node context actions on workspace
          // roots, plus section toolbar buttons.
          contributedFileActions: [
            { commandId: "netlab.workspace.cloneHere", contextValues: ["containerlabFileExplorerRoot"], label: "Clone Repo Here…" },
            { commandId: "netlab.workspace.remove", contextValues: ["containerlabFileExplorerRoot"], label: "Remove From Workspace", destructive: true }
          ],
          // clab-ui's built-in `containerlab.lab.graph.drawio.{horizontal,vertical}`
          // now run the real containerlab `--drawio` export (via clab-io-draw)
          // their labels already promise. netlab's own SVG graph (`netlab
          // graph`, via graphviz/d2) is a distinct, netlab-specific feature —
          // added here as extra items in the same Graph section rather than
          // hijacking the draw.io commands the way this used to work.
          // Both need the lab deployed: draw.io needs the containerlab-generated
          // clab.yml, netlab's SVG graph just needs a topology to graph (works
          // pre-deploy too, so it's also offered on undeployed labs).
          //
          // Command IDs are namespaced under "containerlab.lab.graph." (not
          // "netlab.lab...") on purpose: clab-ui buckets context-menu items
          // into its "Graph" submenu with a hardcoded
          // `commandId.startsWith("containerlab.lab.graph.")` rule (see the
          // vendored ACTION_GROUP_RULES in chunk-SCQAOR7K.js) — any other
          // prefix falls into the catch-all "Other" group instead of sitting
          // next to the draw.io items.
          contributedLabActions: [
            { commandId: "containerlab.lab.graph.netlabSvg.vertical", contextValues: ["containerlabLabDeployed", "containerlabLabUndeployed"], label: "Graph (netlab SVG, Vertical)" },
            { commandId: "containerlab.lab.graph.netlabSvg.horizontal", contextValues: ["containerlabLabDeployed", "containerlabLabUndeployed"], label: "Graph (netlab SVG, Horizontal)" },
            { commandId: "containerlab.lab.graph.netlabSvg.interactive", contextValues: ["containerlabLabDeployed", "containerlabLabUndeployed"], label: "Graph (netlab SVG, Interactive)" }
          ],
          contributedToolbarActions: {
            runningLabs: [
              { commandId: "netlab.labs.running", label: "Manage running labs…" }
            ],
            fileExplorer: [
              { commandId: "netlab.workspace.addToWorkspace", label: "Add Folder to Workspace…" },
              { commandId: "netlab.lab.cloneRepo", label: "Clone Repository…" },
              { commandId: "netlab.examples.browse", label: "Browse Example Labs…" }
            ]
          },
          commandLabels: new Map([
            ["netlab.lab.initial", "Netlab Initial (Ansible Config Deploy)"],
            ["netlab.lab.create-configs", "Netlab Create (Generate configs)"],
            ["netlab.lab.restart", "Netlab Restart"],
            ["netlab.lab.validate", "Netlab Validate (Run tests)"],
            ["netlab.lab.collect", "Netlab Collect (Gather configs)"],
            ["netlab.workspace.addToWorkspace", "Add Folder to Workspace…"],
            ["netlab.workspace.cloneHere", "Clone Repo Here…"],
            ["netlab.workspace.remove", "Remove From Workspace"],
            ["netlab.lab.cloneRepo", "Clone Repository…"],
            ["netlab.examples.browse", "Browse Example Labs…"],
            ["netlab.labs.running", "Manage running labs…"],
            ["containerlab.file.newFolder", "New Folder…"]
          ])
        }
      }),
      // clab-ui's real provider interfaces (RunningLabTreeDataProvider etc.) are
      // internal, unexported types — our providers implement the subset
      // (getChildren) the explorer snapshot builder actually calls.
      buildProviders: async () => ({
        runningProvider: buildRunningProvider(runningLabsStatusRef, labFilesRef),
        localProvider: buildFileProvider(labFilesRef, workspacesRef),
        fileProvider: buildFileProvider(labFilesRef, workspacesRef),
        helpProvider: buildHelpProvider()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
      } as any),
      executeAction: async (binding: ExplorerActionInvocation) => {
        const cb = callbacksRef.current;
        const { commandId, args } = binding;
        const item = args[0] as ActionItem | undefined;
        const handler = ACTION_HANDLERS[commandId];
        if (handler) {
          await handler({ cb, item, topoRef: item?.topologyRef, args, runningLabsStatusRef });
        }
      }
    });
    return controller;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the ref in sync with the *committed* controller instance — and only
  // from an effect. Assigning it during render (inside the useMemo factory)
  // broke under StrictMode: the factory runs twice, React commits one instance
  // but the ref pointed at the other — so snapshots were published by one
  // controller while clicks were dispatched to another, yielding
  // "Action is no longer available".
  useEffect(() => {
    explorerControllerRef.current = explorerController;
  }, [explorerController]);

  useEffect(() => {
    explorerController.connect();
    return () => { explorerController.dispose(); };
  }, [explorerController]);

  useEffect(() => {
    explorerController.scheduleSnapshot(0);
  }, [explorerController, explorerDataSignature]);

  // Snapshots otherwise only rebuild when lab files / status / workspaces
  // change; expanded file-tree directories are resolved per rebuild (cached
  // in fileProvider), so rebuild periodically too — otherwise files added or
  // deleted on disk inside an expanded folder never show up until some
  // unrelated data change happens. Keep this interval below fileProvider's
  // DIR_TTL_MS but not by much — the cache only protects against a rebuild
  // storm if it can actually survive to the next one.
  useEffect(() => {
    const timer = window.setInterval(() => explorerController.scheduleSnapshot(0), 15000);
    return () => window.clearInterval(timer);
  }, [explorerController]);

  return {
    explorerController,
    explorerControllerRef,
    // The bridge must close over the committed `explorerController` directly.
    // Going through explorerControllerRef here re-introduced the two-instance
    // split under StrictMode (see comment above).
    explorerBridge: useMemo(() => ({
      connect() { explorerController.connect(); },
      setFilter(filterText: string) { explorerController.setFilter(filterText); },
      invokeAction(actionRef: string) {
        explorerController.invokeAction(actionRef);
        closeExplorerTransientUi();
      },
      persistUiState(state: ExplorerUiState) {
        persistExplorerUiState(state);
        explorerController.persistUiState(state);
      },
      subscribe(handler: (message: ExplorerIncomingMessage) => void) {
        explorerSubscribers.current?.add(handler);
        return () => { explorerSubscribers.current?.delete(handler); };
      }
    }), [explorerController, explorerSubscribers])
  };
}
