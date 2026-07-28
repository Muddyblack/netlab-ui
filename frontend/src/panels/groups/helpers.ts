import type { GroupInfo } from "./types";

export const MODULE_SECTIONS = [
  { label: "Routing", modules: ["bgp", "ospf", "isis", "eigrp", "ripv2", "routing"] },
  { label: "Network services", modules: ["vlan", "vrf", "vxlan", "evpn", "mpls", "sr", "srv6"] },
  { label: "Interfaces", modules: ["bfd", "lag", "stp", "gateway", "dhcp"] }
];

export const STRUCTURED_MODULES = new Set(["bgp", "ospf", "vlan"]);

export function isStructuredAttribute(key: string): boolean {
  return STRUCTURED_MODULES.has(key) || [...STRUCTURED_MODULES].some((module) => key.startsWith(`${module}.`));
}

export function attrsToStrings(attrs: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    ])
  );
}

export function parseAttributeValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { return JSON.parse(trimmed); } catch { /* retain invalid JSON as text */ }
  }
  return value;
}

export function groupContains(groups: GroupInfo[], start: string, target: string, visited = new Set<string>()): boolean {
  if (start === target) return true;
  if (visited.has(start)) return false;
  visited.add(start);
  const group = groups.find((item) => item.name === start);
  return Boolean(group?.members.some((member) => groupContains(groups, member, target, visited)));
}
