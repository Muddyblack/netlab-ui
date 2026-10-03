import { useSyncExternalStore } from "react";

/**
 * The key that shows or hides the terminal panel (with Ctrl, or Cmd on a Mac); with Shift it opens another terminal.
 * The default is VS Code's backtick. Where that key is awkward (a German layout has no plain backtick), the user
 * picks another one in Settings, instead of the app guessing at layouts.
 */
export interface TerminalShortcut {
  /** `KeyboardEvent.key`, lower-cased: follows the layout. */
  key: string;
  /** `KeyboardEvent.code`: the physical key, which the default also matches wherever the backtick key sits. */
  code?: string;
}

const STORAGE_KEY = "netlab.terminalShortcut";
export const DEFAULT_TERMINAL_SHORTCUT: TerminalShortcut = { key: "`", code: "Backquote" };

function read(): TerminalShortcut {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<TerminalShortcut> | null;
    if (value && typeof value.key === "string" && value.key) {
      return { key: value.key.toLowerCase(), ...(typeof value.code === "string" ? { code: value.code } : {}) };
    }
  } catch {
    // Unreadable storage or bad JSON: use the default.
  }
  return DEFAULT_TERMINAL_SHORTCUT;
}

let current = read();
const listeners = new Set<() => void>();

export const getTerminalShortcut = (): TerminalShortcut => current;
export const useTerminalShortcut = (): TerminalShortcut => useSyncExternalStore((listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, getTerminalShortcut);

export function setTerminalShortcut(shortcut: TerminalShortcut): void {
  current = shortcut;
  try {
    if (shortcut === DEFAULT_TERMINAL_SHORTCUT) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcut));
  } catch {
    // Best-effort, like the other preferences.
  }
  listeners.forEach((listener) => listener());
}

/** Keys that cannot be the terminal key: they are modifiers, or the app and the browser already use them. */
export const isReservedShortcutKey = (event: KeyboardEvent): boolean =>
  ["control", "shift", "alt", "meta", "altgraph", "dead", "unidentified", "tab", "escape", "enter", "backspace"].includes(event.key.toLowerCase());

export function shortcutFromEvent(event: KeyboardEvent): TerminalShortcut {
  const key = event.key.toLowerCase();
  return key === DEFAULT_TERMINAL_SHORTCUT.key ? DEFAULT_TERMINAL_SHORTCUT : { key, code: event.code };
}

export const matchesTerminalShortcut = (event: KeyboardEvent): boolean => {
  if (event.altKey) return false;
  const shortcut = current;
  return event.key.toLowerCase() === shortcut.key || (shortcut.code !== undefined && event.code === shortcut.code);
};

/** How the shortcut reads in the UI, e.g. "Ctrl+`" or "Ctrl+Shift+ö". */
export const terminalShortcutLabel = (shortcut: TerminalShortcut, shift = false): string =>
  `Ctrl+${shift ? "Shift+" : ""}${shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key}`;
