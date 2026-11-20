// Barrel for the hooks/app-local modules useAppController depends on. Keeping
// this as a single import site in useAppController.ts is what keeps that file
// under the import(max-dependencies) budget — each dependency still lives in
// its own file, this just re-exports them.
export { useAppData } from "../hooks/useAppData";
export { usePortalInjection } from "../hooks/usePortalInjection";
export { useDeployLogCopyButton } from "../hooks/useDeployLogCopyButton";
export { useTabManager } from "../hooks/useTabManager";
export { useLabLifecycle, setLifecycleActions, type ValidationIssue, type DeployDecision, type LifecycleCompletion, type LifecycleModalAction } from "../hooks/useLabLifecycle";
export { useExplorerController, type ExplorerIncomingMessage } from "../hooks/useExplorerController";
export { useSessionDock, type SessionTab } from "../hooks/useSessionDock";
export { useBrowserNotifications } from "../hooks/useBrowserNotifications";
export { useNetlabLenses } from "../hooks/useNetlabLenses";
export { useRightPanelTabMemory } from "../hooks/useRightPanelTabMemory";
export { useAutoOpenComposerTab, useSelectPanelTabOnOpen } from "../hooks/useAutoOpenComposerTab";
export { netlabNodeEditorTabs } from "./netlabNodeEditorTabs";
export { useCustomPaletteTabs } from "./useCustomPaletteTabs";
export { useRenderDeployMenuItems } from "./useRenderDeployMenuItems";
export { publishRuntimeContainers } from "../host/runtimeStore";
export { openConfigsDialog } from "../host/configsDialogStore";
export { openMonitoringDialog } from "../host/monitoringDialogStore";
export { openToolsDialog } from "../host/toolsDialogStore";
export { registerFileOpener } from "../host/fileOpenStore";
export { registerAgentsPanelOpener } from "../host/agentInput";
export { registerWebTabOpener } from "../host/webTabStore";
export { openPanelTab } from "../hooks/useRightPanelTabMemory";
export { requestCopyLab } from "../host/copyLabStore";
export { setSketchClient } from "../host/sketchStore";
export { createApiClabUiHost, type AppClabUiHost } from "../host/createHost";
export { createDemoClabUiHost } from "../host/createDemoHost";
export { clearDirCache } from "../host/fileProvider";
export { type DeploymentProgress } from "../components/CanvasDeploymentProgress";
export { readLastOpenLabPath, readOpenTabSession, resolveOpenLabTab } from "../lifecycle/persistence";
export { loadUserState } from "../api/userState";
export { rememberAgents } from "../components/agents/agentNames";
export { persistAgentsPanelOpen, readAgentsPanelOpen } from "../components/agents/preferences";
export { useProposalWatcher } from "../components/agents/proposalsStore";
export { useIsPhone } from "../hooks/useIsPhone";
export { type SettingsTab } from "../components/dialogs/SettingsDialog";
export type { TopologyRef } from "../hooks/useTabManager";
export { runningLabMatches } from "../host/runningMatch";
export { useAgentGuide } from "./useAgentGuide";
