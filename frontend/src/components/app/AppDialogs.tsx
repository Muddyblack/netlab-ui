import type { MutableRefObject } from "react";
import { api, type AssistantCapabilities, type DeployDiffResult, type LabFileEntry } from "../../api/client";
import type { RuntimeSnackbarState, StartupState, WorkspaceEntry } from "../../lifecycle/types";
import type { AppThemeMode } from "../../theme";
import type { createClabUiRuntime, ClabUiRuntime } from "@srl-labs/clab-ui/host";
import { ContainerlabImageManagerDialog } from "@srl-labs/clab-ui/image-manager";
import type { AppClabUiHost } from "../../host/createHost";
import type { TopologyRef } from "../../hooks/useTabManager";
import type { ValidationIssue } from "../../hooks/useLabLifecycle";
import type { UnitInfo } from "../../panels/units-dock/types";
import { SettingsDialog, type SettingsTab } from "../dialogs/SettingsDialog";
import { DeployDiffDialog } from "../DeployDiffDialog";
import { QuickOpenDialog } from "../QuickOpenDialog";
import { CommandOutputDialog } from "../dialogs/CommandOutputDialog";

type Toast = (message: string, severity?: RuntimeSnackbarState["severity"]) => void;

interface AppDialogsProps {
  // Settings
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  themeMode: AppThemeMode;
  handleThemeChange: (mode: AppThemeMode) => void;
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | "unavailable";
  toggleNotifications: () => Promise<void>;
  workspaces: WorkspaceEntry[];
  setWorkspaces: (workspaces: WorkspaceEntry[]) => void;
  fetchFiles: () => Promise<void>;
  checkStartup: () => Promise<void> | void;
  assistantCapabilities: AssistantCapabilities | null;
  assistantSettingsProviderId: string | undefined;
  refreshAssistantCapabilities: () => void;
  startup: StartupState;

  // Deploy diff
  deployDiff: DeployDiffResult | null;
  deployValidationIssues: ValidationIssue[];
  setDeployDiff: (diff: DeployDiffResult | null) => void;
  setDeployValidationIssues: (issues: ValidationIssue[]) => void;
  deployDecisionRef: MutableRefObject<((proceed: boolean) => void) | null>;

  // Quick open
  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  sessionId: string | null;
  isTopologyLocked: boolean;
  labFiles: LabFileEntry[];
  quickActions: Array<{ id: string; label: string; detail: string; run: () => void }>;
  handleOpenLab: (topoRef: TopologyRef, opts?: { fitView?: boolean }) => Promise<void>;
  addToast: Toast;
  host: AppClabUiHost;
  refreshCanvas: () => void;

  // Image manager
  imageManagerOpen: boolean;
  setImageManagerOpen: (open: boolean) => void;
  runtime: ReturnType<typeof createClabUiRuntime> | null;

  // Command output (netlab inspect)
  inspectOutput: { loading: boolean; output: string | null; error: string | null } | null;
  setInspectOutput: (value: { loading: boolean; output: string | null; error: string | null } | null) => void;
}

export function AppDialogs({
  settingsOpen,
  setSettingsOpen,
  settingsTab,
  themeMode,
  handleThemeChange,
  notificationsSupported,
  notificationsEnabled,
  notificationPermission,
  toggleNotifications,
  workspaces,
  setWorkspaces,
  fetchFiles,
  checkStartup,
  assistantCapabilities,
  assistantSettingsProviderId,
  refreshAssistantCapabilities,
  startup,
  deployDiff,
  deployValidationIssues,
  setDeployDiff,
  setDeployValidationIssues,
  deployDecisionRef,
  quickOpen,
  setQuickOpen,
  sessionId,
  isTopologyLocked,
  labFiles,
  quickActions,
  handleOpenLab,
  addToast,
  host,
  refreshCanvas,
  imageManagerOpen,
  setImageManagerOpen,
  runtime,
  inspectOutput,
  setInspectOutput
}: AppDialogsProps) {
  return (
    <>
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
        assistantProviders={assistantCapabilities?.providers ?? []}
        assistantInitialProviderId={assistantSettingsProviderId}
        onAssistantChanged={refreshAssistantCapabilities}
        health={startup.health}
      />

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
        onOpenUnit={(unit: UnitInfo) => void handleOpenLab({ topologyId: `standalone:local::${unit.path}`, labName: unit.name, yamlPath: unit.path, source: "standalone" }, { fitView: true })}
        onInstantiateUnit={(unit: UnitInfo) => {
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

      {runtime && <ContainerlabImageManagerDialog open={imageManagerOpen} runtime={runtime as ClabUiRuntime} onClose={() => setImageManagerOpen(false)} endpointOptions={[{ id: "local", label: "local" }]} />}

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
    </>
  );
}
