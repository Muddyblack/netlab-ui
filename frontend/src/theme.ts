import { applyThemeVars } from "@srl-labs/clab-ui/theme";

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

export function applyResolvedThemeVars(mode: AppThemeMode): void {
  applyThemeVars(mode);
  document.documentElement.style.setProperty("color-scheme", mode);
  document.documentElement.classList.toggle("light", mode === "light");
}

