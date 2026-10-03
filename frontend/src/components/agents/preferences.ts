// Whether the AI agents panel is open, remembered per browser. The key keeps
// its old "assistant" name so the setting survives the chat's removal.
const OPEN_KEY = "netlab.assistant.open";
const MCP_KEY = "netlab.assistant.connect";

export function readAgentsPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistAgentsPanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    // Preferences are best-effort in private or sandboxed browser contexts.
  }
}

/** Where an agent's terminal is shown: inside the AI agents tab (default), or in the bottom panel. */
export type AgentPlacement = "below" | "here";
const PLACEMENT_KEY = "netlab.assistant.terminal";

export function readAgentPlacement(): AgentPlacement {
  try {
    return window.localStorage.getItem(PLACEMENT_KEY) === "below" ? "below" : "here";
  } catch {
    return "here";
  }
}

export function persistAgentPlacement(placement: AgentPlacement): void {
  try {
    window.localStorage.setItem(PLACEMENT_KEY, placement);
  } catch {
    // Best-effort, like the other preferences.
  }
}

/** Start agents already connected to the lab over MCP (default), or as a plain terminal. */
export function readAgentConnect(): boolean {
  try {
    return window.localStorage.getItem(MCP_KEY) !== "false";
  } catch {
    return true;
  }
}

export function persistAgentConnect(connect: boolean): void {
  try {
    window.localStorage.setItem(MCP_KEY, String(connect));
  } catch {
    // Best-effort, like the other preferences.
  }
}

/** Start agents without their permission prompts (their own "skip permissions" flag). Off unless chosen. */
const YOLO_KEY = "netlab.assistant.skipPermissions";

export function readAgentSkipPermissions(): boolean {
  try {
    return window.localStorage.getItem(YOLO_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistAgentSkipPermissions(skip: boolean): void {
  try {
    window.localStorage.setItem(YOLO_KEY, String(skip));
  } catch {
    // Best-effort, like the other preferences.
  }
}
