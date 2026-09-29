import { useSyncExternalStore } from "react";

/** The lab whose monitoring dialog is open (null = closed). */
export interface MonitoringDialogRequest {
  sessionId: string;
}

let request: MonitoringDialogRequest | null = null;
const listeners = new Set<() => void>();

export function openMonitoringDialog(next: MonitoringDialogRequest | null): void {
  request = next;
  for (const listener of listeners) listener();
}

export function useMonitoringDialogRequest(): MonitoringDialogRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => request,
  );
}
