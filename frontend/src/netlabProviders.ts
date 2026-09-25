/** netlab's providers as the UI sees them: a readable name per provider and
 * what the UI can do with nodes of each. The backend enforces the same
 * rules (app/lab/lifecycle.py, app/lab/pcap.py) and explains a refusal in
 * its error message; this table is what the user reads beforehand. */

export type ProviderId = "clab" | "libvirt" | "external";

/** Short label for a node's provider ("" for containerlab — the default
 * needs no badge). netlab reports unmanaged devices as "unmanaged". */
export function providerLabel(provider?: string | null): string {
  if (!provider || provider === "clab") return "";
  if (provider === "libvirt") return "libvirt VM";
  if (provider === "external" || provider === "unmanaged") return "external device";
  return provider;
}

export type Support = "yes" | "partial" | "no";

export interface Capability {
  feature: string;
  support: Record<ProviderId, Support>;
  /** Why a provider has partial or no support. */
  note?: Partial<Record<ProviderId, string>>;
}

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  clab: "containerlab",
  libvirt: "libvirt VMs",
  external: "external devices"
};

const all = (value: Support): Record<ProviderId, Support> => ({ clab: value, libvirt: value, external: value });

export const PROVIDER_CAPABILITIES: Capability[] = [
  { feature: "Draw and edit the topology", support: all("yes") },
  {
    feature: "Canvas with netlab's interface names",
    support: all("yes"),
    note: { libvirt: "Built from netlab's transformed topology (no clab.yml)." }
  },
  { feature: "Validate, preview configs, deploy diff", support: all("yes") },
  {
    feature: "Deploy / destroy the lab",
    support: { clab: "yes", libvirt: "yes", external: "partial" },
    note: {
      libvirt: "Needs KVM, libvirt and vagrant on the backend host (not in the container image).",
      external: "netlab only pushes configs; the devices stay up."
    }
  },
  { feature: "Web shell (netlab connect)", support: all("yes"), note: { libvirt: "SSH into the VM." } },
  { feature: "Run a command on many nodes", support: all("yes") },
  { feature: "Running vs generated config", support: all("yes") },
  {
    feature: "Start / stop / restart / pause a node",
    support: { clab: "yes", libvirt: "yes", external: "no" },
    note: { libvirt: "virsh start / shutdown / reboot / suspend / resume.", external: "netlab doesn't control its power." }
  },
  {
    feature: "Link down / up",
    support: { clab: "yes", libvirt: "yes", external: "no" },
    note: { libvirt: "virsh domif-setlink on the VM's NIC." }
  },
  {
    feature: "Live traffic and errors",
    support: { clab: "yes", libvirt: "partial", external: "no" },
    note: { libvirt: "Link state on every link; counters on LAN links (p2p links are UDP tunnels without a host interface)." }
  },
  {
    feature: "Packet capture",
    support: { clab: "yes", libvirt: "partial", external: "no" },
    note: { libvirt: "LAN links only, on the host tap — same limit as netlab capture." }
  },
  {
    feature: "Link impairment (delay, loss, rate)",
    support: { clab: "yes", libvirt: "no", external: "no" },
    note: { libvirt: "Use netlab tc on the host for LAN links." }
  },
  {
    feature: "Node logs",
    support: { clab: "yes", libvirt: "no", external: "no" },
    note: { libvirt: "No container log; read the device's logs in its shell." }
  },
  {
    feature: "Image manager",
    support: { clab: "yes", libvirt: "no", external: "no" },
    note: { libvirt: "Vagrant boxes are managed with netlab libvirt package." }
  }
];
