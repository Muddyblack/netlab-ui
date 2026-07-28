import { Box, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeviceHubIcon from "@mui/icons-material/DeviceHub";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";

export type BridgeType = "bridge" | "ovs-bridge";

const BRIDGE_OPTIONS: Array<{
  value: BridgeType;
  title: string;
  subtitle: string;
  icon: typeof HubOutlinedIcon;
}> = [
  {
    value: "bridge",
    title: "Linux bridge",
    subtitle: "Default kernel bridge",
    icon: HubOutlinedIcon,
  },
  {
    value: "ovs-bridge",
    title: "Open vSwitch",
    subtitle: "OVS datapath",
    icon: DeviceHubIcon,
  },
];

interface BridgeTypePickerProps {
  bridgeType: BridgeType;
  saving: boolean;
  onChange: (next: BridgeType) => void;
}

export function BridgeTypePicker({ bridgeType, saving, onChange }: BridgeTypePickerProps) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
        LAN bridge
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
        {BRIDGE_OPTIONS.map((option) => {
          const selectedOption = bridgeType === option.value;
          const Icon = option.icon;
          return (
            <Box
              key={option.value}
              component="button"
              type="button"
              disabled={saving}
              onClick={() => {
                if (!selectedOption) onChange(option.value);
              }}
              sx={{
                appearance: "none",
                cursor: saving ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                textAlign: "left",
                minWidth: 0,
                m: 0,
                p: 0.85,
                borderRadius: 1,
                border: 1,
                borderColor: selectedOption ? "primary.main" : "divider",
                bgcolor: selectedOption ? "action.selected" : "background.paper",
                color: "text.primary",
                opacity: saving ? 0.7 : 1,
                transition: "border-color 0.15s ease, background-color 0.15s ease",
                "&:hover": {
                  borderColor: selectedOption ? "primary.main" : "text.disabled",
                  bgcolor: "action.hover",
                },
                "&:disabled": { cursor: "not-allowed" },
                "&:focus-visible": {
                  outline: "2px solid",
                  outlineColor: "primary.light",
                  outlineOffset: 2,
                },
              }}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 1,
                  bgcolor: selectedOption ? "primary.main" : "action.selected",
                  color: selectedOption ? "primary.contrastText" : "text.secondary",
                  flexShrink: 0,
                }}
              >
                <Icon sx={{ fontSize: 16 }} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" noWrap sx={{ display: "block", fontWeight: 700, lineHeight: 1.2 }}>
                  {option.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: "0.66rem" }}>
                  {option.subtitle}
                </Typography>
              </Box>
              {selectedOption && <CheckCircleIcon sx={{ fontSize: 15, color: "primary.main", flexShrink: 0 }} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
