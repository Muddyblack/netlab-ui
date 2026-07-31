// Barrel for the hooks/app-local modules useAppController depends on. Keeping
// this as a single import site in useAppController.ts is what keeps that file
// under the import(max-dependencies) budget — each dependency still lives in
// its own file, this just re-exports them.
export { useAppData } from "../hooks/useAppData";
export { usePortalInjection } from "../hooks/usePortalInjection";
export { useDeployLogCopyButton } from "../hooks/useDeployLogCopyButton";
export { useTabManager } from "../hooks/useTabManager";
export { useLabLifecycle, type ValidationIssue } from "../hooks/useLabLifecycle";
export { useExplorerController, type ExplorerIncomingMessage } from "../hooks/useExplorerController";
export { useSessionDock, type SessionTab } from "../hooks/useSessionDock";
export { useBrowserNotifications } from "../hooks/useBrowserNotifications";
export { useNetlabLenses } from "../hooks/useNetlabLenses";
export { useRightPanelTabMemory } from "../hooks/useRightPanelTabMemory";
export { useAutoOpenComposerTab } from "../hooks/useAutoOpenComposerTab";
export { netlabNodeEditorTabs } from "./netlabNodeEditorTabs";
export { useCustomPaletteTabs } from "./useCustomPaletteTabs";
export { useRenderDeployMenuItems } from "./useRenderDeployMenuItems";
