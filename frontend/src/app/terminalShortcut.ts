import { useSyncExternalStore } from "react";

/**
 * App shortcuts the user can rebind (with Ctrl, or Cmd on a Mac): the terminal panel key and the quick-open key.
 * The terminal default is VS Code's backtick. Where a default is awkward (a German layout has no plain backtick,
 * some browsers keep Ctrl+P for printing), the user picks another key in Settings, instead of the app guessing at layouts.
 */
export interface TerminalShortcut {
  /** `KeyboardEvent.key`, lower-cased: follows the layout. */
  key: string;
  /** `KeyboardEvent.code`: the physical key, which the default also matches wherever the backtick key sits. */
  code?: string;
}

export interface ShortcutStore {
  defaultShortcut: TerminalShortcut;
  get: () => TerminalShortcut;
  use: () => TerminalShortcut;
  set: (shortcut: TerminalShortcut) => void;
  matches: (event: KeyboardEvent) => boolean;
  fromEvent: (event: KeyboardEvent) => TerminalShortcut;
}

function createShortcutStore(storageKey: string, defaultShortcut: TerminalShortcut): ShortcutStore {
  function read(): TerminalShortcut {
    try {
      const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as Partial<TerminalShortcut> | null;
      if (value && typeof value.key === "string" && value.key) {
        return { key: value.key.toLowerCase(), ...(typeof value.code === "string" ? { code: value.code } : {}) };
      }
    } catch {
      // Unreadable storage or bad JSON: use the default.
    }
    return defaultShortcut;
  }

  let current = read();
  const listeners = new Set<() => void>();
  const get = (): TerminalShortcut => current;
  return {
    defaultShortcut,
    get,
    use: () => useSyncExternalStore((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, get),
    set(shortcut) {
      current = shortcut;
      try {
        if (shortcut === defaultShortcut) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, JSON.stringify(shortcut));
      } catch {
        // Best-effort, like the other preferences.
      }
      listeners.forEach((listener) => listener());
    },
    matches(event) {
      if (event.altKey) return false;
      return event.key.toLowerCase() === current.key || (current.code !== undefined && event.code === current.code);
    },
    fromEvent(event) {
      const key = event.key.toLowerCase();
      return key === defaultShortcut.key ? defaultShortcut : { key, code: event.code };
    },
  };
}

/** Shows or hides the terminal panel; with Shift it opens another terminal. */
export const terminalShortcut = createShortcutStore("netlab.terminalShortcut", { key: "`", code: "Backquote" });
/** Opens the quick-open / command palette. */
export const quickOpenShortcut = createShortcutStore("netlab.quickOpenShortcut", { key: "p", code: "KeyP" });

export const DEFAULT_TERMINAL_SHORTCUT = terminalShortcut.defaultShortcut;
export const getTerminalShortcut = terminalShortcut.get;
export const useTerminalShortcut = (): TerminalShortcut => terminalShortcut.use();
export const setTerminalShortcut = terminalShortcut.set;
export const shortcutFromEvent = terminalShortcut.fromEvent;
export const matchesTerminalShortcut = terminalShortcut.matches;
export const useQuickOpenShortcut = (): TerminalShortcut => quickOpenShortcut.use();

/** Keys that cannot be a shortcut key: they are modifiers, or the app and the browser already use them. */
export const isReservedShortcutKey = (event: KeyboardEvent): boolean =>
  ["control", "shift", "alt", "meta", "altgraph", "dead", "unidentified", "tab", "escape", "enter", "backspace"].includes(event.key.toLowerCase());

/** How the shortcut reads in the UI, e.g. "Ctrl+`" or "Ctrl+Shift+ö". */
export const terminalShortcutLabel = (shortcut: TerminalShortcut, shift = false): string =>
  `Ctrl+${shift ? "Shift+" : ""}${shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key}`;
