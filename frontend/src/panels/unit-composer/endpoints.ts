import type { UnitInfo } from "../units-dock/types";
import type { IncludeRow } from "../../components/dialogs/create-group-template/types";

export interface EndpointOption {
  /** The endpoint string stored in the unit (e.g. `sw` or `wp.uplink`). A bare
   * include reference with count>1 fans out to every instance on expansion. */
  value: string;
  /** What the picker shows (e.g. `sw` or `uplink`). */
  label: string;
  /** Section heading in the picker (`This unit`, `4 × workplace`, …). */
  group: string;
  /** True when selecting this wires *every* instance of a multi-instance
   * include — one link per instance, scaling with the count. */
  scaling?: boolean;
}

/** A unit's connection surface = the nodes it chooses to expose (`ports`), or
 * every own node if it exposes none. */
export function exposedNodes(unit: UnitInfo | undefined): string[] {
  if (!unit) return [];
  const ports = (unit.ports || []).filter(Boolean);
  if (ports.length) return ports;
  return (unit.nodes || []).map((n) => n.name);
}

/** Every endpoint a connection can attach to: this unit's own nodes, plus a
 * target per included unit's exposed port. Multi-instance includes contribute a
 * single "each" option (the scaling rule) rather than one row per instance. */
export function buildEndpointOptions(
  ownNodes: string[],
  includes: IncludeRow[],
  unitsByName: Record<string, UnitInfo>
): EndpointOption[] {
  const out: EndpointOption[] = ownNodes.map((name) => ({
    value: name,
    label: name,
    group: "This unit"
  }));

  for (const row of includes) {
    if (!row.template) continue;
    const count = Math.max(1, Number(row.count) || 1);
    const scaling = count > 1;
    const group = scaling ? `${count} × ${row.template}` : row.template;
    for (const port of exposedNodes(unitsByName[row.template])) {
      out.push({
        value: `${row.template}.${port}`,
        label: scaling ? `each · ${port}` : port,
        group,
        scaling
      });
    }
  }
  return out;
}

/** Look up an option by its stored value, for rendering a saved endpoint that
 * may reference a since-removed include. */
export function optionLabel(options: EndpointOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
