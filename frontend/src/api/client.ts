/**
 * REST client for the netlab-native authoring panels and lifecycle bar. These
 * drive the *same* backend model as the canvas, so canvas and panels stay in
 * sync (the snapshot endpoint is the shared read path).
 *
 * Response types are imported from ./generated.ts, which is generated from the
 * backend's FastAPI OpenAPI schema (`npm run gen:api`). Do not hand-roll
 * response shapes here — add/adjust the Pydantic models in
 * backend/app/contract/responses.py and regenerate so the two never drift.
 */

import type { components } from "./generated";
import { getApiBase } from "./endpoint";

type Schemas = components["schemas"];

export type HealthStatus = Schemas["HealthStatus"];
export type LabFileEntry = Schemas["LabFileEntry"];
export type LabInstance = Schemas["LabInstance"];
export type CommandResult = Schemas["CommandResult"];
export type DeviceEntry = Schemas["DeviceEntry"];
export type Plugin = Schemas["Plugin"];
export type PluginDebug = Schemas["PluginDebug"];
export type PluginPipeline = Schemas["PluginPipeline"];
export type PluginTemplate = Schemas["PluginTemplate"];
export type PluginImportRequest = Schemas["PluginImportRequest"];
export type PluginImportResult = Schemas["PluginImportResult"];
export type VersionResult = Schemas["VersionResult"];
// Mirrors the generated backend response. Keep this local until API generation
// is run in the full optional-assistant environment (otherwise generation
// incorrectly removes the assistant schemas from this shared client).
export interface NetlabEnvironment {
  configured?: string | null;
  source: string;
  command: string;
  binPath?: string | null;
  found: boolean;
  binDir?: string | null;
  targetPython?: string | null;
  inBackendVenv: boolean;
  envVar: string;
  configPath: string;
  netlabVersion?: string | null;
  netlabVersionSupported?: boolean | null;
  minNetlabVersion?: string | null;
  containerlab: boolean;
  libvirt: boolean;
}
/**
 * What the canvas nodes/edges in a snapshot actually are.
 *
 * Hand-written rather than generated: the snapshot is typed as a bare dict on
 * the backend (see SnapshotResponse), so it never reaches the OpenAPI schema.
 * Mirrors `ProjectionSource` in backend/app/contract/snapshot.py.
 */
export interface NetlabProjection {
  /**
   * "clab" is the real `netlab create` transform. "blended" is the live
   * interim view served while a transform runs — the model's element set over
   * the last real projection's bodies. "model" is the raw netlab model with no
   * projection to blend onto. The *-preview values are approximations, and say
   * why the real transform could not run.
   */
  source: "clab" | "blended" | "model" | "locked-preview" | "failed-preview";
  /** A background `netlab create` is running; its result arrives via SSE. */
  pending: boolean;
  /** The last `netlab create` failure for the YAML currently on disk. */
  error?: string | null;
}

export type MultiserverResult = Schemas["MultiserverResult"];
export type WorkerInfo = Schemas["WorkerInfo"];
export type MultiserverVxlan = Schemas["MultiserverVxlan"];
export type ConfigPreviewResult = Schemas["ConfigPreviewResult"];
export type NetlabLinkResult = Schemas["NetlabLinkResult"];
export type DeployDiffResult = Schemas["DeployDiffResult"];
export type DeploymentOverview = Schemas["DeploymentOverview"];
export type DeploymentNodeDetail = Schemas["DeploymentNodeDetail"];
export type DeploymentLog = Schemas["DeploymentLog"];
export type DeploymentLogLine = Schemas["DeploymentLogLine"];
export type RuntimeContainer = Schemas["RuntimeContainer"];
export type ValidationResult = Schemas["ValidationResult"];
export type LensBundleResult = Schemas["LensBundleResult"];
export type LensWarning = Schemas["LensWarning"];
export type ValidationLens = Schemas["ValidationLens"];
export type ValidationTest = Schemas["ValidationTest"];
export type ServiceExplorerLens = Schemas["ServiceExplorerLens"];
export type ServiceVlan = Schemas["ServiceVlan"];
export type ServiceVrf = Schemas["ServiceVrf"];
export type ReachabilityLens = Schemas["ReachabilityLens"];
export type PathResult = Schemas["PathResult"];
export type PathHop = Schemas["PathHop"];
export type DerivationLens = Schemas["DerivationLens"];
export type DerivationNode = Schemas["DerivationNode"];
export type DerivationField = Schemas["DerivationField"];
export type ReadinessResult = Schemas["ReadinessResult"];
export type ReadinessCheck = Schemas["ReadinessCheck"];
export type ConfigDiffResult = Schemas["ConfigDiffResult"];
export type ConfigDiffFile = Schemas["ConfigDiffFile"];
export type ReportCatalogResult = Schemas["ReportCatalogResult"];
export type ReportRunResult = Schemas["ReportRunResult"];
export type AssistantCapabilities = Schemas["AssistantCapabilities"];
export type AssistantProvider = Schemas["AssistantProvider"];
export type AssistantChatInfo = Schemas["AssistantChatInfo"];
export type AssistantChatList = Schemas["AssistantChatList"];
export type AssistantHistory = Schemas["AssistantHistory"];
export type AssistantProposal = Schemas["AssistantProposal"];
export type AssistantProviderSettings = Schemas["AssistantProviderSettings"];
export type AssistantProposalResult = Schemas["AssistantProposalResult"];
export type TeachingDocument = Schemas["TeachingDocument"];
export type TeachingDocumentInput = Schemas["TeachingDocument"];
export type TeachingStep = Schemas["TeachingStep"];
export type TourView = Schemas["TourView"];
export type DocsDocument = {
  title: string;
  markdown: string;
  docs_url?: string | null;
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function http<T>(path: string, init?: RequestInit, retries = 3, timeoutMs = 6000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    // Per-attempt timeout: without it, a backend that accepts the connection
    // but doesn't respond (e.g. mid `uvicorn --reload` restart) makes fetch
    // hang forever — which is what leaves the startup gate stuck on "Checking
    // netlab environment" with no retry. Aborting turns that into a retryable
    // error, so the next attempt re-verifies once the backend is back up.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${getApiBase()}${path}`, {
        headers: { "content-type": "application/json" },
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        const body = await res.text();
        const detail = contentType.includes("text/html")
          ? "received an HTML page instead of API JSON"
          : body;
        throw new HttpError(res.status, `${path} -> ${res.status} ${detail}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      // Retry on network-level errors (TypeError) and our own timeout
      // (AbortError) — but not on HTTP error responses.
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      if (!(err instanceof TypeError) && !isTimeout) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const api = {
  // Startup owns the retry button. Keep each health probe bounded so a click
  // cannot leave the gate apparently frozen behind the generic 3-attempt
  // request policy used by ordinary background API calls.
  health: () => http<HealthStatus>("/api/health", undefined, 1, 5000),

  getNetlabEnvironment: () =>
    http<NetlabEnvironment>("/api/environment/netlab", { cache: "no-store" }, 1, 15000),

  setNetlabPath: (path: string | null) =>
    http<NetlabEnvironment>("/api/environment/netlab", {
      method: "PUT",
      body: JSON.stringify({ path }),
    }, 1, 30000),

  getModel: (sessionId: string) =>
    http<Record<string, unknown>>(`/api/topology/model?sessionId=${sessionId}`),

  getLenses: (sessionId: string) =>
    http<LensBundleResult>(
      `/api/topology/lenses?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
      1,
      120000
    ),

  getPath: (sessionId: string, source: string, target: string, family: string, vrf: string) => {
    const params = new URLSearchParams({ sessionId, source, target, family, vrf });
    return http<PathResult>(`/api/topology/path?${params.toString()}`, { cache: "no-store" }, 1, 120000);
  },

  getReadiness: (sessionId: string) =>
    http<ReadinessResult>(`/api/topology/readiness?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 120000),

  getConfigDiff: (sessionId: string, left: string, right: string) => {
    const params = new URLSearchParams({ sessionId, left, right });
    return http<ConfigDiffResult>(`/api/topology/config-diff?${params.toString()}`, { cache: "no-store" }, 1, 120000);
  },

  getReports: (sessionId: string) =>
    http<ReportCatalogResult>(
      `/api/topology/reports?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
      1,
      30000
    ),

  runReport: (sessionId: string, reportId: string) =>
    http<ReportRunResult>("/api/topology/reports/run", {
      method: "POST",
      body: JSON.stringify({ sessionId, reportId }),
    }, 1, 120000),

  getTeaching: (sessionId: string) =>
    http<TeachingDocument>(
      `/api/topology/teaching?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    ),

  saveTeaching: (sessionId: string, document: TeachingDocumentInput) =>
    http<Schemas["TeachingSaveResult"]>("/api/topology/teaching", {
      method: "PUT",
      body: JSON.stringify({ sessionId, document }),
    }),

  putModelYaml: (sessionId: string, yaml: string) =>
    http<Schemas["RevisionResult"]>("/api/topology/model", {
      method: "PUT",
      body: JSON.stringify({ sessionId, yaml }),
    }),

  addNetlabLink: (
    sessionId: string,
    body: {
      kind: "stub" | "lan" | "uplink" | "bridge-type";
      nodes?: string[];
      name?: string;
      bridge?: string;
      hostInterface?: string;
      bridgeType?: "bridge" | "ovs-bridge";
    }
  ) =>
    http<NetlabLinkResult>(`/api/topology/netlab-links?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getNodeConfigPreview: (sessionId: string, nodeName: string) =>
    http<ConfigPreviewResult>(
      `/api/topology/nodes/${encodeURIComponent(nodeName)}/config-preview?sessionId=${encodeURIComponent(sessionId)}`,
      undefined,
      1,
      120000
    ),

  getDeployDiff: (sessionId: string) =>
    http<DeployDiffResult>(`/api/lab/deploy-diff?sessionId=${encodeURIComponent(sessionId)}`),

  getDeployment: (sessionId: string) =>
    http<DeploymentOverview>(`/api/lab/deployment?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1),

  getDeploymentNode: (sessionId: string, node: string) =>
    http<DeploymentNodeDetail>(
      `/api/lab/deployment/node?sessionId=${encodeURIComponent(sessionId)}&node=${encodeURIComponent(node)}`,
      { cache: "no-store" },
      1
    ),

  getDeploymentLog: (sessionId: string) =>
    http<DeploymentLog>(
      `/api/lab/deployment/log?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
      1
    ),

  getRuntime: (sessionId: string) =>
    http<RuntimeContainer[]>(`/api/lab/runtime?sessionId=${encodeURIComponent(sessionId)}`, undefined, 1, 15000),

  nodeAction: (sessionId: string, node: string, action: "start" | "stop" | "restart" | "pause" | "unpause" | "save") =>
    http<CommandResult>("/api/lab/node-action", {
      method: "POST",
      body: JSON.stringify({ sessionId, node, action }),
    }, 1, 120000),

  getLabInstances: () =>
    http<LabInstance[]>("/api/lab/instances", { cache: "no-store" }, 1, 15000),

  manageLabInstance: (instanceId: string, action: "cleanup" | "force-cleanup" | "forget") =>
    http<CommandResult>(`/api/lab/instances/${encodeURIComponent(instanceId)}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }, 1, 120000),

  getEdgesharkStatus: () =>
    http<{ installed: boolean; running: boolean }>("/api/lab/capture/edgeshark", { cache: "no-store" }, 1, 15000),

  // First install pulls the ghostwire/packetflix images — allow minutes.
  installEdgeshark: () =>
    http<{ ok: boolean; message: string }>("/api/lab/capture/edgeshark/install", { method: "POST" }, 1, 600000),

  uninstallEdgeshark: () =>
    http<{ ok: boolean; message: string }>("/api/lab/capture/edgeshark/uninstall", { method: "POST" }, 1, 180000),

  killAllWiresharkVnc: () =>
    http<{ ok: boolean; message: string }>("/api/lab/capture/vnc/kill-all", { method: "POST" }, 1, 60000),

  instantiateUnit: (sessionId: string, template: string) =>
    http<Schemas["InstantiateResult"]>("/api/topology/templates/instantiate", {
      method: "POST",
      body: JSON.stringify({ sessionId, template, count: 1, prefix: template, origin: { x: 0, y: 0 } })
    }),

  labUp: (sessionId: string) =>
    http<CommandResult>("/api/lab/up", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  labDown: (sessionId: string) =>
    http<CommandResult>("/api/lab/down", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  // Plugin availability follows the installed netlab version. Never reuse a
  // stale browser response after the backend/package has been restarted or
  // upgraded.
  //
  // `sessionId` puts the session topology's own directory on the search path —
  // netlab looks there first, so without it a plugin sitting next to the
  // topology file is invisible here while `netlab up` loads it fine.
  getPlugins: (sessionId?: string) =>
    http<Plugin[]>(`/api/plugins${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`, {
      cache: "no-store",
    }),

  getPluginDoc: (id: string, sessionId?: string) =>
    http<Plugin>(
      `/api/plugins/${encodeURIComponent(id)}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`
    ),

  getPluginDebug: (sessionId?: string) =>
    http<PluginDebug>(
      `/api/plugins/debug${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`
    ),

  /** Resolve `plugin:` into the order netlab's dependency sort will run it in. */
  getPluginPipeline: (enabled: string[], sessionId?: string) => {
    const params = new URLSearchParams(enabled.map((id) => ["enabled", id]));
    if (sessionId) params.set("sessionId", sessionId);
    return http<PluginPipeline>(`/api/plugins/pipeline?${params.toString()}`, { cache: "no-store" });
  },

  /** Scaffold for a user's own plugin — a documented stub, not a blank file. */
  getPluginTemplate: (name: string) =>
    http<PluginTemplate>(`/api/plugins/template?name=${encodeURIComponent(name)}`),

  /**
   * Install a user-written plugin onto netlab's plugin search path. Either
   * upload `content` (the only route that works in the web app, where the
   * user's file isn't on the server) or point at a `sourcePath` already on
   * this machine, optionally symlinking it rather than copying.
   */
  importPlugin: (body: PluginImportRequest) =>
    http<PluginImportResult>("/api/plugins/import", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Subscribe to the SSE status stream; returns an unsubscribe fn. */
  subscribeStatus(onStatus: (status: unknown) => void): () => void {
    const es = new EventSource(`${getApiBase()}/api/lab/status/stream`);
    es.onmessage = (e) => {
      try {
        onStatus(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  },

  /**
   * Subscribe to backend push events (`{type: "files" | "workspaces"}`), fed
   * by the server-side workspace watcher; returns an unsubscribe fn. Callers
   * should keep a slow polling fallback — the stream is best-effort (the
   * watcher is disabled when watchfiles isn't installed on the backend).
   */
  subscribeEvents(onEvent: (event: { type?: string }) => void): () => void {
    const es = new EventSource(`${getApiBase()}/api/lab/events/stream`);
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  },

  labInitial: (sessionId: string) =>
    http<CommandResult>("/api/lab/initial", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  labCreateConfigs: (sessionId: string) =>
    http<CommandResult>("/api/lab/create-configs", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  getMultiserver: (sessionId: string) =>
    http<MultiserverResult>(`/api/topology/multiserver?sessionId=${sessionId}`),

  putMultiserver: (
    sessionId: string,
    body: {
      enabled: boolean;
      assignment?: string;
      servers?: WorkerInfo[];
      vxlan?: MultiserverVxlan;
    }
  ) =>
    http<MultiserverResult>(`/api/topology/multiserver?sessionId=${sessionId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getDevices: () => http<DeviceEntry[]>("/api/schema/devices"),

  /** Locally available `repository:tag` docker image references (autocomplete). */
  getImageReferences: () => http<string[]>("/api/lab/images/references"),

  getDoc: (path: string) => http<DocsDocument>(`/api/docs?path=${encodeURIComponent(path)}`),

  labRestart: (sessionId: string) =>
    http<CommandResult>("/api/lab/restart", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  labCollect: (sessionId: string) =>
    http<CommandResult>("/api/lab/collect", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  labValidate: (sessionId: string) =>
    http<ValidationResult>("/api/lab/validate", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }, 1, 120000),

  labPreflight: (sessionId: string) =>
    http<ValidationResult>("/api/lab/preflight", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }, 1, 120000),

  labGraph: (sessionId: string, outputFormat = "d2") =>
    http<CommandResult>(`/api/lab/graph?output_format=${outputFormat}`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  /** `containerlab graph --drawio` via clab-io-draw — needs Docker and a
   * generated clab.yml (Create/Deploy must have run first). No "interactive"
   * layout: that mode is clab-io-draw's own full-screen terminal wizard
   * (assign-levels TUI) and needs a real TTY, which a backend subprocess
   * spawned from an HTTP request can never provide — it just hangs. */
  labGraphDrawio: (sessionId: string, layout: "vertical" | "horizontal" = "vertical") =>
    http<CommandResult>(`/api/lab/graph/drawio?layout=${layout}`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }, 1, 120000),

  labInspect: (sessionId: string) =>
    http<CommandResult>("/api/lab/inspect", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  labFcli: (sessionId: string, command: string) =>
    http<CommandResult>("/api/lab/fcli", {
      method: "POST",
      body: JSON.stringify({ sessionId, command }),
    }, 1, 120000),

  netlabVersion: () => http<VersionResult>("/api/lab/version"),

  getWorkspaces: () =>
    http<{ workspaces: Array<{ path: string; exists: boolean }> }>("/api/lab/workspaces"),

  addWorkspace: (path: string) =>
    http<{ workspaces: Array<{ path: string; exists: boolean }> }>("/api/lab/workspaces", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  removeWorkspace: (path: string) =>
    http<{ workspaces: Array<{ path: string; exists: boolean }> }>("/api/lab/workspaces", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    }),

  cloneRepo: (repoUrl: string, targetWorkspace?: string) =>
    http<{ ok: boolean; message: string }>(
      "/api/lab/clone",
      {
        method: "POST",
        body: JSON.stringify({ repoUrl, targetWorkspace }),
      },
      1,
      120000
    ),

  makeFolder: (path: string, name: string) =>
    http<{ ok: boolean; message: string }>("/api/lab/files/mkdir", {
      method: "POST",
      body: JSON.stringify({ path, name }),
    }),

  listExampleLabs: () =>
    http<{ labs: Array<{ name: string; description: string; repoUrl: string; stars: number }> }>(
      "/api/lab/examples"
    ),

  browseFs: (path?: string) =>
    http<{ path: string; parent: string | null; entries: Array<{ name: string; path: string; isDir: boolean }> }>(
      `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`
    ),

  // --- AI assistant (optional backend feature; every call 404s when it is
  // not installed, which is how the UI decides to hide the panel) ---

  assistantCapabilities: () =>
    http<AssistantCapabilities>("/api/assistant/capabilities", undefined, 1, 4000),

  listAssistantChats: (sessionId: string) =>
    http<AssistantChatList>(
      `/api/assistant/chats?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    ),

  createAssistantChat: (providerId: string, sessionId: string, mode: string, model: string) =>
    http<AssistantChatInfo>("/api/assistant/chats", {
      method: "POST",
      body: JSON.stringify({ providerId, sessionId, mode, model }),
    }),

  getAssistantChat: (chatId: string) => http<AssistantHistory>(`/api/assistant/chats/${chatId}`),

  sendAssistantMessage: (chatId: string, text: string, selection: string[]) =>
    http<{ ok: boolean }>(`/api/assistant/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, selection }),
    }),

  cancelAssistantTurn: (chatId: string) =>
    http<{ ok: boolean }>(`/api/assistant/chats/${chatId}/cancel`, { method: "POST" }),

  /** Point an existing chat at a different provider/model, keeping its transcript. */
  switchAssistantChatProvider: (chatId: string, providerId: string, model: string) =>
    http<AssistantChatInfo>(`/api/assistant/chats/${chatId}/provider`, {
      method: "POST",
      body: JSON.stringify({ providerId, model }),
    }),

  deleteAssistantChat: (chatId: string) =>
    http<{ ok: boolean }>(`/api/assistant/chats/${chatId}`, { method: "DELETE" }),

  applyAssistantProposal: (proposalId: string) =>
    http<AssistantProposalResult>(`/api/assistant/proposals/${proposalId}/apply`, { method: "POST" }, 1, 20000),

  rejectAssistantProposal: (proposalId: string) =>
    http<AssistantProposalResult>(`/api/assistant/proposals/${proposalId}/reject`, { method: "POST" }),

  getAssistantProviderSettings: (providerId: string) =>
    http<AssistantProviderSettings>(`/api/assistant/providers/${providerId}/settings`),

  putAssistantProviderSettings: (providerId: string, values: { apiKey?: string; model?: string; baseUrl?: string }) =>
    http<AssistantProviderSettings>(`/api/assistant/providers/${providerId}/settings`, {
      method: "PUT",
      body: JSON.stringify(values),
    }),

  deleteAssistantProviderSettings: (providerId: string) =>
    http<{ ok: boolean }>(`/api/assistant/providers/${providerId}/settings`, { method: "DELETE" }),

  /** Models the provider advertises (best-effort — empty if it can't enumerate). */
  getAssistantProviderModels: (providerId: string) =>
    http<{ models: string[] }>(`/api/assistant/providers/${providerId}/models`),

  /** Subscribe to one chat's event stream; returns an unsubscribe fn. */
  subscribeAssistantChat(
    chatId: string,
    onFrame: (frame: Record<string, unknown>) => void,
    opts?: { replay?: boolean }
  ): () => void {
    const query = opts?.replay ? "?replay=1" : "";
    const es = new EventSource(`${getApiBase()}/api/assistant/chats/${chatId}/events${query}`);
    es.onmessage = (e) => {
      try {
        onFrame(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  },
};
