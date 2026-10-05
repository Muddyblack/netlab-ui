import { useEffect, useSyncExternalStore } from "react";

import { api, type AssistantProposal } from "../../api/client";

/**
 * The agents' pending proposals for the open lab. Kept outside the AI agents tab, which is only mounted
 * while it is the selected tab: a proposal that arrives while the user is looking at the agent's terminal
 * (or at another tab) must show up right away, not only after switching away from the tab and back.
 */
interface State {
  sessionId: string | null;
  proposals: readonly AssistantProposal[];
}

let state: State = { sessionId: null, proposals: [] };
const listeners = new Set<() => void>();
const POLL_MS = 10_000;

function set(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export const useProposals = (): State => useSyncExternalStore((listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, () => state);

export const pendingProposals = (proposals: readonly AssistantProposal[]): AssistantProposal[] =>
  proposals.filter((proposal) => proposal.status === "pending");

/** Reload the list for ``sessionId``; returns the pending proposals that were not there before. */
export async function refreshProposals(sessionId: string): Promise<AssistantProposal[]> {
  try {
    const { proposals = [] } = await api.listAssistantProposals(sessionId);
    if (state.sessionId !== sessionId) return []; // the user moved on to another lab meanwhile
    const known = new Set(pendingProposals(state.proposals).map((proposal) => proposal.id));
    const fresh = pendingProposals(proposals).filter((proposal) => !known.has(proposal.id));
    set({ sessionId, proposals });
    return fresh;
  } catch {
    return [];
  }
}

/** Keep the store current for ``sessionId`` while ``enabled``, and call ``onNew`` for each proposal that arrives. */
export function useProposalWatcher(sessionId: string | null, enabled: boolean, onNew: (proposal: AssistantProposal) => void): void {
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    set({ sessionId, proposals: [] });
    let first = true;
    const load = () => {
      void refreshProposals(sessionId).then((fresh) => {
        // What was already waiting when the lab opened is not news.
        if (first) first = false;
        else fresh.forEach(onNew);
      });
    };
    load();
    const unsubscribe = api.subscribeEvents((event) => {
      if (event.type === "proposals" && (!event.sessionId || event.sessionId === sessionId)) load();
    });
    // Fallback for a push stream that dropped, and for a tab that was in the background.
    const timer = window.setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, enabled]);
}
