import { useEffect, useMemo, useRef } from "react";

import { api } from "../api/client";
import { AGENT_SPOTLIGHT_LABEL, clearAgentGuide, showAgentGuide } from "../host/agentGuideStore";
import { setSpotlight } from "../host/canvasSpotlight";
import { openMonitoringDialog, type FaultTestPrefill } from "../host/monitoringDialogStore";

/** Palette actions an agent may open to show the user around: they open a dialog
 * or panel, or move the view -- none deploys, writes or changes the lab. */
const GUIDE_ACTIONS = new Set([
  "action:running-labs",
  "action:image-manager",
  "action:fit",
  "action:reports",
  "action:monitoring",
  "action:tools",
  "action:tour",
  "action:new-lab",
  "action:copy-lab"
]);

interface PaletteAction {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
}

interface UiEvent {
  type?: string;
  sessionId?: string;
  kind?: "run" | "spotlight" | "explain" | "clear" | "monitoring";
  id?: string;
  nodes?: string[];
  title?: string;
  message?: string;
  tab?: "health" | "faults" | "setup";
  faultTest?: FaultTestPrefill;
}

/** Let an attached AI agent show the user the UI, live (MCP `ui_*` tools): tell the
 * backend what this window can open, and act on the agent's `ui` events. */
export function useAgentGuide(
  enabled: boolean,
  sessionId: string | null,
  quickActions: PaletteAction[]
) {
  const actions = useMemo(
    () => quickActions.filter((action) => GUIDE_ACTIONS.has(action.id)),
    [quickActions]
  );
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const signature = actions.map((action) => `${action.id}\u0000${action.label}`).join("\u0001");

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const listed = actionsRef.current.map(({ id, label, detail }) => ({
      id,
      label,
      detail: detail ?? ""
    }));
    void api.setAssistantUiActions(sessionId, listed).catch(() => undefined);
  }, [enabled, sessionId, signature]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    return api.subscribeEvents((raw) => {
      const event = raw as UiEvent;
      if (event.type !== "ui" || event.sessionId !== sessionId) return;
      const message = event.message ?? "";
      switch (event.kind) {
        case "run":
          // one thing at a time: what the agent opened before makes way
          if (event.id !== "action:monitoring") openMonitoringDialog(null);
          actionsRef.current.find((action) => action.id === event.id)?.run();
          showAgentGuide(message, event.title);
          break;
        case "spotlight":
          setSpotlight({ label: AGENT_SPOTLIGHT_LABEL, nodes: event.nodes ?? [] });
          showAgentGuide(message, event.title);
          break;
        case "monitoring":
          openMonitoringDialog({ sessionId, tab: event.tab, faultTest: event.faultTest });
          showAgentGuide(message, event.title);
          break;
        case "explain":
          showAgentGuide(message, event.title);
          break;
        case "clear":
          clearAgentGuide();
          setSpotlight(null);
          break;
      }
    });
  }, [enabled, sessionId]);
}
