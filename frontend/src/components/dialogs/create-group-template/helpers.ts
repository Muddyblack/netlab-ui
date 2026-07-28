import type { UnitInfo } from "../../../panels/UnitsDock";
import type { IncludeRow } from "./types";

/** Node data keys that are canvas view-state injected by the snapshot, not
 * netlab attributes — they must never leak into the unit's YAML. Group
 * membership and styling are captured separately (in the unit's sidecar). */
export const VIEW_STATE_KEYS = new Set([
  "id",
  "name",
  "type",
  "label",
  "state",
  "device",
  "kind",
  "role",
  "topoViewerRole",
  "group",
  "groupId",
  "icon",
  "iconColor",
  "extraData",
  "level",
  "width",
  "height",
  "backgroundColor",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "borderRadius",
  "zIndex"
]);

/** Every endpoint a link inside this unit could attach to: the unit's own
 * nodes, plus dotted paths (`room1.sw`) reaching into included instances —
 * the exact naming template expansion resolves. */
export function endpointOptions(
  ownNodes: string[],
  includes: IncludeRow[],
  unitsByName: Record<string, UnitInfo>
): string[] {
  const out: string[] = [...ownNodes];
  const walk = (prefix: string, templateName: string, depth: number) => {
    const unit = unitsByName[templateName];
    if (!unit || depth > 4) return;
    for (const n of unit.nodes || []) out.push(`${prefix}.${n.name}`);
    for (const inc of unit.includes || []) {
      const count = Math.max(1, Number(inc.count) || 1);
      for (let j = 1; j <= count; j++) {
        const seg = count === 1 ? inc.template : `${inc.template}${j}`;
        walk(`${prefix}.${seg}`, inc.template, depth + 1);
      }
    }
  };
  for (const row of includes) {
    if (!row.template) continue;
    const count = Math.max(1, row.count);
    for (let j = 1; j <= count; j++) {
      const seg = count === 1 ? row.template : `${row.template}${j}`;
      walk(seg, row.template, 1);
    }
  }
  return out;
}

/** Names of units that (transitively) include `name` — offering those as
 * includes for `name` would create a cycle if the user is redefining it. */
export function unitsIncluding(name: string, templates: UnitInfo[]): Set<string> {
  const out = new Set<string>();
  const includesOf = (t: UnitInfo): string[] => (t.includes || []).map((i) => i.template);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of templates) {
      if (out.has(t.name)) continue;
      if (includesOf(t).some((inc: string) => inc === name || out.has(inc))) {
        out.add(t.name);
        grew = true;
      }
    }
  }
  return out;
}
