import { useMemo } from "react";
import type { CustomPaletteTab } from "@containerlab/clab-ui/host";
import type { AssistantCapabilities } from "../api/client";
import type { NetlabLensesState } from "../hooks/useNetlabLenses";
import type { ValidationIssue } from "../hooks/useLabLifecycle";
import { DEMO_MODE } from "../lifecycle/types";
import { PluginsPanel } from "../panels/Plugins";
import { UnitComposer } from "../panels/UnitComposer";
import { GroupsPanel } from "../panels/Groups";
import { WorkersPanel } from "../panels/Workers";
import { AgentsPanel } from "../components/agents/AgentsPanel";
import { pendingProposals, useProposals } from "../components/agents/proposalsStore";
import { MonitoringPanel } from "../components/dialogs/MonitoringDialog";
import { LensesPanel } from "../components/lenses/LensesPanel";
import { PANEL_TAB_LABELS } from "./panelTabLabels";

type Toast = (message: string, severity?: "info" | "success" | "warning" | "error") => void;

interface UseCustomPaletteTabsOptions {
  sessionId: string | null;
  activeUnitPath: string | null;
  activeTabId: string | null;
  multiserverEnabled: boolean;
  assistantCapabilities: AssistantCapabilities | null;
  assistantOpen: boolean;
  handlePluginPanelChanged: () => Promise<void>;
  refreshCanvas: () => void;
  netlabLenses: NetlabLensesState;
  validationIssues: ValidationIssue[];
  addToast: Toast;
  handleRerunDeployment: (action: string) => void;
  openAgentTerminal: (agentId: string, another?: boolean) => string;
  closeAgentTerminal: (node: string) => void;
}

// Leads the tab strip when present — it's the reason you're looking at this
// file, so it shouldn't be buried after the general-purpose tabs.
export function useCustomPaletteTabs({
  sessionId,
  activeUnitPath,
  activeTabId,
  multiserverEnabled,
  assistantCapabilities,
  assistantOpen,
  handlePluginPanelChanged,
  refreshCanvas,
  netlabLenses,
  validationIssues,
  addToast,
  handleRerunDeployment,
  openAgentTerminal,
  closeAgentTerminal,
}: UseCustomPaletteTabsOptions): CustomPaletteTab[] {
  const waiting = pendingProposals(useProposals().proposals).length;
  return useMemo<CustomPaletteTab[]>(() => {
    if (!sessionId) return [];
    const tabs: CustomPaletteTab[] = [];
    if (activeUnitPath) {
      tabs.push({
        id: "netlab-composer",
        label: PANEL_TAB_LABELS.composer,
        render: () => (
          <UnitComposer sessionId={sessionId} unitPath={activeUnitPath} refreshKey={activeTabId ?? undefined} onSaved={refreshCanvas} onToast={addToast} />
        )
      });
    }
    tabs.push({
      id: "netlab-lenses",
      label: PANEL_TAB_LABELS.lenses,
      render: () => <LensesPanel state={netlabLenses} validationIssues={validationIssues} onToast={addToast} onRerunDeployment={handleRerunDeployment} />
    });
    if (!DEMO_MODE) {
      tabs.push(
        { id: "netlab-groups", label: PANEL_TAB_LABELS.groups, render: () => <GroupsPanel sessionId={sessionId} onChanged={refreshCanvas} /> },
        { id: "netlab-plugins", label: PANEL_TAB_LABELS.plugins, render: () => <PluginsPanel sessionId={sessionId} onChanged={handlePluginPanelChanged} /> }
      );
    }
    // Always present (the panel has its own on/off switch): a tab that comes and goes with an async
    // "is it on" check makes the strip jump to another tab whenever the check is pending.
    if (!DEMO_MODE) {
      tabs.push({ id: "netlab-monitoring", label: PANEL_TAB_LABELS.monitoring, render: () => <MonitoringPanel sessionId={sessionId} /> });
    }
    if (multiserverEnabled) {
      tabs.push({ id: "netlab-workers", label: PANEL_TAB_LABELS.workers, render: () => <WorkersPanel sessionId={sessionId} onChanged={handlePluginPanelChanged} /> });
    }
    // The AI agents tab only exists in the strip while toggled on from the
    // toolbar button — clab-ui owns which palette tab is active and
    // exposes no way to select one from outside, so this is the only lever
    // the host has to make the button feel like it "opens" the panel.
    if (assistantCapabilities && assistantOpen) {
      tabs.push({
        id: "netlab-assistant",
        label: waiting ? `${PANEL_TAB_LABELS.agents} (${waiting})` : PANEL_TAB_LABELS.agents,
        render: () => (
          <AgentsPanel
            capabilities={assistantCapabilities}
            sessionId={sessionId}
            onApplied={handlePluginPanelChanged}
            onStartAgent={openAgentTerminal}
            onCloseAgent={closeAgentTerminal}
          />
        )
      });
    }
    return tabs;
  }, [sessionId, activeUnitPath, activeTabId, multiserverEnabled, assistantCapabilities, assistantOpen, waiting, handlePluginPanelChanged, refreshCanvas, netlabLenses, validationIssues, addToast, handleRerunDeployment, openAgentTerminal, closeAgentTerminal]);
}
