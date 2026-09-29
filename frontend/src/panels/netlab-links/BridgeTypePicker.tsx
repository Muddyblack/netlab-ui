import { Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";

export type BridgeType = "bridge" | "ovs-bridge";

const BRIDGE_OPTIONS: Array<{ value: BridgeType; label: string; hint: string }> = [
  { value: "bridge", label: "Linux bridge", hint: "The default kernel bridge" },
  { value: "ovs-bridge", label: "Open vSwitch", hint: "An OVS datapath (needs Open vSwitch on the host)" },
];

interface BridgeTypePickerProps {
  bridgeType: BridgeType;
  saving: boolean;
  onChange: (next: BridgeType) => void;
}

/** Which bridge a LAN is built on. One compact switch instead of two cards:
 * it is a setting, not something to place. */
export function BridgeTypePicker({ bridgeType, saving, onChange }: BridgeTypePickerProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>LANs use</Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={bridgeType}
        disabled={saving}
        onChange={(_event, next: BridgeType | null) => { if (next && next !== bridgeType) onChange(next); }}
      >
        {BRIDGE_OPTIONS.map((option) => (
          <Tooltip key={option.value} title={option.hint} enterDelay={400}>
            <ToggleButton value={option.value} sx={{ textTransform: "none", py: 0.25, px: 1.25, fontSize: "0.75rem" }}>
              {option.label}
            </ToggleButton>
          </Tooltip>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
