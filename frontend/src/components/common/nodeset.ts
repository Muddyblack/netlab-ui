// Collapse similar node names into hostlist / nodeset notation, the compact
// form infra tooling (Slurm, clustershell, pdsh) uses:
//
//   KOII1_pc1 … KOII1_pc6            → KOII1_pc[1-6]
//   with gaps                        → KOII1_pc[1-3,5,7-8]
//   unrelated names                  → kept as-is, each its own group
//
// A "base" is everything before a name's trailing digit run; names that share a
// base are range-collapsed, names without trailing digits stay standalone.

export interface NodeSetGroup {
  /** Compact display label, e.g. "KOII1_pc[1-6]" or a bare "core-sw". */
  label: string;
  /** The concrete node names this group covers, in numeric order. */
  names: string[];
}

const TRAILING_DIGITS = /^(.*?)(\d+)$/;

interface Entry {
  num: number;
  numStr: string;
  name: string;
}

export function collapseNodeSet(input: string[]): NodeSetGroup[] {
  const seen = new Set<string>();
  const order: Array<{ kind: "num"; key: string } | { kind: "plain"; name: string }> = [];
  const buckets = new Map<string, Entry[]>();

  for (const name of input) {
    if (seen.has(name)) continue;
    seen.add(name);
    const match = TRAILING_DIGITS.exec(name);
    if (!match) {
      order.push({ kind: "plain", name });
      continue;
    }
    const key = match[1];
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push({ kind: "num", key });
    }
    buckets.get(key)!.push({ num: Number.parseInt(match[2], 10), numStr: match[2], name });
  }

  const groups: NodeSetGroup[] = [];
  for (const item of order) {
    if (item.kind === "plain") {
      groups.push({ label: item.name, names: [item.name] });
      continue;
    }
    const entries = buckets.get(item.key)!.slice().sort((a, b) => a.num - b.num || a.numStr.localeCompare(b.numStr));
    if (entries.length === 1) {
      groups.push({ label: entries[0].name, names: [entries[0].name] });
      continue;
    }
    const ranges: string[] = [];
    let runStart = 0;
    for (let i = 1; i <= entries.length; i++) {
      const broken = i === entries.length || entries[i].num !== entries[i - 1].num + 1;
      if (broken) {
        const start = entries[runStart];
        const end = entries[i - 1];
        ranges.push(start === end ? start.numStr : `${start.numStr}-${end.numStr}`);
        runStart = i;
      }
    }
    groups.push({ label: `${item.key}[${ranges.join(",")}]`, names: entries.map((entry) => entry.name) });
  }
  return groups;
}

export function formatNodeSet(names: string[]): string {
  return collapseNodeSet(names).map((group) => group.label).join(", ");
}
