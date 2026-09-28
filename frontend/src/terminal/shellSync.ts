import { useSyncExternalStore } from "react";

/**
 * "Sync input" across open node shells — tmux's synchronize-panes. Every
 * shell that joins gets the keystrokes typed into any other member, so one
 * `show ip bgp summary` lands on all of them at once. Membership is per
 * browser window; each Shell instance joins with its own id.
 */

type Sink = (data: Uint8Array) => void;

const members = new Map<string, { node: string; sink: Sink }>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];

function notify() {
  snapshot = [...members.values()].map((member) => member.node);
  for (const listener of listeners) listener();
}

export function joinShellSync(id: string, node: string, sink: Sink): void {
  members.set(id, { node, sink });
  notify();
}

export function leaveShellSync(id: string): void {
  if (members.delete(id)) notify();
}

/** Send `data` typed into shell `fromId` to every synced shell (itself included). */
export function broadcastShellInput(fromId: string, data: Uint8Array): boolean {
  if (!members.has(fromId)) return false;
  for (const member of members.values()) member.sink(data);
  return true;
}

/** Node names of the shells currently syncing their input. */
export function useShellSyncMembers(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
