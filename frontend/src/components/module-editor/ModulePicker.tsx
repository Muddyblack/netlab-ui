import { Box, Button, Chip, Stack, Tooltip, Typography } from "@mui/material";

export const MODULE_SECTIONS = [
  { label: "Routing", modules: ["bgp", "ospf", "isis", "eigrp", "ripv2", "routing"] },
  { label: "Network services", modules: ["vlan", "vrf", "vxlan", "evpn", "mpls", "sr", "srv6"] },
  { label: "Interfaces", modules: ["bfd", "lag", "stp", "gateway", "dhcp"] }
];

const MODULE_HINTS: Record<string, string> = {
  bgp: "BGP sessions, AS numbers and route policy",
  ospf: "OSPFv2/v3 areas and interface settings",
  isis: "IS-IS levels and NET addresses",
  eigrp: "EIGRP named-mode routing",
  ripv2: "RIPv2 and RIPng",
  routing: "Static routes, prefix lists and routing policies",
  vlan: "VLANs, access and trunk ports, routed VLAN interfaces",
  vrf: "VRFs and route leaking",
  vxlan: "VXLAN VTEPs and VNIs",
  evpn: "EVPN control plane for VXLAN and MPLS",
  mpls: "LDP, BGP labeled unicast and L3 VPNs",
  sr: "Segment routing (SR-MPLS)",
  srv6: "Segment routing over IPv6",
  bfd: "Fast failure detection for routing protocols",
  lag: "Link aggregation (LACP)",
  stp: "Spanning tree",
  gateway: "First-hop redundancy and anycast gateways",
  dhcp: "DHCP server and relay"
};

/**
 * Netlab modules as toggle chips, grouped by what they do. Shared by the node
 * editor and the group dialog so both read and behave the same. A chip's
 * tooltip says what the module does; "Clear" appears once something is on.
 */
export function ModulePicker({ selected, onToggle, onClear }: {
  selected: string[];
  onToggle: (module: string) => void;
  onClear?: () => void;
}) {
  return (
    <Stack spacing={1.25}>
      {MODULE_SECTIONS.map((section) => (
        <Box key={section.label} sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 108, flexShrink: 0, fontWeight: 600 }}>
            {section.label}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.65, flex: 1, minWidth: 0 }}>
            {section.modules.map((module) => {
              const on = selected.includes(module);
              return (
                <Tooltip key={module} title={MODULE_HINTS[module] ?? module} enterDelay={500}>
                  <Chip
                    size="small"
                    clickable
                    label={module}
                    color={on ? "primary" : "default"}
                    variant={on ? "filled" : "outlined"}
                    onClick={() => onToggle(module)}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      ))}
      {onClear && selected.length > 0 && (
        <Box>
          <Button size="small" variant="text" onClick={onClear} sx={{ px: 0.5 }}>Clear all ({selected.length})</Button>
        </Box>
      )}
    </Stack>
  );
}
