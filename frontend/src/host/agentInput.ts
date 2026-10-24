/** Lets the UI type a line into a running agent terminal (the PTY lives behind a WebSocket owned by
 * PtyTerminal), keyed by lab session. The newest terminal registered for a session wins. */
type Send = (text: string) => void;

const inputs = new Map<string, Send[]>();

export function registerAgentInput(sessionId: string, send: Send): () => void {
  inputs.set(sessionId, [...(inputs.get(sessionId) ?? []), send]);
  return () => {
    const rest = (inputs.get(sessionId) ?? []).filter((candidate) => candidate !== send);
    if (rest.length) inputs.set(sessionId, rest);
    else inputs.delete(sessionId);
  };
}

/** Types `line` and presses Enter in the agent for this lab; false when no agent terminal is open. */
export function sendToAgent(sessionId: string, line: string): boolean {
  const send = inputs.get(sessionId)?.at(-1);
  if (!send) return false;
  send(line);
  return true;
}

let openPanel: (() => void) | null = null;

/** The app registers how to show the AI agents panel, so a canvas tool can send the user there to pick an agent. */
export function registerAgentsPanelOpener(open: (() => void) | null): void {
  openPanel = open;
}

export function openAgentsPanel(): void {
  openPanel?.();
}
