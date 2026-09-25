import { useSyncExternalStore } from "react";

/** The lab whose netlab external tools dialog is open (null = closed), and
 * how to open a shell to a tool (`netlab connect <tool>`) in that lab. */
export interface ToolsDialogRequest {
  sessionId: string;
  openShell: (name: string) => void;
}

let request: ToolsDialogRequest | null = null;
const listeners = new Set<() => void>();

export function openToolsDialog(next: ToolsDialogRequest | null): void {
  request = next;
  for (const listener of listeners) listener();
}

export function useToolsDialogRequest(): ToolsDialogRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => request,
  );
}
