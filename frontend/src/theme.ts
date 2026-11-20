import { applyThemeVars } from "@containerlab/clab-ui/theme";

export type AppThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "clab-standalone-theme";

export function parseThemeMode(value: unknown): AppThemeMode | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

export function getSystemThemeMode(): AppThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readPersistedThemeMode(): AppThemeMode | undefined {
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function resolveThemeMode(): AppThemeMode {
  return readPersistedThemeMode() ?? getSystemThemeMode();
}

export function persistThemeMode(mode: AppThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore persistence failures.
  }
}

/**
 * Our additions to clab-ui's palette, per mode (it sets its variables inline on <html>, so ours go there too).
 *  - `--netlab-ui-on-*`: text on a filled error/warning/success/info chip or button. clab-ui reuses VS Code's
 *    validation foregrounds for that, made for the dark validation backgrounds, not the bright palette colors:
 *    white on salmon or green in dark mode (~2:1), #333 on dark red in light mode.
 *  - `--netlab-ui-status-shade`: how much black to mix into a fixed status color (#22c55e, #f59e0b, ...) used as
 *    text. They are tuned for the dark theme; on white they fall to ~2:1. 45% brings the palest to 5:1.
 */
const EXTRA_VARS: Record<AppThemeMode, Record<string, string>> = {
  dark: {
    "--netlab-ui-on-error": "#1e1e1e",
    "--netlab-ui-on-warning": "#1e1e1e",
    "--netlab-ui-on-success": "#1e1e1e",
    "--netlab-ui-on-info": "#1e1e1e",
    "--netlab-ui-status-shade": "0%",
  },
  light: {
    "--netlab-ui-on-error": "#ffffff",
    "--netlab-ui-on-warning": "#1e1e1e",
    "--netlab-ui-on-success": "#ffffff",
    "--netlab-ui-on-info": "#1e1e1e",
    "--netlab-ui-status-shade": "45%",
  },
};

/** A fixed status color made readable as text in the current mode (unchanged in dark, darker in light). */
export const statusText = (color: string): string =>
  `color-mix(in srgb, ${color}, black var(--netlab-ui-status-shade, 0%))`;

export function applyResolvedThemeVars(mode: AppThemeMode): void {
  applyThemeVars(mode);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(EXTRA_VARS[mode])) root.style.setProperty(key, value);
  root.style.setProperty("color-scheme", mode);
  root.classList.toggle("light", mode === "light");
}

