import type React from "react";
import type { LabFileEntry } from "../api/client";
import type { RunningLabsStatus } from "../hooks/useAppData";

/** clab-ui's explorer sidebar tree node shape — a superset of fields across
 * endpoint, section, lab, container, and help-link nodes; each getChildren
 * level only populates the fields relevant to that node kind. */
interface ExplorerTreeNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  link?: string;
  contextValue: string;
  endpointId?: string;
  state?: "connected" | "running" | "stopped";
  status?: string;
  name?: string;
  labName?: string;
  kind?: string;
  image?: string;
  mgmtIp?: string;
  containerName?: string;
  topologyRef?: unknown;
  collapsibleState: 0 | 1;
  command?: { command: string; title: string; arguments: unknown[] };
  children?: ExplorerTreeNode[];
}

/** Containing lab folder for a topology path, shown as the tree node's
 * secondary text so same-named labs stay distinguishable (e.g.
 * "prometheus_fabric_demo" vs "tdma_ospf_fabric_h3_t3_b3"). */
function labParentDir(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : path;
}

/** netlab passes docker's human status through verbatim ("Up 2 minutes",
 * "Exited (0) …"), so a literal comparison against "running" never matches. */
function isRunningStatus(status: string): boolean {
  const text = status.trim().toLowerCase();
  if (text.includes("paused")) return false;
  return text.startsWith("up") || text.includes("running") || text.includes("healthy");
}

export function buildRunningProvider(
  runningLabsStatusRef: React.RefObject<RunningLabsStatus>,
  labFilesRef: React.RefObject<LabFileEntry[]>
) {
  return {
    getChildren(element?: ExplorerTreeNode): ExplorerTreeNode[] {
      if (!element) {
        return [{
          id: "endpoint:local",
          label: "local",
          description: "local://netlab",
          tooltip: "Local Netlab Host\nStatus: connected",
          contextValue: "containerlabEndpoint",
          endpointId: "local",
          state: "connected",
          collapsibleState: 1
        }];
      }

      if (element.id === "endpoint:local") {
        const status = runningLabsStatusRef.current ?? {};
        const files = labFilesRef.current ?? [];
        const runningCount = Object.keys(status).length;
        const undeployedCount = files.filter((file) =>
          !Object.values(status).some((labInfo) =>
            labInfo.path === file.path || labInfo.name === file.labName ||
            Boolean(labInfo.dir && file.path.startsWith(`${labInfo.dir}/`))
          )
        ).length;

        return [
          {
            id: "endpoint-section:running:local",
            label: "Running Labs",
            tooltip: `${runningCount} running labs`,
            contextValue: "containerlabEndpointSectionRunning",
            endpointId: "local",
            collapsibleState: runningCount > 0 ? 1 : 0
          },
          {
            id: "endpoint-section:local:local",
            label: "Undeployed Labs",
            tooltip: `${undeployedCount} undeployed labs`,
            contextValue: "containerlabEndpointSectionLocal",
            endpointId: "local",
            collapsibleState: undeployedCount > 0 ? 1 : 0
          }
        ];
      }

      if (element.id === "endpoint-section:running:local") {
        const status = runningLabsStatusRef.current ?? {};
        return Object.entries(status).map(([labKey, labInfo]) => {
          const directory = labInfo.dir || labInfo.path || "";
          const knownFile = (labFilesRef.current ?? []).find((file) =>
            (!!labInfo.name && file.labName === labInfo.name) ||
            Boolean(directory && file.path.startsWith(`${directory}/`))
          );
          // Prefer the topology's real lab name over netlab's instance id
          // ("default"), which says nothing about *which* lab is running.
          // The instance id stays visible as a suffix when it differs.
          const labName = labInfo.name || knownFile?.labName || labKey;
          const label = labName === labKey ? labName : `${labName} (${labKey})`;
          const yamlPath = knownFile?.path || labInfo.path || (directory ? `${directory}/topology.yml` : `labs/${labName}.yml`);
          const topoRef = {
            topologyId: `standalone:local::${yamlPath}`,
            labName,
            yamlPath,
            source: "standalone"
          };
          const nodes: ExplorerTreeNode[] = Object.entries(labInfo.nodes || {}).map(([nodeName, nodeInfo]) => {
            const nodeStatus = nodeInfo?.status || "unknown";
            return {
              id: `running-container:local:${nodeName}`,
              label: nodeName,
              description: nodeStatus,
              contextValue: "containerlabContainer",
              endpointId: "local",
              collapsibleState: 0,
              state: isRunningStatus(nodeStatus) ? "running" : "stopped",
              status: nodeStatus,
              name: nodeName,
              labName,
              kind: nodeInfo?.device,
              image: nodeInfo?.image,
              mgmtIp: nodeInfo?.mgmt,
              containerName: nodeInfo?.provider_name,
              topologyRef: topoRef,
              children: []
            };
          });

          // No node entries means no containers are actually up — the instance
          // record is stale (e.g. a crashed `netlab up`). Surface the recorded
          // status instead of the directory so the lab doesn't read as healthy.
          const noContainers = nodes.length === 0;
          const labStatus = labInfo.status || "Unknown status";
          return {
            id: `running-lab:local:${labName}`,
            label,
            description: noContainers ? `no containers — ${labStatus}` : directory,
            tooltip: `${labStatus}\n${directory}`,
            contextValue: "containerlabLabDeployed",
            endpointId: "local",
            collapsibleState: nodes.length > 0 ? 1 : 0,
            topologyRef: topoRef,
            command: {
              command: "containerlab.lab.graph.topoViewer",
              title: "Open TopoViewer",
              arguments: [{
                id: `running-lab:local:${labName}`,
                contextValue: "containerlabLabDeployed",
                endpointId: "local",
                labName,
                topologyRef: topoRef
              }]
            },
            children: nodes
          };
        });
      }

      if (element.id === "endpoint-section:local:local") {
        const status = runningLabsStatusRef.current ?? {};
        const files = labFilesRef.current ?? [];
        return files
          .filter((file) =>
            !Object.values(status).some((labInfo) =>
              labInfo.path === file.path || labInfo.name === file.labName ||
              Boolean(labInfo.dir && file.path.startsWith(`${labInfo.dir}/`))
            )
          )
          .map((file) => ({
            id: `local-lab:local:${file.path}`,
            // Prefer the topology's own `name:` (e.g. "tofh3t31bd") over the bare
            // filename — every lab folder holds a `topology.yml`, so filenames
            // collide and read as identical siblings in the tree.
            label: file.labName || file.filename,
            description: labParentDir(file.path),
            contextValue: "containerlabLabUndeployed",
            endpointId: "local",
            collapsibleState: 0 as const,
            topologyRef: file.topologyRef,
            command: {
              command: "containerlab.lab.graph.topoViewer",
              title: "Open TopoViewer",
              arguments: [{
                id: `local-lab:local:${file.path}`,
                contextValue: "containerlabLabUndeployed",
                endpointId: "local",
                topologyRef: file.topologyRef
              }]
            },
            children: []
          }));
      }

      return element.children || [];
    }
  };
}

export function buildHelpProvider() {
  return {
    getChildren(element?: ExplorerTreeNode): ExplorerTreeNode[] {
      if (!element) {
        return [
          {
            id: "help:netlab",
            label: "Netlab Documentation",
            link: "https://netlab.tools/",
            contextValue: "containerlabHelpFeedback",
            collapsibleState: 0,
            command: { command: "containerlab.openLink", title: "Open Link", arguments: ["https://netlab.tools/"] }
          },
          {
            id: "help:containerlab",
            label: "Containerlab Documentation",
            link: "https://containerlab.dev/",
            contextValue: "containerlabHelpFeedback",
            collapsibleState: 0,
            command: { command: "containerlab.openLink", title: "Open Link", arguments: ["https://containerlab.dev/"] }
          },
          {
            id: "help:netlab-examples",
            label: "Browse Labs on GitHub (netlab)",
            link: "https://github.com/ipspace/netlab-examples",
            contextValue: "containerlabHelpFeedback",
            collapsibleState: 0,
            command: { command: "containerlab.openLink", title: "Open Link", arguments: ["https://github.com/ipspace/netlab-examples"] }
          },
          {
            id: "help:discord",
            label: "Join Containerlab Discord server",
            link: "https://discord.gg/vAyddtaEV9",
            contextValue: "containerlabHelpFeedback",
            collapsibleState: 0,
            command: { command: "containerlab.openLink", title: "Open Link", arguments: ["https://discord.gg/vAyddtaEV9"] }
          }
        ];
      }
      return element.children || [];
    }
  };
}
