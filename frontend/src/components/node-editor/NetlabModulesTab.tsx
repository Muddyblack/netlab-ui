import { Box, Typography } from "@mui/material";
import { PanelSection, type NodeEditorTabProps } from "@containerlab/clab-ui";
import { ModuleAttributeForms } from "../module-editor/ModuleAttributeForms";
import { ModulePicker } from "../module-editor/ModulePicker";
import type { NetlabNodeEditorData, NetlabOnChange } from "./types";

const STRUCTURED = ["bgp", "ospf", "vlan"];

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
  const structured = modules.filter((module) => STRUCTURED.includes(module));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Netlab features configured on this node{modules.length ? ` · ${modules.length} on` : ""}. Modules from a group
          or the topology defaults are added on top.
        </Typography>
        <ModulePicker selected={modules} onToggle={toggle} onClear={() => onChange({ module: [] })} />
      </Box>

      {structured.length > 0 && (
        <PanelSection title={`${structured.map((module) => module.toUpperCase()).join(" · ")} settings`} bodySx={{ p: 1.5 }}>
          <ModuleAttributeForms modules={modules} attrs={data} onChange={(next) => {
            const updates: Record<string, unknown> = { ...next };
            for (const key of Object.keys(data)) if (!(key in next)) updates[key] = undefined;
            onChange(updates);
          }} />
        </PanelSection>
      )}
    </Box>
  );
}
