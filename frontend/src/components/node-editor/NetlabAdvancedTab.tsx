import React, { useMemo, useCallback } from "react";
import { Box } from "@mui/material";

import {
  InputField,
  KeyValueList,
  PanelAddSection,
  PanelSection,
  type NodeEditorTabProps
} from "@srl-labs/clab-ui";
import type { NetlabNodeEditorData, NetlabOnChange } from "./types";

const KNOWN_KEYS = new Set([
  "id", "name", "kind", "type", "image", "version", "icon", "iconColor",
  "iconCornerRadius", "labelPosition", "direction", "labelBackgroundColor",
  "device", "role", "provider", "box", "config", "skip_config", "cpu", "memory",
  "module", "bgp", "ospf", "vlan", "vlans",
  "isCustomTemplate", "customName", "baseName", "interfacePattern", "isDefaultCustomNode"
]);

export const NetlabAdvancedTab: React.FC<NodeEditorTabProps> = ({ data: rawData, onChange: rawOnChange }) => {
  const data = rawData as NetlabNodeEditorData;
  const onChange = rawOnChange as NetlabOnChange;

  const customAttrs = useMemo(() => {
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!KNOWN_KEYS.has(key) && value !== undefined) {
        attrs[key] = typeof value === "string" ? value : String(value);
      }
    }
    return attrs;
  }, [data]);

  const handleAttrsChange = useCallback(
    (newAttrs: Record<string, string>) => {
      const updates: Record<string, unknown> = { ...newAttrs };

      // Set removed custom attributes to undefined so they are deleted
      for (const key of Object.keys(data)) {
        if (!KNOWN_KEYS.has(key) && !(key in newAttrs)) {
          updates[key] = undefined;
        }
      }
      onChange(updates);
    },
    [data, onChange]
  );

  const handleAddAttr = useCallback(() => {
    onChange({ ...customAttrs, "": "" });
  }, [customAttrs, onChange]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {/* Resource Limits Section */}
      <PanelSection title="Resource Limits" withTopDivider={false} bodySx={{ p: 2 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <InputField
            id="node-cpu"
            label="CPU Cores"
            type="number"
            value={data.cpu !== undefined ? String(data.cpu) : ""}
            onChange={(v) => onChange({ cpu: v ? parseFloat(v) : undefined })}
            placeholder="e.g. 1.0 or 0.5"
            step={0.1}
            min={0}
          />
          <InputField
            id="node-memory"
            label="Memory Limit"
            value={data.memory !== undefined ? String(data.memory) : ""}
            onChange={(v) => onChange({ memory: v || undefined })}
            placeholder="e.g. 512m or 2g"
          />
        </Box>
      </PanelSection>

      {/* Custom Key-Value Attributes Section */}
      <PanelAddSection title="Custom Netlab Attributes" onAdd={handleAddAttr}>
        <KeyValueList
          items={customAttrs}
          onChange={handleAttrsChange}
          keyPlaceholder="Attribute Key (e.g. bgp.as)"
          valuePlaceholder="Value"
          hideAddButton
        />
      </PanelAddSection>
    </Box>
  );
};
