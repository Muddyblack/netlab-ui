// Whether the AI agents panel is open, remembered per browser. The key keeps
// its old "assistant" name so the setting survives the chat's removal.
const OPEN_KEY = "netlab.assistant.open";

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
