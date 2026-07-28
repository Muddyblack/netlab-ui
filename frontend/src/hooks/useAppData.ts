import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HealthStatus, type LabFileEntry } from "../api/client";
import { getApiBase } from "../api/endpoint";
import {
  applyResolvedThemeVars,
  persistThemeMode,
  readPersistedThemeMode,
  resolveThemeMode,
  type AppThemeMode
} from "../theme";
import {
  DEMO_MODE,
  type StartupState,
  type WorkspaceEntry
} from "../lifecycle/types";

/** Shape of one lab in `netlab status --format json` (untyped dict upstream). */
export interface RunningLabInfo {
  name?: string;
  path?: string;
  dir?: string;
  status?: string;
  providers?: string[];
  nodes?: Record<
    string,
    {
      status?: string;
      mgmt?: string;
      image?: string;
      device?: string;
      provider?: string;
      provider_name?: string;
    } | undefined
  >;
}
export type RunningLabsStatus = Record<string, RunningLabInfo>;

interface HostWithFiles {
  listLabFiles?: () => Promise<LabFileEntry[]>;
}

interface Options {
  /** Ref to the active host — used by fetchFiles to call listLabFiles when available. */
  hostRef: React.RefObject<HostWithFiles | null>;
  onFilesChanged?: () => void;
}

// Cache the last successful health result so a page reload (e.g. Vite HMR
// falling back to a full reload on dev edits) skips the "Checking netlab
// environment" splash and re-validates the backend in the background instead.
const HEALTH_CACHE_KEY = "netlab-gui.lastHealth";

function readCachedHealth(): HealthStatus | null {
  try {
    const raw = sessionStorage.getItem(HEALTH_CACHE_KEY);
    return raw ? (JSON.parse(raw) as HealthStatus) : null;
  } catch {
    return null;
  }
}

function writeCachedHealth(health: HealthStatus | null): void {
  try {
    if (health) sessionStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(health));
    else sessionStorage.removeItem(HEALTH_CACHE_KEY);
  } catch {
    /* sessionStorage unavailable — fall back to the splash on reload */
  }
}

function startupErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "The backend did not respond in time. Retrying automatically…";
  }
  return err instanceof Error ? err.message : "Unable to reach the backend.";
}

export function useAppData({ hostRef, onFilesChanged }: Options) {
  const onFilesChangedRef = useRef(onFilesChanged);
  useEffect(() => { onFilesChangedRef.current = onFilesChanged; }, [onFilesChanged]);
  const [startup, setStartup] = useState<StartupState>(() => {
    if (DEMO_MODE) {
      return { status: "ready", health: { ok: false, netlab: false, containerlab: false, netlabComponents: [] }, error: null };
    }
    // Optimistically resume from a cached health result; checkStartup re-verifies.
    const cached = readCachedHealth();
    return cached ? { status: "ready", health: cached, error: null } : { status: "checking", health: null, error: null };
  });
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => resolveThemeMode());
  const [labFiles, setLabFiles] = useState<LabFileEntry[]>([]);
  const [runningLabsStatus, setRunningLabsStatus] = useState<RunningLabsStatus>({});
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [yamlSchema, setYamlSchema] = useState<object | undefined>(undefined);
  const lastStatusSigRef = useRef<string>("");
  const lastLabFilesSigRef = useRef<string>("");
  const lastWorkspacesSigRef = useRef<string>("");
  const startupCheckGenerationRef = useRef(0);

  // ── Health check ────────────────────────────────────────────────────────────
  const checkStartup = useCallback(async () => {
    if (DEMO_MODE) return;
    const generation = ++startupCheckGenerationRef.current;
    // Only show the splash on a cold start. If we already have a ready state
    // (e.g. resumed from cached health after a reload), re-verify silently in
    // the background so the user stays on their current view.
    setStartup((prev) => (prev.status === "ready" ? prev : { status: "checking", health: null, error: null }));
    try {
      const health = await api.health();
      if (generation !== startupCheckGenerationRef.current) return;
      writeCachedHealth(health);
      setStartup({ status: "ready", health, error: null });
    } catch (err) {
      if (generation !== startupCheckGenerationRef.current) return;
      writeCachedHealth(null);
      setStartup({ status: "blocked", health: null, error: startupErrorMessage(err) });
    }
  }, []);
  useEffect(() => { void checkStartup(); }, [checkStartup]);

  // Backend reloads can leave the browser probing during the brief window in
  // which the port exists but is not ready yet. Keep retrying quietly from the
  // error screen so recovery never requires a full page refresh. A manual
  // Retry increments the generation and retires this loop; the next blocked
  // state starts a fresh one.
  useEffect(() => {
    if (DEMO_MODE || startup.status !== "blocked") return;
    let cancelled = false;
    const generation = startupCheckGenerationRef.current;

    const poll = async () => {
      while (!cancelled && generation === startupCheckGenerationRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        if (cancelled || generation !== startupCheckGenerationRef.current) return;
        try {
          const health = await api.health();
          if (cancelled || generation !== startupCheckGenerationRef.current) return;
          writeCachedHealth(health);
          setStartup({ status: "ready", health, error: null });
          return;
        } catch {
          // Stay on the actionable error screen and try again shortly.
        }
      }
    };

    void poll();
    return () => { cancelled = true; };
  }, [startup.status]);

  // ── Theme sync ───────────────────────────────────────────────────────────────
  useEffect(() => { applyResolvedThemeVars(themeMode); }, [themeMode]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (!readPersistedThemeMode()) setThemeMode(resolveThemeMode()); };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    // Safari < 14 fallback — addListener/removeListener are deprecated but
    // still declared on MediaQueryList, so no cast is needed.
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const handleThemeChange = useCallback((next: AppThemeMode) => {
    setThemeMode(next);
    persistThemeMode(next);
  }, []);

  // ── Files + workspaces ───────────────────────────────────────────────────────
  const fetchWorkspaces = useCallback(async () => {
    try {
      const r = await api.getWorkspaces();
      const sig = JSON.stringify((r.workspaces ?? [])
        .map((workspace) => ({ path: workspace.path ?? "" }))
        .sort((a, b) => a.path.localeCompare(b.path)));
      if (sig === lastWorkspacesSigRef.current) return;
      lastWorkspacesSigRef.current = sig;
      setWorkspaces(r.workspaces);
    }
    catch { /* ignore in demo / when endpoint is absent */ }
  }, []);

  const fetchFiles = useCallback(async () => {
    try {
      const nextFiles: LabFileEntry[] | null = hostRef.current?.listLabFiles
        ? await hostRef.current.listLabFiles()
        : await (async () => {
          const res = await fetch(`${getApiBase()}/api/lab/files`);
          return res.ok ? ((await res.json()) as LabFileEntry[]) : null;
        })();
      if (!nextFiles) return;
      const sig = JSON.stringify(nextFiles
        .map((file) => ({
          filename: file?.filename,
          labName: file?.labName,
          path: file?.path,
          workspace: file?.workspace,
          topologyId: file?.topologyRef?.topologyId,
          yamlPath: file?.topologyRef?.yamlPath,
          source: file?.topologyRef?.source
        }))
        .sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? ""))));
      if (sig === lastLabFilesSigRef.current) return;
      lastLabFilesSigRef.current = sig;
      setLabFiles(nextFiles);
    } catch (err) { console.error("Failed to fetch lab files:", err); }
  }, [hostRef]);

  useEffect(() => {
    if (DEMO_MODE) return;
    void (async () => {
      try { const res = await fetch(`${getApiBase()}/api/schema/netlab.json`); if (res.ok) setYamlSchema(await res.json()); }
      catch { /* non-fatal */ }
    })();
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Shared by the SSE stream and one-shot refreshes; the signature gate keeps
  // identical payloads from causing re-renders.
  const applyRunningStatus = useCallback((status: unknown) => {
    const next = (status && typeof status === "object" ? status : {}) as RunningLabsStatus;
    const sig = JSON.stringify(Object.fromEntries(
      Object.entries(next).map(([key, lab]) => [
        key,
        { name: lab?.name, path: lab?.path, dir: lab?.dir, status: lab?.status, providers: lab?.providers, nodes: Object.fromEntries(Object.entries(lab?.nodes ?? {}).map(([n, info]) => [n, info?.status])) }
      ])
    ));
    if (sig === lastStatusSigRef.current) return;
    lastStatusSigRef.current = sig;
    setRunningLabsStatus(next);
  }, []);

  // One-shot `netlab status` fetch — used right after lifecycle commands so
  // deploy/destroy results show up immediately instead of waiting for the
  // next SSE poll tick.
  const refreshStatus = useCallback(async () => {
    if (DEMO_MODE) return;
    try {
      const res = await fetch(`${getApiBase()}/api/lab/status`);
      if (res.ok) applyRunningStatus(await res.json());
    } catch { /* stream keeps us eventually consistent */ }
  }, [applyRunningStatus]);

  useEffect(() => {
    if (startup.status !== "ready") return;
    void fetchFiles();
    if (DEMO_MODE) return;
    // Backend push events (watchfiles) surface external changes — netlab runs,
    // editors, git — the moment they hit disk. The slow interval below is only
    // a fallback for backends without the watcher; both setters are
    // signature-gated above, so an unchanged refresh causes no re-render.
    const unsubEvents = api.subscribeEvents((event) => {
      if (event.type === "files") {
        void fetchFiles();
        onFilesChangedRef.current?.();
      }
      if (event.type === "workspaces") {
        void fetchWorkspaces();
        void fetchFiles();
        onFilesChangedRef.current?.();
      }
    });
    const filesPoll = window.setInterval(() => {
      void fetchFiles();
      void fetchWorkspaces();
    }, 60000);
    const unsub = api.subscribeStatus(applyRunningStatus);
    return () => {
      window.clearInterval(filesPoll);
      unsubEvents();
      unsub();
    };
  }, [startup.status, fetchFiles, fetchWorkspaces, applyRunningStatus]);

  return {
    startup, checkStartup,
    themeMode, handleThemeChange,
    labFiles, runningLabsStatus,
    workspaces, setWorkspaces,
    fetchFiles, fetchWorkspaces, refreshStatus,
    yamlSchema
  };
}
