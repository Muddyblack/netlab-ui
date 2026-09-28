import type { ReactNode } from "react";
import { Box } from "@mui/material";

/** Light syntax colouring for command output: addresses, interface names and
 * link/protocol states — the things you scan `show` output for. One regex pass
 * per line; anything unmatched stays plain text. */
const TOKEN = new RegExp(
  [
    String.raw`(?<ip>\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b)`,
    String.raw`(?<mac>\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b)`,
    // Five or more groups, or a "::" — so uptimes like 00:02:05 stay plain.
    String.raw`(?<ip6>\b[0-9a-f]{1,4}(?:(?::[0-9a-f]{1,4}){4,7}|(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?)(?:\/\d{1,3})?)`,
    String.raw`(?<iface>\b(?:eth|ens|enp|swp|vlan|br|bond|Ethernet|GigabitEthernet|TenGigE|Loopback|Management|mgmt)\d+(?:[/.]\d+)*\b|\blo\b)`,
    // Case-insensitive: BGP's "Active" (not established) is a bad state.
    String.raw`(?<good>\b(?:up|full|established|running|ok|connected|reachable)\b)`,
    String.raw`(?<bad>\b(?:down|idle|active|connect|failed|error|unreachable|timeout|refused)\b)`,
  ].join("|"),
  "gi"
);

const COLORS: Record<string, string> = {
  ip: "info.main",
  ip6: "info.main",
  mac: "text.secondary",
  iface: "warning.main",
  good: "success.main",
  bad: "error.main",
};

export function highlightOutput(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const kind = Object.entries(match.groups ?? {}).find(([, value]) => value !== undefined)?.[0];
    if (!kind || match.index === undefined) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<Box key={key++} component="span" sx={{ color: COLORS[kind] }}>{match[0]}</Box>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
