export type LinkKind = "stub" | "lan" | "uplink";

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  stub: "stub link",
  lan: "LAN",
  uplink: "external uplink",
};
