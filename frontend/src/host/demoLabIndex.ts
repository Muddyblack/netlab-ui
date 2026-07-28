import type { FileSystemAdapter, TopologyRef } from "@srl-labs/clab-ui/session";
import type { LabFileEntry } from "../api/client";
import { basename, normalizePath } from "./demoFs";

export type DemoLabRecord = {
  labName: string;
  yamlPath: string;
};

export type DemoLabFile = LabFileEntry;

const DEMO_LABS_KEY = "netlab:demo-labs";
export const DEFAULT_DEMO_LAB: DemoLabRecord = {
  labName: "Demo Lab",
  yamlPath: "/labs/demo-lab.yml"
};
const DEFAULT_DEMO_LAB_YAML = [
  "%YAML 1.1",
  "---",
  "name: test",
  "provider: clab",
  "plugin: [bgp.domain]",
  "defaults:",
  "  device: frr",
  "nodes:",
  "  r1:",
  "  r2:",
  "  r3:",
  "links:",
  "  - r1-r2",
  "  - r2-r3",
  "  - r1-r3",
  ""
].join("\n");

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "demo-lab"
  );
}

export function readLabIndex(): DemoLabRecord[] {
  try {
    const raw = window.localStorage.getItem(DEMO_LABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DemoLabRecord =>
        entry && typeof entry.labName === "string" && typeof entry.yamlPath === "string"
    );
  } catch {
    return [];
  }
}

export function writeLabIndex(labs: DemoLabRecord[]): void {
  window.localStorage.setItem(DEMO_LABS_KEY, JSON.stringify(labs));
}

export async function ensureSeedDemoLab(
  fsAdapter: FileSystemAdapter,
  existingLabs: DemoLabRecord[]
): Promise<DemoLabRecord[]> {
  const hasDefaultLab = existingLabs.some((lab) => lab.yamlPath === DEFAULT_DEMO_LAB.yamlPath);
  const seededLabs = hasDefaultLab ? existingLabs : [DEFAULT_DEMO_LAB, ...existingLabs];

  if (!(await fsAdapter.exists(DEFAULT_DEMO_LAB.yamlPath))) {
    await fsAdapter.writeFile(DEFAULT_DEMO_LAB.yamlPath, DEFAULT_DEMO_LAB_YAML);
  } else {
    const currentContent = await fsAdapter.readFile(DEFAULT_DEMO_LAB.yamlPath);
    if (currentContent.trim() !== DEFAULT_DEMO_LAB_YAML.trim()) {
      await fsAdapter.writeFile(DEFAULT_DEMO_LAB.yamlPath, DEFAULT_DEMO_LAB_YAML);
    }
  }

  if (!hasDefaultLab) {
    writeLabIndex(seededLabs);
  }

  return seededLabs;
}

export function buildTopologyRef(lab: DemoLabRecord): TopologyRef {
  return {
    topologyId: `standalone:demo::${lab.yamlPath}`,
    labName: lab.labName,
    yamlPath: lab.yamlPath,
    source: "standalone"
  };
}

export function toLabFile(lab: DemoLabRecord): DemoLabFile {
  return {
    endpointId: "local",
    filename: basename(lab.yamlPath),
    path: lab.yamlPath.replace(/^\//, ""),
    hasAnnotations: false,
    labName: lab.labName,
    deploymentState: "undeployed",
    topologyRef: buildTopologyRef(lab)
  };
}

export function createInitialYaml(labName: string): string {
  return [
    `name: ${JSON.stringify(labName)}`,
    "nodes:",
    "links:",
    ""
  ].join("\n");
}

export function buildUniqueYamlPath(labName: string, existingLabs: DemoLabRecord[]): string {
  const base = slugify(labName);
  const existing = new Set(existingLabs.map((lab) => lab.yamlPath));
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = normalizePath(`labs/${base}${suffix}.yml`);
    if (!existing.has(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
}
