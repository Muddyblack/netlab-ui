import { useSyncExternalStore } from "react";

/** A fault test filled in for the user to review and start (e.g. by an AI agent). */
export interface FaultTestPrefill {
  link: string;
  end: "a" | "b" | "both";
  cycles: number;
  down: number;
  up: number;
}

/** The lab whose monitoring dialog is open (null = closed), optionally on a tab. */
export interface MonitoringDialogRequest {
  sessionId: string;
  tab?: "health" | "faults" | "setup";
  faultTest?: FaultTestPrefill;
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
    () => request
  );
}
