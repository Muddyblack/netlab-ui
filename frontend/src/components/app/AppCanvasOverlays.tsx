import { Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import { DEMO_MODE, type OpenFileTab, type RuntimeSnackbarState } from "../../lifecycle/types";
import type { TopologyRef } from "../../hooks/useTabManager";
import type { ValidationIssue } from "../../hooks/useLabLifecycle";
import type { SessionTab, useSessionDock } from "../../hooks/useSessionDock";
import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import type { AppThemeMode } from "../../theme";
import { CanvasValidationSummary } from "../CanvasValidationSummary";
import { CanvasDeploymentProgress, type DeploymentProgress } from "../CanvasDeploymentProgress";
import { UnitsDock } from "../../panels/UnitsDock";
import { NetlabLenses } from "../lenses/NetlabLenses";
import type { UnitInfo } from "../../panels/units-dock/types";

const FileEditorTabPanel = lazy(() =>
  import("../FileEditorTabPanel").then((m) => ({ default: m.FileEditorTabPanel }))
);
const SessionDock = lazy(() => import("../../terminal/SessionDock").then((m) => ({ default: m.SessionDock })));

interface AppCanvasOverlaysProps {
  portalContainer: Element | null;
  activeFileTab: OpenFileTab | null;
  themeMode: AppThemeMode;
  handleFileTabChange: (tabId: string, content: string) => void;
  handleCloseLab: (id: string) => Promise<void>;
  handleFileTabSave: (id: string) => Promise<void>;
  handleFileTabReload: (tabId: string) => void;
  sessionId: string | null;
  validationIssues: ValidationIssue[];
  setValidationIssues: (issues: ValidationIssue[]) => void;
  deploymentProgress: DeploymentProgress | null;
  activeTabId: string | null;
  refreshCanvas: () => void;
  addToast: (message: string, severity?: RuntimeSnackbarState["severity"]) => void;
  handleOpenLab: (topoRef: TopologyRef, opts?: { fitView?: boolean }) => Promise<void>;
  netlabLenses: NetlabLensesState;
  sessionDock: ReturnType<typeof useSessionDock>;
  openShell: (node: string) => void;
  handleSessionPopOut: (tab: SessionTab) => void;
}

export function AppCanvasOverlays({
  portalContainer,
  activeFileTab,
  themeMode,
  handleFileTabChange,
  handleCloseLab,
  handleFileTabSave,
  handleFileTabReload,
  sessionId,
  validationIssues,
  setValidationIssues,
  deploymentProgress,
  activeTabId,
  refreshCanvas,
  addToast,
  handleOpenLab,
  netlabLenses,
  sessionDock,
  openShell,
  handleSessionPopOut
}: AppCanvasOverlaysProps) {
  return (
    <>
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
            onOpenUnit={(unit: UnitInfo) =>
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
    </>
  );
}
