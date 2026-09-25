/**
 * Commands worth one click for this lab: what the protocols it runs make
 * interesting, in the words of the devices it has. Shown as chips next to the
 * user's own history, so the first useful command is never typed by hand.
 */

const HOSTS = new Set(["linux", "none"]);

// Per module, the show command every operator types first. Auto mode sends
// "show …" to each device's CLI (vtysh on FRR, Cli on EOS…).
const MODULE_COMMANDS: Record<string, string[]> = {
  ospf: ["show ip ospf neighbor"],
  bgp: ["show ip bgp summary"],
  isis: ["show isis neighbor"],
  bfd: ["show bfd peers"],
  evpn: ["show bgp l2vpn evpn summary"],
  vrf: ["show vrf"],
  ldp: ["show mpls ldp neighbor"],
  mpls: ["show mpls table"],
  vlan: ["show vlan"],
  lag: ["show interfaces port-channel"],
  lldp: ["show lldp neighbors"],
};

export function suggestCommands(devices: string[], modules: string[]): string[] {
  const hasRouters = devices.some((device) => !HOSTS.has(device));
  const hasHosts = devices.some((device) => HOSTS.has(device));
  const commands: string[] = [];
  if (hasRouters) {
    commands.push("show ip route");
    for (const module of modules) commands.push(...(MODULE_COMMANDS[module] ?? []));
    commands.push("show running-config");
  }
  if (hasHosts || !hasRouters) commands.push("ip -br address", "ip route");
  return [...new Set(commands)];
}
