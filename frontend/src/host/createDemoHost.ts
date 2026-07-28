import {
  createWindowClabUiHost,
  type ClabUiTopoViewerEvent,
  type TopoViewerLifecycleAction,
  type TopoViewerNodeAction,
  type TopologyUiContext,
  type TopologyUiRequestOptions
} from "@srl-labs/clab-ui/host";

type WindowHostOptions = NonNullable<Parameters<typeof createWindowClabUiHost>[0]>;
import {
  type TopologyHostCommand,
  type TopologyHostResponseMessage,
  type TopologySnapshot
} from "@srl-labs/clab-ui/session";
import type { AppClabUiHost } from "./createHost";
import { BrowserStorageFs, normalizePath } from "./demoFs";
import {
  type DemoLabFile,
  buildTopologyRef,
  buildUniqueYamlPath,
  createInitialYaml,
  ensureSeedDemoLab,
  readLabIndex,
  toLabFile,
  writeLabIndex
} from "./demoLabIndex";
import { buildDemoSnapshot, buildLifecycleError } from "./demoSnapshot";

type DemoSession = {
  sessionId: string;
  yamlPath: string;
  revision: number;
};

export function createDemoClabUiHost(options?: { explorer?: WindowHostOptions["explorer"]; meta?: WindowHostOptions["meta"] }): AppClabUiHost {
  const fsAdapter = new BrowserStorageFs();
  const baseHost = createWindowClabUiHost({
    explorer: options?.explorer,
    meta: options?.meta,
    images: {
      async listImages() {
        return [];
      },
      async listImageReferences() {
        return [];
      },
      async pullImage() {
        throw new Error("Image pulls are unavailable in the browser-only demo.");
      },
      async removeImage() {
        throw new Error("Image removal is unavailable in the browser-only demo.");
      }
    }
  });

  const topoViewerSubscribers = new Set<(event: ClabUiTopoViewerEvent) => void>();
  const sessions = new Map<string, DemoSession>();
  let currentSessionId: string | null = null;

  const topoViewer = {
    runLifecycle(action: TopoViewerLifecycleAction) {
      topoViewerSubscribers.forEach((subscriber) => subscriber(buildLifecycleError(action)));
    },
    cancelLifecycle() {
      topoViewerSubscribers.forEach((subscriber) =>
        subscriber({ type: "lifecycleStatus", status: "success" })
      );
    },
    toggleSplitView() {},
    runNodeAction(action: TopoViewerNodeAction, nodeName: string) {
      if (resultHost.onNodeAction) {
        resultHost.onNodeAction(action, nodeName);
      }
    },
    captureInterface() {},
    setLinkImpairment() {},
    saveCustomNode() {},
    deleteCustomNode() {},
    setDefaultCustomNode() {},
    importCustomNodes() {},
    requestIconList() {
      topoViewerSubscribers.forEach((subscriber) =>
        subscriber({ type: "iconList", icons: [] })
      );
    },
    uploadIcon() {},
    deleteIcon() {},
    reconcileIcons() {},
    exportGrafanaBundle() {},
    dumpCssVars() {},
    subscribe(handler: (event: ClabUiTopoViewerEvent) => void) {
      topoViewerSubscribers.add(handler);
      return () => {
        topoViewerSubscribers.delete(handler);
      };
    }
  };

  const resultHost: AppClabUiHost = {
    ...baseHost,
    topoViewer,
    sessionId: null,
    setRuntimeContainers() {},
    async createLab(labName: string) {
      const existingLabs = readLabIndex();
      const record = {
        labName,
        yamlPath: buildUniqueYamlPath(labName, existingLabs)
      };
      await fsAdapter.writeFile(record.yamlPath, createInitialYaml(record.labName));
      writeLabIndex([...existingLabs, record]);
      return { topologyRef: buildTopologyRef(record) };
    },
    async listLabFiles() {
      const labs = await ensureSeedDemoLab(fsAdapter, readLabIndex());
      const entries = await Promise.all(
        labs.map(async (lab) => ((await fsAdapter.exists(lab.yamlPath)) ? toLabFile(lab) : null))
      );
      return entries.filter((entry): entry is DemoLabFile => entry !== null);
    },
    async createSession(topologyPath: string) {
      const yamlPath = normalizePath(topologyPath);
      if (!(await fsAdapter.exists(yamlPath))) {
        throw new Error(`Demo lab not found: ${topologyPath}`);
      }
      const sessionId = `demo-session-${Math.random().toString(36).slice(2, 10)}`;
      sessions.set(sessionId, { sessionId, yamlPath, revision: 0 });
      currentSessionId = sessionId;
      resultHost.sessionId = sessionId;
      return { sessionId };
    },
    async disposeSession(sessionId: string) {
      sessions.delete(sessionId);
      if (currentSessionId === sessionId) {
        currentSessionId = null;
        resultHost.sessionId = null;
      }
    },
    emitTopoViewerEvent(event: ClabUiTopoViewerEvent) {
      topoViewerSubscribers.forEach((s) => s(event));
    },
    topology: {
      async requestSnapshot(
        context: TopologyUiContext,
        _options: TopologyUiRequestOptions = {}
      ): Promise<TopologySnapshot> {
        const sessionId = context.sessionId ?? currentSessionId;
        if (!sessionId) {
          throw new Error("No active demo session");
        }
        const session = sessions.get(sessionId);
        if (!session) {
          throw new Error(`Unknown demo session: ${sessionId}`);
        }
        const yamlContent = await fsAdapter.readFile(session.yamlPath);
        return buildDemoSnapshot(session.yamlPath, yamlContent, session.revision);
      },
      async dispatchCommand(
        _context: TopologyUiContext,
        revision: number,
        _command: TopologyHostCommand
      ): Promise<TopologyHostResponseMessage> {
        return {
          type: "topology-host:error",
          protocolVersion: 1,
          requestId: "",
          error: `Editing commands are unavailable in demo mode at revision ${revision}.`
        };
      }
    }
  };

  return resultHost;
}
