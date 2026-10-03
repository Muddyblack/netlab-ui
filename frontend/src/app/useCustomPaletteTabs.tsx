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
import { LensesPanel } from "../components/lenses/LensesPanel";

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
}: UseCustomPaletteTabsOptions): CustomPaletteTab[] {
  const waiting = pendingProposals(useProposals().proposals).length;
  return useMemo<CustomPaletteTab[]>(() => {
    if (!sessionId) return [];
    const tabs: CustomPaletteTab[] = [];
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
    // The AI agents tab only exists in the strip while toggled on from the
    // toolbar button — clab-ui owns which palette tab is active and
    // exposes no way to select one from outside, so this is the only lever
    // the host has to make the button feel like it "opens" the panel.
    if (assistantCapabilities && assistantOpen) {
      tabs.push({
        id: "netlab-assistant",
        label: waiting ? `AI agents (${waiting})` : "AI agents",
        render: () => (
          <AgentsPanel
            capabilities={assistantCapabilities}
            sessionId={sessionId}
            onApplied={handlePluginPanelChanged}
            onStartAgent={openAgentTerminal}
          />
        )
      });
    }
    return tabs;
  }, [sessionId, activeUnitPath, activeTabId, multiserverEnabled, assistantCapabilities, assistantOpen, waiting, handlePluginPanelChanged, refreshCanvas, netlabLenses, validationIssues, addToast, handleRerunDeployment, openAgentTerminal]);
}
