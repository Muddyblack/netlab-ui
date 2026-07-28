import type { ClabUiTopoViewerEvent, TopoViewerLifecycleAction } from "@srl-labs/clab-ui/host";
import type { TopologySnapshot } from "@srl-labs/clab-ui/session";
import YAML from "yaml";
import { basename } from "./demoFs";

export function buildLifecycleError(
  action: TopoViewerLifecycleAction
): Extract<ClabUiTopoViewerEvent, { type: "lifecycleStatus" }> {
  return {
    type: "lifecycleStatus",
    status: "error",
    errorMessage: `${action} is unavailable in the browser-only demo.`
  };
}

function parseLinkEndpoints(link: unknown): { source: string; target: string; sourceEndpoint: string; targetEndpoint: string } | null {
  if (typeof link === "string") {
    const parts = link.split("-").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        source: parts[0],
        target: parts[1],
        sourceEndpoint: "",
        targetEndpoint: ""
      };
    }
    return null;
  }

  if (Array.isArray(link) && link.length >= 2 && typeof link[0] === "string" && typeof link[1] === "string") {
    return {
      source: link[0],
      target: link[1],
      sourceEndpoint: "",
      targetEndpoint: ""
    };
  }

  if (!link || typeof link !== "object") {
    return null;
  }

  const endpoints = (link as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(endpoints) || endpoints.length < 2) {
    return null;
  }

  const parseEndpoint = (endpoint: unknown): { node: string; iface: string } | null => {
    if (typeof endpoint === "string") {
      const [node, iface = ""] = endpoint.split(":");
      return node ? { node, iface } : null;
    }
    if (endpoint && typeof endpoint === "object") {
      const node = typeof (endpoint as { node?: unknown }).node === "string" ? (endpoint as { node: string }).node : "";
      const iface =
        typeof (endpoint as { interface?: unknown }).interface === "string"
          ? (endpoint as { interface: string }).interface
          : "";
      return node ? { node, iface } : null;
    }
    return null;
  };

  const source = parseEndpoint(endpoints[0]);
  const target = parseEndpoint(endpoints[1]);
  if (!source || !target) {
    return null;
  }

  return {
    source: source.node,
    target: target.node,
    sourceEndpoint: source.iface,
    targetEndpoint: target.iface
  };
}

export function buildDemoSnapshot(yamlPath: string, yamlContent: string, revision: number): TopologySnapshot {
  let parsed: Record<string, unknown> = {};
  try {
    const doc = YAML.parse(yamlContent);
    if (doc && typeof doc === "object") {
      parsed = doc as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }

  const rawNodes = parsed.nodes;
  const nodesRecord =
    rawNodes && typeof rawNodes === "object" && !Array.isArray(rawNodes)
      ? (rawNodes as Record<string, unknown>)
      : {};
  const nodeIds = Object.keys(nodesRecord);
  const radius = Math.max(140, nodeIds.length * 26);
  const positions = Object.fromEntries(
    nodeIds.map((nodeId, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodeIds.length, 1);
      return [
        nodeId,
        {
          x: Math.round(Math.cos(angle) * radius),
          y: Math.round(Math.sin(angle) * radius)
        }
      ];
    })
  );

  const nodes = nodeIds.map((nodeId) => {
    const nodeBody = nodesRecord[nodeId];
    const nodeData =
      nodeBody && typeof nodeBody === "object" && !Array.isArray(nodeBody)
        ? (nodeBody as Record<string, unknown>)
        : {};
    const device = typeof nodeData.device === "string" ? nodeData.device : "router";
    return {
      id: nodeId,
      type: "topology-node",
      kind: device,
      position: positions[nodeId] ?? { x: 0, y: 0 },
      data: {
        ...nodeData,
        label: nodeId,
        role: device,
        state: "undeployed"
      }
    };
  }) as TopologySnapshot["nodes"];

  const rawLinks = Array.isArray(parsed.links) ? parsed.links : [];
  const edges = rawLinks
    .map((link, index) => {
      const parsedLink = parseLinkEndpoints(link);
      if (!parsedLink) {
        return null;
      }
      return {
        id: `e${index}`,
        source: parsedLink.source,
        target: parsedLink.target,
        // "topology-edge" selects clab-ui's custom edge renderer; without it
        // React Flow falls back to its thin 1px default edge. Mirrors the FastAPI
        // backend (see contract/snapshot.py) so demo + real hosts render alike.
        type: "topology-edge",
        data: {
          sourceEndpoint: parsedLink.sourceEndpoint,
          targetEndpoint: parsedLink.targetEndpoint
        }
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== null) as TopologySnapshot["edges"];

  return {
    revision,
    nodes,
    edges,
    annotations: { positions },
    yamlFileName: basename(yamlPath),
    annotationsFileName: `${basename(yamlPath)}.annotations.json`,
    yamlContent,
    annotationsContent: JSON.stringify({ positions }, null, 2),
    labName: typeof parsed.name === "string" ? parsed.name : basename(yamlPath).replace(/\.(ya?ml)$/i, ""),
    mode: "edit",
    deploymentState: "undeployed",
    canUndo: false,
    canRedo: false
  };
}
