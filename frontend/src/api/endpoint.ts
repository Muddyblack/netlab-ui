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

const TOKEN_KEY = "netlab.apiToken";

/** API token for a backend started with NETLAB_GUI_TOKEN (see `netlab-gui token`). */
export function getApiToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setApiToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // best-effort; ignore storage failures.
  }
}

/** Is `url` a request to the configured backend (as opposed to a third-party host)? */
function isApiUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === new URL(getApiBase(), window.location.href).origin;
  } catch {
    return false;
  }
}

/** `url` with `?token=` appended, for EventSource/WebSocket, which cannot set headers. */
function withToken(url: string | URL, token: string): string {
  const target = new URL(String(url), window.location.href);
  if (!isApiUrl(target.href.replace(/^ws/, "http")) || target.searchParams.has("token")) return String(url);
  target.searchParams.set("token", token);
  return target.toString();
}

/**
 * Attach the API token to every request this page sends to the backend, once, at startup.
 *
 * The app has dozens of `fetch`/`EventSource`/`WebSocket` call sites, so the token is added here instead of at each
 * one: a header on `fetch`, a query parameter on the two that cannot carry headers. A `?token=` in the page URL is
 * stored (and removed from the address bar) so a link from `netlab-gui token` is enough to sign in. Does nothing
 * when no token is set, so a same-origin deployment behind Basic auth behaves exactly as before.
 */
export function installApiAuth(): void {
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  if (fromUrl) {
    setApiToken(fromUrl);
    const clean = new URL(window.location.href);
    clean.searchParams.delete("token");
    window.history.replaceState(null, "", clean.toString());
  }
  if (!getApiToken()) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const token = getApiToken();
    const url = input instanceof Request ? input.url : String(input);
    if (!token || !isApiUrl(url)) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return nativeFetch(input, { ...init, headers });
  };

  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      const token = getApiToken();
      super(token ? withToken(url, token) : url, init);
    }
  };

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const token = getApiToken();
      super(token ? withToken(url, token) : url, protocols);
    }
  };
}
