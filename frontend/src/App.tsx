import { MuiThemeProvider } from "@srl-labs/clab-ui/theme";
import { Box } from "@mui/material";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@srl-labs/clab-ui/styles/global.css";
import "highlight.js/styles/github-dark.css";

import { StartupGate } from "./components/StartupGate";
import { AppToolbarActions } from "./app/AppToolbarActions";
import { AppCanvasArea } from "./components/app/AppCanvasArea";
import { AppSidebarPortals } from "./components/app/AppSidebarPortals";
import { AppCanvasOverlays } from "./components/app/AppCanvasOverlays";
import { AppDialogs } from "./components/app/AppDialogs";
import { AppSecondaryDialogs } from "./components/app/AppSecondaryDialogs";
import { useAppController } from "./app/useAppController";

export default function App() {
  const c = useAppController();

  const toolbarActions = (
    <AppToolbarActions
      notificationsSupported={c.notificationsSupported}
      notificationsEnabled={c.notificationsEnabled}
      notificationPermission={c.notificationPermission}
      onToggleNotifications={() => void c.toggleNotifications()}
      onOpenSettings={() => {
        c.setSettingsTab("general");
        c.setSettingsOpen(true);
      }}
      assistantAvailable={Boolean(c.assistantCapabilities && c.sessionId)}
      assistantHasProvider={Boolean(c.assistantCapabilities?.providers?.some((p) => p.available))}
      assistantOpen={c.assistantOpen}
      onToggleAssistant={() => c.setAssistantOpen((open) => !open)}
      onSetupAssistant={() => {
        c.setSettingsTab("assistant");
        c.setSettingsOpen(true);
      }}
    />
  );

  return (
    <MuiThemeProvider>
      {c.startup.status !== "ready" ? (
        <StartupGate startup={c.startup} onRetry={c.checkStartup} />
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
            ...(!c.sessionId ? {
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
          <AppCanvasArea
            runtime={c.runtime}
            appRuntime={c.appRuntime}
            sessionId={c.sessionId}
            transformRunning={c.transformRunning}
            activeFileTab={c.activeFileTab}
            portalContainer={c.portalContainer}
            labFiles={c.labFiles}
            handleOpenLab={c.handleOpenLab}
            navbarPortalContainer={c.navbarPortalContainer}
            toolbarActions={toolbarActions}
          />

          <AppSidebarPortals
            sessionId={c.sessionId}
            netlabLinksPaletteContainer={c.netlabLinksPaletteContainer}
            refreshCanvas={c.refreshCanvas}
            addToast={c.addToast}
            leftSidebarToggleContainer={c.leftSidebarToggleContainer}
            isLeftSidebarOpen={c.isLeftSidebarOpen}
            handleToggleLeftSidebar={c.handleToggleLeftSidebar}
            tabBarContainer={c.tabBarContainer}
            openTabs={c.openTabs}
            activeTabId={c.activeTabId}
            handleActivateLabTab={c.handleActivateLabTab}
            handleCloseLab={c.handleCloseLab}
          />

          <AppCanvasOverlays
            portalContainer={c.portalContainer}
            activeFileTab={c.activeFileTab}
            themeMode={c.themeMode}
            handleFileTabChange={c.handleFileTabChange}
            handleCloseLab={c.handleCloseLab}
            handleFileTabSave={c.handleFileTabSave}
            handleFileTabReload={c.handleFileTabReload}
            sessionId={c.sessionId}
            validationIssues={c.validationIssues}
            setValidationIssues={c.setValidationIssues}
            deploymentProgress={c.deploymentProgress}
            activeTabId={c.activeTabId}
            refreshCanvas={c.refreshCanvas}
            addToast={c.addToast}
            handleOpenLab={c.handleOpenLab}
            netlabLenses={c.netlabLenses}
            sessionDock={c.sessionDock}
            openShell={c.openShell}
            handleSessionPopOut={c.handleSessionPopOut}
          />

          <AppDialogs
            settingsOpen={c.settingsOpen}
            setSettingsOpen={c.setSettingsOpen}
            settingsTab={c.settingsTab}
            setSettingsTab={c.setSettingsTab}
            themeMode={c.themeMode}
            handleThemeChange={c.handleThemeChange}
            notificationsSupported={c.notificationsSupported}
            notificationsEnabled={c.notificationsEnabled}
            notificationPermission={c.notificationPermission}
            toggleNotifications={c.toggleNotifications}
            workspaces={c.workspaces}
            setWorkspaces={c.setWorkspaces}
            fetchFiles={c.fetchFiles}
            checkStartup={c.checkStartup}
            assistantCapabilities={c.assistantCapabilities}
            assistantSettingsProviderId={c.assistantSettingsProviderId}
            refreshAssistantCapabilities={c.refreshAssistantCapabilities}
            startup={c.startup}
            deployDiff={c.deployDiff}
            deployValidationIssues={c.deployValidationIssues}
            setDeployDiff={c.setDeployDiff}
            setDeployValidationIssues={c.setDeployValidationIssues}
            deployDecisionRef={c.deployDecisionRef}
            quickOpen={c.quickOpen}
            setQuickOpen={c.setQuickOpen}
            sessionId={c.sessionId}
            isTopologyLocked={c.isTopologyLocked}
            labFiles={c.labFiles}
            quickActions={c.quickActions}
            handleOpenLab={c.handleOpenLab}
            addToast={c.addToast}
            host={c.host}
            refreshCanvas={c.refreshCanvas}
            imageManagerOpen={c.imageManagerOpen}
            setImageManagerOpen={c.setImageManagerOpen}
            runtime={c.runtime}
            inspectOutput={c.inspectOutput}
            setInspectOutput={c.setInspectOutput}
          />

          <AppSecondaryDialogs
            runningLabsOpen={c.runningLabsOpen}
            setRunningLabsOpen={c.setRunningLabsOpen}
            refreshStatus={c.refreshStatus}
            fetchFiles={c.fetchFiles}
            addToast={c.addToast}
            getOrCreateSession={c.getOrCreateSession}
            handleDestroyLab={c.handleDestroyLab}
            setWorkspaces={c.setWorkspaces}
            cloneOpen={c.cloneOpen}
            cloneTarget={c.cloneTarget}
            setCloneOpen={c.setCloneOpen}
            setCloneTarget={c.setCloneTarget}
            folderBrowserOpen={c.folderBrowserOpen}
            setFolderBrowserOpen={c.setFolderBrowserOpen}
            exampleLabsOpen={c.exampleLabsOpen}
            setExampleLabsOpen={c.setExampleLabsOpen}
            newFolderParent={c.newFolderParent}
            setNewFolderParent={c.setNewFolderParent}
            newLabDialogOpen={c.newLabDialogOpen}
            setNewLabDialogOpen={c.setNewLabDialogOpen}
            handleCreateLab={c.handleCreateLab}
            startup={c.startup}
            runtimeSnackbar={c.runtimeSnackbar}
            setRuntimeSnackbar={c.setRuntimeSnackbar}
          />
        </Box>
      )}
    </MuiThemeProvider>
  );
}
