import { Box, GlobalStyles } from "@mui/material";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@containerlab/clab-ui/styles/global.css";
import "highlight.js/styles/github-dark.css";

import type { OpenWebTab } from "./lifecycle/types";
import { LabHints } from "./components/LabHints";
import { AppTheme } from "./AppTheme";
import { StartupGate } from "./components/StartupGate";
import { AppToolbarActions } from "./app/AppToolbarActions";
import { AppCanvasArea } from "./components/app/AppCanvasArea";
import { AppSidebarPortals } from "./components/app/AppSidebarPortals";
import { AppCanvasOverlays } from "./components/app/AppCanvasOverlays";
import { AppDialogs } from "./components/app/AppDialogs";
import { AppSecondaryDialogs } from "./components/app/AppSecondaryDialogs";
import { useAppController } from "./app/useAppController";

/**
 * Phone-sized screens (below MUI's `sm`). Most dialogs and tab bars here and in clab-ui are sized for a desktop, so
 * instead of patching each one: dialogs use nearly the whole screen, and a row of tabs that does not fit scrolls
 * sideways rather than being cut off.
 */
const PHONE_STYLES = {
  "@media (max-width: 599.95px)": {
    ".MuiDialog-paper:not(.MuiDialog-paperFullScreen)": {
      margin: "8px !important",
      width: "calc(100% - 16px) !important",
      maxWidth: "none !important",
      maxHeight: "calc(100% - 16px) !important"
    },
    // clab-ui's panel toggles are 20px wide: too small for a finger.
    "[data-testid='panel-toggle-btn']": { width: "32px !important", height: "64px !important" },
    // The lab toolbar has ~20 buttons (800px). Keep what a phone is for (deploy, lock, fit, find node, settings)
    // and drop editing and desktop-only ones, so it fits a 390px screen without cut-off icons.
    [[
      "navbar-lab-settings", "navbar-undo", "navbar-redo", "navbar-bulk-link", "navbar-split-view", "navbar-layout",
      "navbar-link-labels", "navbar-capture", "navbar-shortcuts", "navbar-shortcut-display"
    ].map((id) => `[data-testid='topoviewer-app'] > .MuiAppBar-root [data-testid='${id}']`).join(", ") +
      ", [data-testid='topoviewer-app'] > .MuiAppBar-root .MuiDivider-root" +
      ", [data-testid='topoviewer-app'] > .MuiAppBar-root [aria-label*='AI agents']" +
      ", [data-testid='topoviewer-app'] > .MuiAppBar-root [aria-label*='system notifications']" +
      // Quick open is the Ctrl+P search; on a phone the explorer's filter does that, and its magnifier sat next to
      // find-node's identical one.
      ", [data-testid='topoviewer-app'] > .MuiAppBar-root [aria-label='Quick open']"]: { display: "none !important" },
    // Whatever still does not fit (a long lab name) scrolls sideways instead of pushing settings off-screen.
    "[data-testid='topoviewer-app'] > .MuiAppBar-root .MuiToolbar-root": {
      overflowX: "auto",
      overflowY: "hidden",
      scrollbarWidth: "none",
      "&::-webkit-scrollbar": { display: "none" }
    },
    ".MuiTabs-scroller": { overflowX: "auto !important", scrollbarWidth: "none" },
    ".MuiTabs-scroller::-webkit-scrollbar": { display: "none" }
  }
} as const;

/**
 * Touch screens have no hover, and clab-ui's explorer shows a row's "⋮" menu and a section's buttons (add folder,
 * example labs) only on hover: on a phone or tablet they could not be reached at all. Show them, finger-sized.
 */
const TOUCH_STYLES = {
  "@media (hover: none)": {
    ".explorer-node-actions-trigger, .explorer-section-hover-actions": {
      opacity: "1 !important",
      pointerEvents: "auto !important"
    },
    ".explorer-node-actions-trigger": { width: "28px !important", height: "28px !important" }
  }
} as const;

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
      onQuickOpen={() => c.setQuickOpen(true)}
      assistantOpen={c.assistantOpen}
      assistantStatus={c.assistantStatus}
      hasLab={Boolean(c.sessionId)}
      onToggleAssistant={() => {
        if (c.assistantStatus === "connecting") c.retryAssistant(); // do not wait for the next scheduled try
        c.setAssistantOpen((open) => !open);
      }}
    />
  );

  return (
    <AppTheme>
      <GlobalStyles styles={PHONE_STYLES} />
      <GlobalStyles styles={TOUCH_STYLES} />
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
            activeFileTab={c.activeFileTab ?? c.activeWebTab}
            portalContainer={c.portalContainer}
            labFiles={c.labFiles}
            handleOpenLab={c.handleOpenLab}
            onCreateWithAi={c.assistantStatus === "ready" ? c.openNewLabWithAi : undefined}
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
            isPhone={c.isPhone}
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
            activeWebTab={c.activeWebTab}
            webTabs={c.openTabs.filter((t): t is OpenWebTab => t.kind === "web")}
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

          <LabHints
            sessionId={c.sessionId}
            openTabs={c.openTabs}
            activeTabId={c.activeTabId}
            workspaces={c.workspaces}
            setWorkspaces={c.setWorkspaces}
            isLocked={c.isTopologyLocked}
            openLab={c.handleOpenLab as (ref: never) => unknown}
            toast={c.addToast}
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
            startup={c.startup}
            deployDiff={c.deployDiff}
            deployValidationIssues={c.deployValidationIssues}
            deployTargetLab={c.deployTargetLab}
            setDeployDiff={c.setDeployDiff}
            setDeployValidationIssues={c.setDeployValidationIssues}
            deployDecisionRef={c.deployDecisionRef}
            deployPlan={c.deployPlan}
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
            openEnvironmentSettings={() => { c.setSettingsTab("environment"); c.setSettingsOpen(true); }}
          />
        </Box>
      )}
    </AppTheme>
  );
}
