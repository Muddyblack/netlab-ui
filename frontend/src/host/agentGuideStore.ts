import { useSyncExternalStore } from "react";

/** What an attached AI agent is showing the user right now (see useAgentGuide):
 * a short explanation next to what it opened or spotlighted. */
export interface AgentGuideNote {
  title: string;
  message: string;
  /** Optional link the agent points at (e.g. a Grafana dashboard). */
  link?: { label: string; url: string };
  /** Bumped on every note, so the same text sent twice still shows again. */
  seq: number;
}

/** Spotlight label for nodes an agent pointed at (the card clears it on dismiss). */
export const AGENT_SPOTLIGHT_LABEL = "Shown by your AI agent";

let current: AgentGuideNote | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function showAgentGuide(
  message: string,
  title = "",
  link?: { label: string; url: string }
): void {
  current = message.trim() || link ? { title, message, link, seq: ++seq } : null;
  for (const listener of listeners) listener();
}

export function clearAgentGuide(): void {
  current = null;
  for (const listener of listeners) listener();
}

export function useAgentGuide(): AgentGuideNote | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}
