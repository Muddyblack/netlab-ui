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

/** A backend push event (`{type: "files" | "workspaces" | "proposals" | "ui" …}`). */
export type BackendEvent = { type?: string; sessionId?: string; [key: string]: unknown };
let eventSource: EventSource | null = null;
const eventHandlers = new Set<(event: BackendEvent) => void>();

export type HealthStatus = Schemas["HealthStatus"];
export type ContainerDiagnostics = Schemas["ContainerDiagnostics"];
export type ContainerCheck = Schemas["ContainerCheck"];
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
export type Generator = Schemas["Generator"];
export type GeneratorParam = Schemas["GeneratorParam"];
export type GeneratorApplyRequest = Schemas["GeneratorApplyRequest"];
export type GeneratorPreview = Schemas["GeneratorPreview"];
export type TopologyPattern = Schemas["TopologyPattern"];
export type VersionResult = Schemas["VersionResult"];
export type ExecTargets = Schemas["ExecTargets"];
export type ExecResolved = Schemas["ExecResolved"];
export type LabSearchHit = Schemas["LabSearchHit"];
export type ConfigSnapshot = Schemas["ConfigSnapshot"];
export type NodeConfigFiles = Schemas["NodeConfigFiles"];
export type LabTools = Schemas["LabTools"];
export type LabTool = Schemas["LabTool"];
export type ToolActionResult = Schemas["ToolActionResult"];
export type MonitoringState = Schemas["MonitoringState"];
export type MonitoringSummary = Schemas["MonitoringSummary"];
export type MonitoringActionResult = Schemas["MonitoringActionResult"];
export type MonitoringScope = Schemas["MonitoringScope"];
export type MonitoringScopeNode = Schemas["ScopeNode"];
/** Which nodes monitoring covers: selector lines for `monitoring.nodes` and `monitoring.light`, and the random seed. */
export type MonitoringSelection = { nodes: string[]; light: string[]; seed: number };
export type PromSample = Schemas["PromSample"];
export type ScenarioRun = Schemas["ScenarioRun"];
export type ScenarioRequest = Schemas["ScenarioRequest"];
export type FaultTests = Schemas["FaultTests"];
export type FaultTestDefinition = Schemas["FaultTest"];
export type ValidationCheck = Schemas["ValidationCheck"];
export type SetupCatalog = Schemas["SetupCatalog"];
export type BoxRecipe = Schemas["BoxRecipe"];
export type CustomConfigs = Schemas["CustomConfigs"];
export type ConfigDrift = Schemas["ConfigDrift"];
export type RunningConfigDiff = Schemas["RunningConfigDiff"];
export type LabSearchResult = Schemas["LabSearchResult"];
export type ExecScript = Schemas["ExecScript"];
export type ExecMode = Schemas["ExecRequest"]["mode"];

/** One node's result from `POST /api/lab/exec/stream`. */
export interface ExecResult {
  node: string;
  command: string;
  mode: ExecMode;
  /** Real exit status when the node could report one (shell on containers). */
  exitCode: number | null;
  timedOut?: boolean;
  /** Non-zero exit, timeout, or a CLI error reply ("% Unknown command"). */
  failed?: boolean;
  output: string;
  stderr: string;
  durationMs?: number;
}
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
  source: "clab" | "blended" | "model" | "locked-preview" | "failed-preview" | "transform";
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
export type DeployPlan = Schemas["DeployPlan"];
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
export type AssistantProposal = Schemas["AssistantProposal"];
export type AssistantProposalList = Schemas["AssistantProposalList"];
export type AssistantProposalResult = Schemas["AssistantProposalResult"];
export type TeachingDocument = Schemas["TeachingDocument-Output"];
export type TeachingDocumentInput = Schemas["TeachingDocument-Input"];
export type TeachingStep = Schemas["TeachingStep"];
export type ValidationTestInfo = Schemas["ValidationTestInfo"];
export type TeachingCheckResult = Schemas["TeachingCheckResult"];
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

/** POST `body` as JSON and hand each SSE `data:` frame to `onFrame`. */
async function postEventStream(
  path: string,
  body: unknown,
  onFrame: (frame: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try { detail = ((await res.json()) as { detail?: string }).detail ?? detail; } catch { /* not JSON */ }
    throw new HttpError(res.status, detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (line) onFrame(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
  }
}

export const api = {
  // Startup owns the retry button. Keep each health probe bounded so a click
  // cannot leave the gate apparently frozen behind the generic 3-attempt
  // request policy used by ordinary background API calls.
  health: () => http<HealthStatus>("/api/health", undefined, 1, 5000),

  getContainerDiagnostics: (refresh = false) =>
    http<ContainerDiagnostics>(`/api/environment/container${refresh ? "?refresh=true" : ""}`, { cache: "no-store" }, 1, 15000),

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

  /** A report in one of its netlab formats (report.exports), to download or open. */
  reportExportUrl: (sessionId: string, name: string, download = true) =>
    `${getApiBase()}/api/topology/reports/export?${new URLSearchParams({ sessionId, name, download: String(download) }).toString()}`,

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

  getTeachingTests: (sessionId: string) =>
    http<{ tests: ValidationTestInfo[] }>(`/api/topology/teaching/tests?sessionId=${encodeURIComponent(sessionId)}`, undefined, 1, 60000),

  checkTeachingStep: (sessionId: string, tests: string[]) =>
    http<TeachingCheckResult>("/api/topology/teaching/check", { method: "POST", body: JSON.stringify({ sessionId, tests }) }, 1, 330000),

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

  getDeployPlan: (sessionId: string) =>
    http<DeployPlan>(`/api/lab/deploy-plan?sessionId=${encodeURIComponent(sessionId)}`),

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

  copyLab: (topologyPath: string, name: string, targetWorkspace: string) =>
    http<Schemas["CopyLabResult"]>("/api/lab/copy", { method: "POST", body: JSON.stringify({ topologyPath, name, targetWorkspace }) }, 1, 60000),

  deleteLab: (topologyPath: string, dryRun = false) =>
    http<{ deleted: string; kind: "folder" | "file" }>("/api/lab/delete", { method: "POST", body: JSON.stringify({ topologyPath, dryRun }) }, 1, 60000),

  getLease: (sessionId: string) =>
    http<{ expiresAt?: string | null }>(`/api/lab/lease?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1),

  extendLease: (sessionId: string) =>
    http<{ expiresAt?: string | null }>("/api/lab/lease/extend", { method: "POST", body: JSON.stringify({ sessionId }) }, 1),

  listConfigSnapshots: (sessionId: string) =>
    http<{ snapshots: ConfigSnapshot[] }>(`/api/lab/configs/snapshots?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }),

  listNodeConfigs: (sessionId: string, node: string) =>
    http<NodeConfigFiles>(`/api/lab/node-configs?sessionId=${encodeURIComponent(sessionId)}&node=${encodeURIComponent(node)}`, { cache: "no-store" }),

  getSetupCatalog: () => http<SetupCatalog>("/api/environment/setup", { cache: "no-store" }, 1, 30000),

  getBoxRecipe: (device: string) =>
    http<BoxRecipe>(`/api/environment/setup/box-recipe?device=${encodeURIComponent(device)}`, undefined, 1, 30000),

  /** The deployed lab as a containerlab tarball (runs Ansible to collect configs). */
  downloadClabTarball: async (sessionId: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${getApiBase()}/api/lab/clab-tarball?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) {
      const detail = await res.json().then((data: { detail?: string }) => data.detail, () => undefined);
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "lab.tar.gz";
    return { blob: await res.blob(), filename: name };
  },

  getCustomConfigs: (sessionId: string) =>
    http<CustomConfigs>(`/api/lab/custom-configs?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }),

  createCustomConfig: (sessionId: string, name: string, device: string) =>
    http<{ path: string }>("/api/lab/custom-configs", { method: "POST", body: JSON.stringify({ sessionId, name, device }) }, 1),

  getLabTools: (sessionId: string) =>
    http<LabTools>(`/api/lab/tools?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 30000),

  setLabTool: (sessionId: string, tool: string, enabled: boolean) =>
    http<LabTools>("/api/lab/tools", { method: "PUT", body: JSON.stringify({ sessionId, tool, enabled }) }, 1, 30000),

  labToolAction: (sessionId: string, tool: string, action: "up" | "down") =>
    http<ToolActionResult>("/api/lab/tools/action", { method: "POST", body: JSON.stringify({ sessionId, tool, action }) }, 1, 330000),

  getMonitoring: (sessionId: string) =>
    http<MonitoringState>(`/api/lab/monitoring?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 30000),

  /** Turn monitoring on/off and set where it runs; `options` sets the opt-in parts (logs, alert targets;
   * an omitted one stays as it is, an empty address removes a target). */
  setMonitoring: (
    sessionId: string,
    enabled: boolean,
    placement?: "tool" | "node",
    options: { logs?: boolean; webhook?: string; slack?: string } = {}
  ) =>
    http<MonitoringState>("/api/lab/monitoring", { method: "PUT", body: JSON.stringify({ sessionId, enabled, placement, ...options }) }, 1, 30000),

  getMonitoringScope: (sessionId: string) =>
    http<MonitoringScope>(`/api/lab/monitoring/scope?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 60000),

  /** What a selection would match; nothing is saved. */
  previewMonitoringScope: (sessionId: string, selection: MonitoringSelection) =>
    http<MonitoringScope>("/api/lab/monitoring/scope/preview", { method: "POST", body: JSON.stringify({ sessionId, ...selection }) }, 1, 60000),

  /** Save a selection into the topology; with `apply`, also make a running stack use it (restarts the monitoring containers). */
  setMonitoringScope: (sessionId: string, selection: MonitoringSelection, apply: boolean) =>
    http<MonitoringScope>("/api/lab/monitoring/scope", { method: "PUT", body: JSON.stringify({ sessionId, ...selection, apply }) }, 1, 400000),

  getMonitoringSummary: (sessionId: string) =>
    http<MonitoringSummary>(`/api/lab/monitoring/summary?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 30000),

  queryMonitoring: (sessionId: string, query: string) =>
    http<PromSample[]>(`/api/lab/monitoring/query?sessionId=${encodeURIComponent(sessionId)}&query=${encodeURIComponent(query)}`, { cache: "no-store" }, 1, 30000),

  /** Fields with a server default may be left out (a named test needs only `name`). */
  startScenario: (request: Partial<ScenarioRequest> & { sessionId: string }) =>
    http<ScenarioRun>("/api/lab/monitoring/scenarios", { method: "POST", body: JSON.stringify(request) }, 1, 30000),

  /** Fault tests the topology defines (monitoring.faults) and its netlab validation tests. */
  listFaultTests: (sessionId: string) =>
    http<FaultTests>(`/api/lab/monitoring/faults?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }),

  listScenarios: (sessionId: string) =>
    http<ScenarioRun[]>(`/api/lab/monitoring/scenarios?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 30000),

  cancelScenario: (scenarioId: string) =>
    http<{ ok: boolean }>(`/api/lab/monitoring/scenarios/${encodeURIComponent(scenarioId)}/cancel`, { method: "POST" }, 1, 30000),

  monitoringAction: (sessionId: string, action: "up" | "down") =>
    http<MonitoringActionResult>("/api/lab/monitoring/action", { method: "POST", body: JSON.stringify({ sessionId, action }) }, 1, 330000),

  takeConfigSnapshot: (sessionId: string, reason = "manual snapshot") =>
    http<ConfigSnapshot>("/api/lab/configs/snapshots", { method: "POST", body: JSON.stringify({ sessionId, reason }) }, 1, 120000),

  getConfigDrift: (sessionId: string, snapshot: string) =>
    http<ConfigDrift>(`/api/lab/configs/drift?sessionId=${encodeURIComponent(sessionId)}&snapshot=${encodeURIComponent(snapshot)}`, { cache: "no-store" }, 1, 120000),

  getRunningConfigDiff: (sessionId: string, node: string, left: string, right = "live") =>
    http<RunningConfigDiff>(
      `/api/lab/configs/diff?sessionId=${encodeURIComponent(sessionId)}&node=${encodeURIComponent(node)}&left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
      { cache: "no-store" }, 1, 60000),

  searchLab: (sessionId: string, query: string) =>
    http<LabSearchResult>(`/api/topology/search?sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(query)}`, undefined, 1, 30000),

  getExecTargets: (sessionId: string) =>
    http<ExecTargets>(`/api/lab/exec/targets?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }, 1, 15000),

  /** What a "Run on" selection (names, groups, patterns like r1-r3 or leaf*) resolves to. */
  resolveExecTargets: (sessionId: string, nodes: string[]) =>
    http<ExecResolved>("/api/lab/exec/resolve", { method: "POST", body: JSON.stringify({ sessionId, nodes }) }, 1, 15000),

  getExecScripts: (sessionId: string) =>
    http<{ scripts: ExecScript[] }>(`/api/lab/exec/scripts?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }),

  saveExecScripts: (sessionId: string, scripts: ExecScript[]) =>
    http<{ scripts: ExecScript[] }>("/api/lab/exec/scripts", {
      method: "PUT",
      body: JSON.stringify({ sessionId, scripts }),
    }),

  /** Run one command on several nodes; `onResult` fires per node as it finishes. */
  async execOnNodes(
    request: { sessionId: string; nodes: string[]; command: string; mode: ExecMode; timeoutS?: number },
    handlers: { onTargets?: (nodes: string[]) => void; onResult: (result: ExecResult) => void },
    signal?: AbortSignal,
  ): Promise<void> {
    await postEventStream("/api/lab/exec/stream", request, (frame) => {
      if (Array.isArray(frame.targets)) handlers.onTargets?.(frame.targets as string[]);
      if (frame.result) handlers.onResult(frame.result as ExecResult);
    }, signal);
  },

  getEdgesharkStatus: () =>
    http<{ installed: boolean; running: boolean }>("/api/lab/capture/edgeshark", { cache: "no-store" }, 1, 15000),

  // First install pulls the ghostwire/packetflix images — allow minutes.
  installEdgeshark: () =>
    http<{ ok: boolean; message: string }>("/api/lab/capture/edgeshark/install", { method: "POST" }, 1, 1200000),

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
  getPluginTemplate: (name: string, kind: "plugin" | "generator" = "plugin") =>
    http<PluginTemplate>(`/api/plugins/template?name=${encodeURIComponent(name)}&kind=${kind}`),

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

  /** Plugins that build topology (fabric, node.clone, the user's own) and their parameters. */
  getGenerators: (sessionId?: string) =>
    http<Generator[]>(
      `/api/plugins/generators${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
      { cache: "no-store" }
    ),

  /** Shapes in the hand-built topology a generator could produce instead. */
  getTopologyPatterns: (sessionId: string) =>
    http<TopologyPattern[]>(`/api/plugins/generators/patterns?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    }),

  /** Diff + netlab expansion for a generator; nothing is written. */
  previewGenerator: (body: GeneratorApplyRequest) =>
    http<GeneratorPreview>("/api/plugins/generators/preview", { method: "POST", body: JSON.stringify(body) }, 1, 60000),

  /** Apply a previewed generator through the session host, as one undoable step. */
  applyTopologyCommand: (sessionId: string, command: Record<string, unknown>) =>
    http<Schemas["CommandAck"]>("/api/topology/command", {
      method: "POST",
      body: JSON.stringify({ sessionId, command }),
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
  subscribeEvents(onEvent: (event: BackendEvent) => void): () => void {
    // One shared stream for every subscriber: browsers allow only ~6 open
    // HTTP/1.1 connections per host, and each EventSource holds one forever.
    eventHandlers.add(onEvent);
    if (!eventSource) {
      eventSource = new EventSource(`${getApiBase()}/api/lab/events/stream`);
      eventSource.onmessage = (e) => {
        let event: BackendEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return; // ignore malformed frames
        }
        for (const handler of Array.from(eventHandlers)) handler(event);
      };
    }
    return () => {
      eventHandlers.delete(onEvent);
      if (!eventHandlers.size && eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
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

  /** `containerlab save` for every node: running config becomes startup config. */
  labSave: (sessionId: string, copy?: string) =>
    http<CommandResult>("/api/lab/save", {
      method: "POST",
      body: JSON.stringify({ sessionId, copy }),
    }, 1, 120000),

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

  // --- AI agents over MCP (optional backend feature; every call 404s when it
  // is not installed, which is how the UI decides to hide the panel) ---

  assistantCapabilities: () =>
    http<AssistantCapabilities>("/api/assistant/capabilities", undefined, 1, 4000),

  listAssistantProposals: (sessionId: string) =>
    http<AssistantProposalList>(
      `/api/assistant/proposals?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    ),

  /** `positions` is where the canvas drew the nodes the proposal adds, so they land there. */
  applyAssistantProposal: (proposalId: string, positions?: Record<string, { x: number; y: number }>) =>
    http<AssistantProposalResult>(`/api/assistant/proposals/${proposalId}/apply`, {
      method: "POST",
      body: JSON.stringify({ positions: positions ?? {} }),
    }, 1, 20000),

  rejectAssistantProposal: (proposalId: string) =>
    http<AssistantProposalResult>(`/api/assistant/proposals/${proposalId}/reject`, { method: "POST" }),

  /** What is selected on the canvas, for agents' get_selection_context tool. */
  setAssistantSelection: (sessionId: string, nodes: string[]) =>
    http<{ ok: boolean }>("/api/assistant/selection", {
      method: "POST",
      body: JSON.stringify({ sessionId, nodes }),
    }),
  /** What this window can open for the lab, so an attached agent can show the user around. */
  setAssistantUiActions: (sessionId: string, actions: { id: string; label: string; detail: string }[]) =>
    http<{ ok: boolean }>("/api/assistant/ui-actions", {
      method: "POST",
      body: JSON.stringify({ sessionId, actions }),
    }),
};
