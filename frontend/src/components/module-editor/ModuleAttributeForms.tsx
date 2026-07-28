import { Box, Typography } from "@mui/material";
import { InputField, SelectField } from "@srl-labs/clab-ui";

const BOOLEAN_OPTIONS = [
  { value: "", label: "Inherited / Default" },
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" }
];

function moduleValues(attrs: Record<string, unknown>, module: string): Record<string, unknown> {
  const nested = attrs[module];
  const result = typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? { ...(nested as Record<string, unknown>) }
    : {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith(`${module}.`)) result[key.slice(module.length + 1)] = value;
  }
  return result;
}

function scalar(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function booleanValue(value: unknown): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

function parseNumberOrText(value: string): string | number | undefined {
  if (!value.trim()) return undefined;
  return /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value.trim();
}

export function updateModuleField(
  attrs: Record<string, unknown>,
  module: string,
  field: string,
  value: unknown
): Record<string, unknown> {
  const next = { ...attrs };
  delete next[`${module}.${field}`];
  const values = moduleValues(next, module);
  if (value === undefined || value === "") delete values[field];
  else values[field] = value;
  if (Object.keys(values).length) next[module] = values;
  else delete next[module];
  return next;
}

export function ModuleAttributeForms({ modules, attrs, onChange }: {
  modules: string[];
  attrs: Record<string, unknown>;
  onChange: (attrs: Record<string, unknown>) => void;
}) {
  const bgp = moduleValues(attrs, "bgp");
  const ospf = moduleValues(attrs, "ospf");
  const vlan = moduleValues(attrs, "vlan");
  const set = (module: string, field: string, value: unknown) => onChange(updateModuleField(attrs, module, field, value));

  if (!modules.some((module) => module === "bgp" || module === "ospf" || module === "vlan")) return null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {modules.includes("bgp") && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>BGP settings</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25 }}>
            <InputField id="module-bgp-as" label="Autonomous system" value={scalar(bgp.as)} onChange={(value) => set("bgp", "as", parseNumberOrText(value))} placeholder="65000 or 1.10" />
            <InputField id="module-bgp-router-id" label="Router ID" value={scalar(bgp.router_id)} onChange={(value) => set("bgp", "router_id", value.trim() || undefined)} placeholder="10.0.0.1" />
            <SelectField id="module-bgp-rr" label="Route reflector" value={booleanValue(bgp.rr)} onChange={(value) => set("bgp", "rr", value === "" ? undefined : value === "true")} options={BOOLEAN_OPTIONS} />
            <SelectField id="module-bgp-next-hop-self" label="IBGP next-hop self" value={booleanValue(bgp.next_hop_self)} onChange={(value) => set("bgp", "next_hop_self", value === "" ? undefined : value === "true")} options={BOOLEAN_OPTIONS} />
          </Box>
        </Box>
      )}

      {modules.includes("ospf") && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>OSPF settings</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25 }}>
            <InputField id="module-ospf-area" label="Default area" value={scalar(ospf.area)} onChange={(value) => set("ospf", "area", parseNumberOrText(value))} placeholder="0.0.0.0" />
            <InputField id="module-ospf-process" label="Process ID" value={scalar(ospf.process)} onChange={(value) => set("ospf", "process", parseNumberOrText(value))} placeholder="1" />
            <InputField id="module-ospf-router-id" label="Router ID" value={scalar(ospf.router_id)} onChange={(value) => set("ospf", "router_id", value.trim() || undefined)} placeholder="10.0.0.1" />
            <InputField id="module-ospf-reference-bandwidth" label="Reference bandwidth (Mbps)" value={scalar(ospf.reference_bandwidth)} onChange={(value) => set("ospf", "reference_bandwidth", parseNumberOrText(value))} placeholder="100000" />
            <SelectField id="module-ospf-bfd" label="BFD" value={booleanValue(ospf.bfd)} onChange={(value) => set("ospf", "bfd", value === "" ? undefined : value === "true")} options={BOOLEAN_OPTIONS} />
            <SelectField id="module-ospf-passive" label="Passive by default" value={booleanValue(ospf.passive)} onChange={(value) => set("ospf", "passive", value === "" ? undefined : value === "true")} options={BOOLEAN_OPTIONS} />
          </Box>
        </Box>
      )}

      {modules.includes("vlan") && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>VLAN settings</Typography>
          <SelectField
            id="module-vlan-mode"
            label="Default forwarding mode"
            value={scalar(vlan.mode)}
            onChange={(value) => set("vlan", "mode", value || undefined)}
            options={[
              { value: "", label: "Inherited / Default (IRB)" },
              { value: "irb", label: "IRB (bridge + routed interface)" },
              { value: "bridge", label: "Bridge only" },
              { value: "route", label: "Routed subinterfaces" }
            ]}
          />
        </Box>
      )}
    </Box>
  );
}
