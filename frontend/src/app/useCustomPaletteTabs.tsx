import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { CustomPaletteTab } from "@srl-labs/clab-ui/host";
import type { AssistantCapabilities } from "../api/client";
import type { NetlabLensesState } from "../hooks/useNetlabLenses";
import type { ValidationIssue } from "../hooks/useLabLifecycle";
import { DEMO_MODE } from "../lifecycle/types";
import { PluginsPanel } from "../panels/Plugins";
import { UnitComposer } from "../panels/UnitComposer";
import { GroupsPanel } from "../panels/Groups";
import { WorkersPanel } from "../panels/Workers";
import { AssistantPanel } from "../panels/assistant/AssistantPanel";
import { LensesPanel } from "../components/lenses/LensesPanel";
import type { SettingsTab } from "../components/dialogs/SettingsDialog";

type Toast = (message: string, severity?: "info" | "success" | "warning" | "error") => void;

interface UseCustomPaletteTabsOptions {
  sessionId: string | null;
  activeUnitPath: string | null;
  activeTabId: string | null;
  multiserverEnabled: boolean;
  assistantCapabilities: AssistantCapabilities | null;
  assistantOpen: boolean;
  handleAssistantPopOut: () => void;
  handlePluginPanelChanged: () => Promise<void>;
  refreshCanvas: () => void;
  netlabLenses: NetlabLensesState;
  validationIssues: ValidationIssue[];
  addToast: Toast;
  handleRerunDeployment: (action: string) => void;
  refreshAssistantCapabilities: () => void;
  setAssistantOpen: Dispatch<SetStateAction<boolean>>;
  setAssistantSettingsProviderId: (providerId: string | undefined) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setSettingsOpen: (open: boolean) => void;
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
  handleAssistantPopOut,
  handlePluginPanelChanged,
  refreshCanvas,
  netlabLenses,
  validationIssues,
  addToast,
  handleRerunDeployment,
  refreshAssistantCapabilities,
  setAssistantOpen,
  setAssistantSettingsProviderId,
  setSettingsTab,
  setSettingsOpen,
}: UseCustomPaletteTabsOptions): CustomPaletteTab[] {
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
              setSettingsTab("assistant");
              setSettingsOpen(true);
            }}
            onCapabilitiesChanged={refreshAssistantCapabilities}
          />
        )
      });
    }
    return tabs;
  }, [sessionId, activeUnitPath, activeTabId, multiserverEnabled, assistantCapabilities, assistantOpen, handleAssistantPopOut, handlePluginPanelChanged, refreshCanvas, netlabLenses, validationIssues, addToast, handleRerunDeployment, refreshAssistantCapabilities, setAssistantOpen, setAssistantSettingsProviderId, setSettingsTab, setSettingsOpen]);
}
