/**
 * Single source of truth for the backend (netlab adapter) base URL.
 *
 * Resolved at *runtime*, not baked in at build time, so the app can later point
 * at a different netlab host without a rebuild — the groundwork for an
 * "endpoint picker" if we ever support multiple netlab machines in one UI.
 *
 * Resolution order (first hit wins):
 *   1. runtime override saved in localStorage (set via `setApiBase`)
 *   2. build-time `VITE_API_BASE`
 *   3. current browser origin. Vite proxies `/api`, `/mcp`, SSE, and WebSocket
 *      traffic to the backend in development; production serves the frontend
 *      and API together from FastAPI.
 *
 * Always call `getApiBase()` at request time (don't capture it in a module-level
 * const) so a later switch takes effect without reloading.
 */

const STORAGE_KEY = "netlab.apiBase";
const DEFAULT_BASE = window.location.origin;

function readOverride(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    // Older development builds stored/directly used port 8000. Once Vite owns
    // the same-origin proxy, retaining that value recreates the CORS problem
    // the proxy is meant to avoid. Explicit non-default remote hosts remain.
    if (
      import.meta.env.DEV &&
      (value === "http://localhost:8000" || value === "http://127.0.0.1:8000")
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    // localStorage can throw in sandboxed/SSR contexts — fall through.
    return null;
  }
}

/** Current backend base URL, trailing slash stripped. */
export function getApiBase(): string {
  const base = readOverride() ?? import.meta.env.VITE_API_BASE ?? DEFAULT_BASE;
  return base.replace(/\/$/, "");
}

/** Same base as a WebSocket URL (`http(s)` -> `ws(s)`). */
export function getApiWsBase(): string {
  return getApiBase().replace(/^http/, "ws");
}

/** Override the backend for this browser (future endpoint picker writes here). */
export function setApiBase(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // best-effort; ignore storage failures.
  }
}

/** Drop the override and fall back to build-time / default. */
export function clearApiBase(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort; ignore storage failures.
  }
}
