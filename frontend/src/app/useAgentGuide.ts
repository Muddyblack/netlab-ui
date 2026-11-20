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

interface UiContext {
  sessionId: string;
  actions: PaletteAction[];
  capture: (node: string, interfaceName: string) => void;
}

/** What each kind of agent event opens or highlights. After it, the agent's message is shown (except where noted). */
const UI_HANDLERS: Record<NonNullable<UiEvent["kind"]>, (event: UiEvent, ctx: UiContext) => void> = {
  run: (event, { actions }) => {
    // one thing at a time: what the agent opened before makes way
    if (event.id !== "action:monitoring") openMonitoringDialog(null);
    actions.find((action) => action.id === event.id)?.run();
  },
  spotlight: (event) => setSpotlight({ label: AGENT_SPOTLIGHT_LABEL, nodes: event.nodes ?? [] }),
  monitoring: (event, { sessionId }) => openMonitoringDialog({ sessionId, tab: event.tab, faultTest: event.faultTest }),
  nodeConfigs: (event, { sessionId }) => {
    if (event.node) openNodeConfigsDialog({ sessionId, node: event.node });
  },
  openFile: (event) => {
    if (event.path) openLabFile(event.path);
  },
  link: (event) => {
    const [a = "", b = ""] = event.nodes ?? [];
    setSpotlight({ label: AGENT_SPOTLIGHT_LABEL, nodes: event.nodes ?? [], links: [[a, b]] });
  },
  capture: (event, { capture }) => {
    if (event.node && event.interface) capture(event.node, event.interface);
  },
  explain: () => undefined,
  clear: () => {
    clearAgentGuide();
    setSpotlight(null);
  }
};

function actOnUiEvent(event: UiEvent, ctx: UiContext): void {
  if (!event.kind || !Object.hasOwn(UI_HANDLERS, event.kind)) return;
  UI_HANDLERS[event.kind](event, ctx);
  if (event.kind === "clear") return;
  // only web links: the agent's text never becomes a script URL
  const link = event.kind === "explain" && /^https?:\/\//.test(event.link?.url ?? "") ? event.link : undefined;
  showAgentGuide(event.message ?? "", event.title, link);
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
      actOnUiEvent(event, { sessionId, actions: actionsRef.current, capture: captureInterfaceRef.current });
    });
  }, [enabled, sessionId]);
}
