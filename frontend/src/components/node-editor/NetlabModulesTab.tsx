import { Box, Chip, Typography } from "@mui/material";
import { PanelSection, type NodeEditorTabProps } from "@srl-labs/clab-ui";
import { ModuleAttributeForms } from "../module-editor/ModuleAttributeForms";
import type { NetlabNodeEditorData, NetlabOnChange } from "./types";

const MODULE_SECTIONS = [
  { label: "Routing", modules: ["bgp", "ospf", "isis", "eigrp", "ripv2", "routing"] },
  { label: "Network services", modules: ["vlan", "vrf", "vxlan", "evpn", "mpls", "sr", "srv6"] },
  { label: "Interfaces", modules: ["bfd", "lag", "stp", "gateway", "dhcp"] }
];

function modulesFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function NetlabModulesTab({ data: rawData, onChange: rawOnChange }: NodeEditorTabProps) {
  const data = rawData as NetlabNodeEditorData;
  const onChange = rawOnChange as NetlabOnChange;
  const modules = modulesFrom(data.module);
  const toggle = (module: string) => onChange({
    module: modules.includes(module) ? modules.filter((item) => item !== module) : [...modules, module]
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <PanelSection title={`Enabled modules · ${modules.length}`} withTopDivider={false} bodySx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>Select the netlab features configured on this node. Group and topology defaults may add inherited modules.</Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {MODULE_SECTIONS.map((section) => (
            <Box key={section.label}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.7 }}>{section.label}</Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.65 }}>
                {section.modules.map((module) => <Chip key={module} size="small" clickable label={module} color={modules.includes(module) ? "primary" : "default"} variant={modules.includes(module) ? "filled" : "outlined"} onClick={() => toggle(module)} />)}
              </Box>
            </Box>
          ))}
        </Box>
      </PanelSection>

      <PanelSection title="Module attributes" bodySx={{ p: 1.5 }}>
        {modules.some((module) => ["bgp", "ospf", "vlan"].includes(module)) ? (
          <ModuleAttributeForms modules={modules} attrs={data} onChange={(next) => {
            const updates: Record<string, unknown> = { ...next };
            for (const key of Object.keys(data)) if (!(key in next)) updates[key] = undefined;
            onChange(updates);
          }} />
        ) : (
          <Typography variant="caption" color="text.secondary">Enable BGP, OSPF, or VLAN to edit its common attributes here.</Typography>
        )}
      </PanelSection>
    </Box>
  );
}
