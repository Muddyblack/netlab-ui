import { useSyncExternalStore } from "react";

/** Lets dialogs open a web page (Grafana) as a tab next to the lab tabs; the
 * app registers how once. */
type Opener = (input: { url: string; title: string; subtitle?: string }) => void;

let opener: Opener | null = null;

export function registerWebTabOpener(next: Opener | null): void {
  opener = next;
}

/** Where web pages (Grafana dashboards) open: a tab of this app, or a new browser tab (Settings → General). */
export type WebPageTarget = "app" | "browser";

const STORAGE_KEY = "netlab.webPageTarget";

function read(): WebPageTarget {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "browser" ? "browser" : "app";
  } catch {
    return "app";
  }
}

let target = read();
const listeners = new Set<() => void>();

export const getWebPageTarget = (): WebPageTarget => target;
export const useWebPageTarget = (): WebPageTarget => useSyncExternalStore((listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, getWebPageTarget);

export function setWebPageTarget(next: WebPageTarget): void {
  target = next;
  try {
    if (next === "app") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Best-effort, like the other preferences.
  }
  listeners.forEach((listener) => listener());
}

/** Opens the page as a tab of this app; false when the user prefers browser tabs
 * or the app cannot host one (the caller then opens a browser tab). */
export function openWebTab(input: { url: string; title: string; subtitle?: string }): boolean {
  if (!opener || target === "browser") return false;
  opener(input);
  return true;
}
