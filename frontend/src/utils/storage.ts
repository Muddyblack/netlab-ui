// One place for browser storage, so call sites don't each carry their own
// try/catch. Storage can be missing, blocked or full (private windows,
// sandboxed frames, quota), so every function here swallows those failures:
// reads fall back to the default, writes report success with a boolean.
//
// Use this for per-browser conveniences only (panel sizes, dismissed banners,
// the last tab). Anything that should follow the login lives in the backend
// (see userState.ts), and large or must-not-lose data belongs in IndexedDB
// (see bufferStore.ts) — localStorage holds only about 5 MB per site.
//
// Key naming: new keys use the `netlab.` prefix (`netlab.<area>.<name>`). The
// older `netlab:`, `netlab-` and `netlab-gui:` keys stay as they are, since
// renaming one would reset it for every existing user.

type Area = "local" | "session";

function area(which: Area): Storage | null {
  try {
    return which === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readStored(key: string, which: Area = "local"): string | null {
  try {
    return area(which)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the value could not be stored (blocked or quota). */
export function writeStored(key: string, value: string, which: Area = "local"): boolean {
  try {
    area(which)?.setItem(key, value);
    return area(which) !== null;
  } catch {
    return false;
  }
}

export function removeStored(key: string, which: Area = "local"): void {
  try {
    area(which)?.removeItem(key);
  } catch {
    // nothing to clean up if storage is unavailable
  }
}

/** Parsed JSON for `key`, or `fallback` when missing, malformed or rejected by `check`. */
export function readJson<T>(key: string, fallback: T, check?: (value: unknown) => value is T, which: Area = "local"): T {
  const raw = readStored(key, which);
  if (raw === null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    return check && !check(value) ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, which: Area = "local"): boolean {
  try {
    return writeStored(key, JSON.stringify(value), which);
  } catch {
    return false;
  }
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** A finite number stored as text, or `fallback`. */
export function readNumber(key: string, fallback: number): number {
  const raw = readStored(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function readFlag(key: string, fallback: boolean, which: Area = "local"): boolean {
  const raw = readStored(key, which);
  if (raw === null) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}
