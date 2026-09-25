import { createApiClabUiHost as officialCreateApiClabUiHost } from "@containerlab/clab-ui/host";
import type { ClabUiHost, ClabUiTopoViewerHost, ClabUiTopoViewerEvent, HostRuntimeContainer, TopoViewerLifecycleAction, TopoViewerNodeAction, TopoViewerSvgExportPayload } from "@containerlab/clab-ui/host";
import type { DeploymentProgress } from "../components/CanvasDeploymentProgress";
import { setLifecycleContext, type DeployDecision, type LifecycleCompletion } from "../hooks/useLabLifecycle";
import { api, type LabFileEntry } from "../api/client";
import { getApiBase } from "../api/endpoint";
import { postLinkCommand } from "../api/linkCommands";
import { parseIconListResponse, parseIconNamesResponse, selectIconFile, type CustomIconListItem } from "./iconHelpers";
import { createImagesHost } from "./imagesHost";
import { runningLabMatches } from "./runningMatch";
import type { RunningLabsStatus } from "../hooks/useAppData";

export interface AppClabUiHost extends ClabUiHost {
  /** Opens a backend session. Does not make it the host's active session —
   * helper sessions (explorer actions on a lab that isn't open) must not
   * redirect canvas callbacks; call `activateSession` for the open tab. */
  createSession(topologyPath: string): Promise<{ sessionId: string }>;
  /** Marks `sessionId` as the one the canvas is showing (or clears it). */
  activateSession(sessionId: string | null): void;
  disposeSession(sessionId: string): Promise<void>;
  createLab?: (labName: string) => Promise<{ topologyRef: LabFileEntry["topologyRef"] }>;
  listLabFiles?: () => Promise<LabFileEntry[]>;
  sessionId: string | null;
  onNodeAction?: (action: string, nodeName: string) => void;
  /** Outcome of a link fault action (down/up, impairment) for a toast. */
  onLinkResult?: (message: string, severity: "success" | "error" | "info") => void;
  onBeforeDeploy?: (sessionId: string) => Promise<DeployDecision>;
  onDeploymentProgress?: (progress: DeploymentProgress) => void;
  onLifecycleFinished?: (result: LifecycleCompletion) => void;
  setLifecycleCancel?(cancel: (() => void) | null): void;
  setRuntimeContainers(containers: HostRuntimeContainer[]): void;
  emitTopoViewerEvent(event: ClabUiTopoViewerEvent): void;
}

type OfficialHostOptions = NonNullable<Parameters<typeof officialCreateApiClabUiHost>[0]>;

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the browser has picked the download up.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function buildPacketflixUri(configuredHost: string, configuredPortRaw: string | undefined, containerName: string, interfaceName: string): string {
  const authorityHost = configuredHost.includes(":") && !configuredHost.startsWith("[")
    ? `[${configuredHost}]`
    : configuredHost;
  const configuredPort = Number(configuredPortRaw);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 5001;
  return `packetflix://${authorityHost}:${port}/interfaces?container=${encodeURIComponent(containerName)}&iface=${encodeURIComponent(interfaceName)}`;
}

async function startVncCapture({
  safeFetch,
  BASE,
  containerName,
  interfaceName,
  view,
  onError,
}: {
  safeFetch: typeof fetch;
  BASE: string;
  containerName: string;
  interfaceName: string;
  view: Window | null;
  onError?: (message: string) => void;
}): Promise<void> {
  try {
    const res = await safeFetch(`${BASE}/api/lab/capture/vnc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        container: containerName,
        interface: interfaceName,
        darkMode: window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
      }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null) as { detail?: unknown } | null)?.detail;
      throw new Error(typeof detail === "string" ? detail : `Capture failed (${res.status})`);
    }
    const session = await res.json() as { port: number };
    // The VNC container publishes its web UI on the backend's docker
    // host, so reach it via the same hostname the API is served from.
    const apiHost = BASE ? new URL(BASE, window.location.origin).hostname : window.location.hostname;
    const url = `http://${apiHost.includes(":") && !apiHost.startsWith("[") ? `[${apiHost}]` : apiHost}:${session.port}/`;
    if (view && !view.closed) view.location.replace(url);
    else window.open(url, "_blank");
  } catch (err) {
    view?.close();
    onError?.(err instanceof Error ? err.message : String(err));
  }
}

/** The keys of runner.LIFECYCLE_ACTIONS on the Python side. */
type BackendLifecycleAction = "up" | "down" | "initial" | "restart";

// The "*Cleanup" variants are containerlab's --cleanup flavours of
// deploy/redeploy/destroy (wipe stale artifacts first), not a separate
// teardown phase. clab-ui's Deploy button actually emits `deployLabCleanup`,
// so failing to map it here meant `netlab up` never ran — the lab's
// containers were never created, and every later `initial` failed with
// "No such container". netlab regenerates node_files on `up`, so mapping
// the cleanup variants onto the same base action is the correct intent.
function mapLifecycleAction(action: TopoViewerLifecycleAction, labDeployed: boolean): BackendLifecycleAction | null {
  if (action === "deployLab" || action === "deployLabCleanup") return "up";
  // Offered on a running lab, where netlab refuses a second `up` in the same
  // directory: restart is netlab's down + up.
  if (action === "redeployLab" || action === "redeployLabCleanup" || action === "startLab") return "restart";
  if (action === "applyLab") {
    // clab-ui's primary ▶ button is always "Apply" — containerlab's
    // deploy-or-reconcile. For netlab that is `netlab up` while the lab is not
    // running (mapping it to `initial` there just failed with "No such
    // container"), and `netlab initial` — re-push the generated configuration
    // — once it is.
    return labDeployed ? "initial" : "up";
  }
  if (action === "destroyLab" || action === "destroyLabCleanup" || action === "stopLab") return "down";
  if (action === "restartLab") return "restart";
  return null;
}

/** Reads an SSE body of `data: <json>\n\n` frames, calling onFrame for each complete one. */
async function consumeSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onFrame: (raw: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      onFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) onFrame(buffer);
}

export function createApiClabUiHost(options?: {
  explorer?: OfficialHostOptions["explorer"];
  meta?: OfficialHostOptions["meta"];
  onError?: (message: string) => void;
}): AppClabUiHost {
  // Captured once per host; recreate the host to switch backends at runtime.
  const BASE = getApiBase();

  // Every backend call goes through here so a *network-level* failure (the fetch
  // promise rejecting — backend down, DNS/refused, offline) surfaces a friendly
  // toast instead of an unhandled "TypeError: Failed to fetch". HTTP error
  // responses (res.ok === false) are a separate, call-specific concern and are
  // still handled by each caller. The original error is rethrown so existing
  // control flow (and console diagnostics) is preserved.
  const safeFetch: typeof fetch = (input, init) =>
    globalThis.fetch(input, init).catch((err) => {
      options?.onError?.("Backend unreachable — is the server running?");
      throw err;
    });

  const baseHost = officialCreateApiClabUiHost({
    baseUrl: BASE,
    explorer: options?.explorer,
    meta: options?.meta,
    images: createImagesHost(safeFetch, BASE),
  });

  const subscribers = new Set<(event: ClabUiTopoViewerEvent) => void>();
  let currentSessionId: string | null = null;
  // Topology path of every session this host opened (for per-lab state).
  const sessionPaths = new Map<string, string>();
  let runtimeContainers: HostRuntimeContainer[] = [];
  let activeLifecycleCancel: (() => void) | null = null;

  // Shared by saveCustomNode/deleteCustomNode/setDefaultCustomNode: each just
  // issues a different request but broadcasts the same customNodesUpdated
  // event from the response.
  const postCustomNodeAction = (actionLabel: string, request: Promise<Response>) => {
    request
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to ${actionLabel} custom node`);
        return res.json();
      })
      .then((cnData) => {
        subscribers.forEach((s) =>
          s({
            type: "customNodesUpdated",
            customNodes: cnData.customNodes || [],
            defaultNode: cnData.defaultNode || "",
          })
        );
      })
      .catch((err) => console.error(`Failed to ${actionLabel} custom node:`, err));
  };

  const openCapture = (nodeName: string, interfaceName: string) => {
    const container = runtimeContainers.find(
      (candidate) => candidate.name === nodeName || candidate.nodeName === nodeName,
    );
    const isRunning = container?.state.toLowerCase().includes("run") ?? false;
    const hasInterface = container?.interfaces?.some(
      (candidate) => candidate.name === interfaceName || candidate.alias === interfaceName,
    ) ?? false;

    // runtime.collect only supplies interfaces for running `provider: clab`
    // nodes. This keeps capture unavailable for stopped and non-containerlab
    // nodes, including nodes in otherwise mixed-provider netlab topologies.
    if (!container || !isRunning || !hasInterface) {
      options?.onError?.("Packet capture is only available on running containerlab interfaces.");
      return;
    }

    // VITE_PACKETFLIX_HOST opts into the native flow: a packetflix:// deep
    // link handled by a locally installed Wireshark + cshargextcap plugin.
    const configuredHost = import.meta.env.VITE_PACKETFLIX_HOST?.trim();
    if (configuredHost) {
      window.location.assign(buildPacketflixUri(configuredHost, import.meta.env.VITE_PACKETFLIX_PORT, container.name, interfaceName));
      return;
    }

    // Default flow: the backend starts a Wireshark-in-the-browser (noVNC)
    // container wired to edgeshark's packetflix service. Open the tab
    // synchronously (popup blockers only allow window.open inside the click)
    // and point it at the capture UI once the backend reports it ready.
    const view = window.open("", "_blank");
    if (view) {
      view.document.title = "Wireshark";
      view.document.body.textContent = `Starting Wireshark capture on ${nodeName}:${interfaceName}…`;
    }
    void startVncCapture({ safeFetch, BASE, containerName: container.name, interfaceName, view, onError: options?.onError });
  };

  const emitIconList = (icons: CustomIconListItem[]) => {
    subscribers.forEach((s) => s({ type: "iconList", icons }));
  };

  const loadIconList = async () => {
    try {
      const res = await safeFetch(`${BASE}/api/lab/icons`);
      if (!res.ok) throw new Error(`Failed to load custom icons: ${res.status}`);
      emitIconList(parseIconListResponse(await res.json()));
    } catch (err) {
      console.error("Failed to load custom icons:", err);
      emitIconList([]);
    }
  };

  // Subscribe to status stream to update the deploymentState in clab-ui in
  // real-time. Only emit `modeChanged` when the deployment state actually
  // flips — clab-ui's setMode clears editing state (open dialogs/panels), so
  // firing it on every identical SSE tick would close dialogs the user has
  // open (e.g. the "Create Node Template" modal) "after a short while".
  //
  // The state is the *canvas lab's*: another lab running on the host must not
  // make an undeployed topology look deployed (that disabled Deploy entries
  // and turned ▶ Apply into a re-push to containers that do not exist).
  let lastDeploymentState: "deployed" | "undeployed" | null = null;
  let lastStatus: RunningLabsStatus | null = null;
  const isActiveLabDeployed = (): boolean => {
    const path = currentSessionId ? sessionPaths.get(currentSessionId) : undefined;
    if (!path || !lastStatus) return false;
    return Object.values(lastStatus).some((info) =>
      runningLabMatches(info, path) && Object.keys(info?.nodes ?? {}).length > 0
    );
  };
  const emitDeploymentState = () => {
    const deploymentState: "deployed" | "undeployed" = isActiveLabDeployed() ? "deployed" : "undeployed";
    if (deploymentState === lastDeploymentState) return;
    lastDeploymentState = deploymentState;
    subscribers.forEach((s) =>
      s({
        type: "modeChanged",
        mode: "editor",
        deploymentState,
      })
    );
  };
  api.subscribeStatus((status) => {
    lastStatus = status && typeof status === "object" ? (status as RunningLabsStatus) : null;
    emitDeploymentState();
  });

  const topoViewerHost: ClabUiTopoViewerHost = {
    runLifecycle(action: TopoViewerLifecycleAction) {
      if (!currentSessionId) return;

      const backendAction = mapLifecycleAction(action, isActiveLabDeployed());
      if (!backendAction) {
        subscribers.forEach((s) => s({
          type: "lifecycleStatus",
          status: "error",
          errorMessage: `Unsupported lifecycle action: ${action}`,
        }));
        return;
      }

      const emitStatus = (event: ClabUiTopoViewerEvent) =>
        subscribers.forEach((s) => s(event));

      // Stream the command output live via SSE so users see progress instead
      // of a frozen spinner. Frames: {stream, line} per output line,
      // {done, code} on completion, {error} if the command could not run.
      void (async () => {
        let settled = false;
        let completionSent = false;
        const controller = new AbortController();
        const sessionId = currentSessionId;
        const label = {
          up: "netlab up",
          down: "netlab down",
          initial: "netlab initial",
          restart: "netlab restart",
        }[backendAction];
        let suggestedMultilabId: number | undefined;
        const finish = (success: boolean, errorMessage?: string) => {
          if (completionSent) return;
          completionSent = true;
          resultHost.onLifecycleFinished?.({
            action: backendAction,
            label,
            success,
            errorMessage,
            sessionId: sessionId ?? undefined,
            suggestedMultilabId,
          });
        };
        // Canvas commands target the canvas lab: drop any name a previous
        // explorer command left on the (patched) lifecycle modal.
        setLifecycleContext(null);
        const cancel = () => {
          if (settled) return;
          settled = true;
          controller.abort();
          const errorMessage = `${label} cancelled by user`;
          emitStatus({ type: "lifecycleLog", line: errorMessage, stream: "stderr" });
          emitStatus({ type: "lifecycleStatus", status: "error", errorMessage });
          finish(false, errorMessage);
        };
        activeLifecycleCancel?.();
        activeLifecycleCancel = cancel;
        try {
          let multilabId: number | undefined;
          if (backendAction === "up" && resultHost.onBeforeDeploy) {
            const decision = await resultHost.onBeforeDeploy(sessionId);
            if (!decision.proceed) {
              cancel();
              return;
            }
            multilabId = decision.multilabId;
          }
          if (settled) return;
          // Emit this after preflight approval because approval temporarily
          // closes and clears the progress modal.
          emitStatus({ type: "lifecycleLog", line: `Starting ${label}…`, stream: "stdout" });
          const res = await safeFetch(`${BASE}/api/lab/lifecycle/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, action: backendAction, multilabId }),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`lifecycle stream failed (${res.status})`);
          }

          const reader = res.body.getReader();

          const handleFrame = (raw: string) => {
            const trimmed = raw.trim();
            if (!trimmed.startsWith("data:")) return;
            const payload = trimmed.slice(trimmed.indexOf(":") + 1).trim();
            if (!payload) return;
            let frame: { stream?: string; line?: string; done?: boolean; code?: number; error?: string; hint?: string; progress?: DeploymentProgress; suggestedMultilabId?: number };
            try {
              frame = JSON.parse(payload);
            } catch {
              return;
            }
            if (frame.progress) resultHost.onDeploymentProgress?.(frame.progress);
            if (frame.error) {
              settled = true;
              emitStatus({ type: "lifecycleStatus", status: "error", errorMessage: frame.error });
              finish(false, frame.error);
            } else if (frame.done) {
              settled = true;
              if (typeof frame.suggestedMultilabId === "number") suggestedMultilabId = frame.suggestedMultilabId;
              if (frame.code === 0) {
                emitStatus({ type: "lifecycleStatus", status: "success" });
                finish(true);
              } else {
                const errorMessage = frame.hint || `${label} exited with code ${frame.code}`;
                emitStatus({
                  type: "lifecycleStatus",
                  status: "error",
                  errorMessage,
                });
                finish(false, errorMessage);
              }
            } else if (typeof frame.line === "string") {
              emitStatus({
                type: "lifecycleLog",
                line: frame.line,
                stream: frame.stream === "stderr" ? "stderr" : "stdout",
              });
            }
          };

          await consumeSseStream(reader, handleFrame);

          // Stream ended without an explicit done/error frame.
          if (!settled) {
            const errorMessage = `${label} ended without a completion status`;
            emitStatus({ type: "lifecycleStatus", status: "error", errorMessage });
            finish(false, errorMessage);
          }
        } catch (err) {
          if (!settled) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            emitStatus({ type: "lifecycleStatus", status: "error", errorMessage });
            finish(false, errorMessage);
          }
        } finally {
          if (activeLifecycleCancel === cancel) activeLifecycleCancel = null;
        }
      })();
    },

    cancelLifecycle() {
      activeLifecycleCancel?.();
    },

    toggleSplitView() {},

    runNodeAction(action: TopoViewerNodeAction, nodeName: string) {
      if (resultHost.onNodeAction) {
        resultHost.onNodeAction(action, nodeName);
      }
    },

    captureInterface(nodeName: string, interfaceName: string) {
      openCapture(nodeName, interfaceName);
    },
    setLinkImpairment(nodeName: string, interfaceName: string, data: unknown) {
      if (!currentSessionId) return;
      const fields = typeof data === "object" && data !== null ? data : {};
      void postLinkCommand("link-impairment", { sessionId: currentSessionId, node: nodeName, interface: interfaceName, ...fields })
        .then((error) => {
          if (error) resultHost.onLinkResult?.(`Impairment on ${nodeName}:${interfaceName} failed — ${error}`, "error");
          else resultHost.onLinkResult?.(`Impairment on ${nodeName}:${interfaceName} applied`, "success");
        });
    },
    runLinkAction(action: "down" | "up", endpoints: { sourceNode?: string; sourceEndpoint?: string; targetNode?: string; targetEndpoint?: string }) {
      const sessionId = currentSessionId;
      if (!sessionId) return;
      const ends = [[endpoints.sourceNode, endpoints.sourceEndpoint], [endpoints.targetNode, endpoints.targetEndpoint]]
        .filter((end): end is [string, string] => Boolean(end[0] && end[1]));
      const label = ends.map(([node, iface]) => `${node}:${iface}`).join(" ↔ ");
      void (async () => {
        // Down: one end is enough (the peer loses carrier); try the other if
        // the first isn't a container (a bridge, a VM). Up: restore both.
        const errors: string[] = [];
        let changed = 0;
        for (const [node, iface] of ends) {
          const error = await postLinkCommand("link-state", { sessionId, node, interface: iface, up: action === "up" });
          if (error) errors.push(`${node}:${iface}: ${error}`);
          else changed += 1;
          if (action === "down" && changed) break;
        }
        if (changed) resultHost.onLinkResult?.(`Link ${label} ${action === "down" ? "taken down" : "brought up"}`, "success");
        else resultHost.onLinkResult?.(`Link ${label}: ${errors.join("; ")}`, "error");
      })();
    },
    saveCustomNode(data: Record<string, unknown>) {
      if (!currentSessionId) return;
      postCustomNodeAction(
        "save",
        safeFetch(`${BASE}/api/topology/custom-nodes?sessionId=${currentSessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })
      );
    },

    deleteCustomNode(nodeName: string) {
      if (!currentSessionId) return;
      postCustomNodeAction(
        "delete",
        safeFetch(`${BASE}/api/topology/custom-nodes/${encodeURIComponent(nodeName)}?sessionId=${currentSessionId}`, {
          method: "DELETE",
        })
      );
    },

    setDefaultCustomNode(nodeName: string) {
      if (!currentSessionId) return;
      postCustomNodeAction(
        "set default",
        safeFetch(`${BASE}/api/topology/custom-nodes/default?sessionId=${currentSessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultNode: nodeName }),
        })
      );
    },

    importCustomNodes() {},

    requestIconList() {
      void loadIconList();
    },
    uploadIcon() {
      void (async () => {
        const file = await selectIconFile();
        if (!file) return;

        const body = new FormData();
        body.append("file", file);
        const res = await safeFetch(`${BASE}/api/lab/icons/upload`, {
          method: "POST",
          body,
        });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || `Failed to upload icon: ${res.status}`);
        }
        await loadIconList();
      })().catch((err) => console.error("Failed to upload custom icon:", err));
    },
    deleteIcon(iconName: string) {
      void (async () => {
        const res = await safeFetch(`${BASE}/api/lab/icons/${encodeURIComponent(iconName)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || `Failed to delete icon: ${res.status}`);
        }
        await loadIconList();
      })().catch((err) => console.error("Failed to delete custom icon:", err));
    },
    reconcileIcons(usedIcons: string[]) {
      void (async () => {
        const res = await safeFetch(`${BASE}/api/lab/icons`);
        if (!res.ok) throw new Error(`Failed to reconcile custom icons: ${res.status}`);

        const usedIconSet = new Set(usedIcons);
        const orphanedIcons = parseIconNamesResponse(await res.json()).filter((iconName) => !usedIconSet.has(iconName));
        if (orphanedIcons.length > 0) {
          console.warn(`Unused custom icons in ~/.netlab/icons/: ${orphanedIcons.join(", ")}`);
        }
      })().catch((err) => console.error("Failed to reconcile custom icons:", err));
    },
    // clab-ui's SVG export dialog builds the Grafana Flow Panel bundle and
    // waits for this reply; the old no-op made it time out after 30 s.
    exportGrafanaBundle(payload: TopoViewerSvgExportPayload) {
      const base = (payload.baseName || "topology").replace(/[\\/:*?"<>|]+/g, "_");
      const files: Array<[string, string, string]> = [
        [`${base}.svg`, payload.svgContent, "image/svg+xml"],
        [`${base}.grafana.json`, payload.dashboardJson, "application/json"],
        [`${base}.flow_panel.yaml`, payload.panelYaml, "application/yaml"],
      ];
      try {
        for (const [name, content, type] of files) downloadText(name, content, type);
        subscribers.forEach((s) => s({ type: "svgExportResult", requestId: payload.requestId, success: true, files: files.map(([name]) => name) }));
      } catch (err) {
        subscribers.forEach((s) => s({ type: "svgExportResult", requestId: payload.requestId, success: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    dumpCssVars(_vars: Record<string, string>) {},

    subscribe(handler: (event: ClabUiTopoViewerEvent) => void) {
      subscribers.add(handler);
      void loadIconList();
      if (currentSessionId) {
        safeFetch(`${BASE}/api/topology/custom-nodes?sessionId=${currentSessionId}`)
          .then((res) => res.json())
          .then((cnData) => {
            handler({
              type: "customNodesUpdated",
              customNodes: cnData.customNodes || [],
              defaultNode: cnData.defaultNode || "",
            });
          })
          .catch((err) => console.error("Failed to load custom nodes on subscribe:", err));
      }
      return () => {
        subscribers.delete(handler);
      };
    },
  };

  const resultHost: AppClabUiHost = {
    ...baseHost,
    topoViewer: topoViewerHost,
    sessionId: null,
    setRuntimeContainers(containers: HostRuntimeContainer[]) {
      runtimeContainers = containers;
    },
    setLifecycleCancel(cancel: (() => void) | null) {
      activeLifecycleCancel = cancel;
    },
    async createSession(topologyPath: string) {
      const res = await safeFetch(`${BASE}/api/topology/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topologyPath }),
      });
      if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
      const data = (await res.json()) as { sessionId: string };
      sessionPaths.set(data.sessionId, topologyPath);
      return data;
    },
    activateSession(sessionId: string | null) {
      if (currentSessionId === sessionId) return;
      currentSessionId = sessionId;
      resultHost.sessionId = sessionId;
      emitDeploymentState();
      if (!sessionId) return;
      safeFetch(`${BASE}/api/topology/custom-nodes?sessionId=${sessionId}`)
        .then(async (cnRes) => {
          if (!cnRes.ok || currentSessionId !== sessionId) return;
          const cnData = await cnRes.json();
          subscribers.forEach((s) =>
            s({
              type: "customNodesUpdated",
              customNodes: cnData.customNodes || [],
              defaultNode: cnData.defaultNode || "",
            })
          );
        })
        .catch((err) => console.error("Failed to load custom nodes on session activation:", err));
    },
    async disposeSession(sessionId: string) {
      if (currentSessionId === sessionId) {
        currentSessionId = null;
        resultHost.sessionId = null;
      }
      sessionPaths.delete(sessionId);
      const res = await safeFetch(`${BASE}/api/topology/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`disposeSession failed: ${res.status}`);
    },
    emitTopoViewerEvent(event: ClabUiTopoViewerEvent) {
      subscribers.forEach((s) => s(event));
    },
  };

  return resultHost;
}
