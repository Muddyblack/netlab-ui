import { useEffect, useMemo, useRef } from "react";

import { api } from "../api/client";
import { AGENT_SPOTLIGHT_LABEL, clearAgentGuide, showAgentGuide } from "../host/agentGuideStore";
import { setSpotlight } from "../host/canvasSpotlight";
import { openLabFile } from "../host/fileOpenStore";
import { openMonitoringDialog, type FaultTestPrefill } from "../host/monitoringDialogStore";
import { openNodeConfigsDialog } from "../host/nodeConfigsStore";

interface PaletteAction {
  id: string;
  label: string;
  detail?: string;
  /** Opens a dialog or panel or moves the view -- never deploys, writes or
   * changes the lab. Only these are offered to an attached agent; declare it
   * where the action is defined (useAppController's quickActions). */
  guide?: boolean;
  run: () => void;
}

interface UiEvent {
  type?: string;
  sessionId?: string;
  kind?: "run" | "spotlight" | "explain" | "clear" | "monitoring" | "nodeConfigs" | "openFile" | "link" | "capture";
  id?: string;
  node?: string;
  interface?: string;
  path?: string;
  nodes?: string[];
  title?: string;
  message?: string;
  tab?: "health" | "faults" | "setup";
  faultTest?: FaultTestPrefill;
  link?: { label: string; url: string };
}

/** Let an attached AI agent show the user the UI, live (MCP `ui_*` tools): tell the
 * backend what this window can open, and act on the agent's `ui` events. */
export function useAgentGuide(
  enabled: boolean,
  sessionId: string | null,
  quickActions: PaletteAction[],
  captureInterface: (node: string, interfaceName: string) => void
) {
  const captureInterfaceRef = useRef(captureInterface);
  captureInterfaceRef.current = captureInterface;
  const actions = useMemo(
    () => quickActions.filter((action) => action.guide),
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
        case "nodeConfigs":
          if (event.node) openNodeConfigsDialog({ sessionId, node: event.node });
          showAgentGuide(message, event.title);
          break;
        case "openFile":
          if (event.path) openLabFile(event.path);
          showAgentGuide(message, event.title);
          break;
        case "link":
          setSpotlight({ label: AGENT_SPOTLIGHT_LABEL, nodes: event.nodes ?? [], links: [[event.nodes?.[0] ?? "", event.nodes?.[1] ?? ""]] });
          showAgentGuide(message, event.title);
          break;
        case "capture":
          if (event.node && event.interface) captureInterfaceRef.current(event.node, event.interface);
          showAgentGuide(message, event.title);
          break;
        case "explain":
          // only web links: the agent's text never becomes a script URL
          showAgentGuide(
            message,
            event.title,
            /^https?:\/\//.test(event.link?.url ?? "") ? event.link : undefined
          );
          break;
        case "clear":
          clearAgentGuide();
          setSpotlight(null);
          break;
      }
    });
  }, [enabled, sessionId]);
}
