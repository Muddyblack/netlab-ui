import { Accordion, AccordionDetails, AccordionSummary, Box, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import type { MultiserverResult } from "../../api/client";

interface VxlanOverlaySectionProps {
  vxlan: MultiserverResult["vxlan"];
  onPatch: (patch: Partial<MultiserverResult["vxlan"]>) => void;
}

export function VxlanOverlaySection({ vxlan, onPatch }: VxlanOverlaySectionProps) {
  return (
    <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 0 }}>
        <Typography variant="subtitle2">VXLAN overlay</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 1.25, px: 0 }}>
        <TextField
          size="small"
          label="Default interface (dev)"
          required
          error={!vxlan.dev}
          helperText={!vxlan.dev ? "Required — the interface VXLAN tunnels bind to" : undefined}
          defaultValue={vxlan.dev}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== vxlan.dev) onPatch({ dev: v });
          }}
        />
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            size="small"
            label="VNI base"
            type="number"
            defaultValue={vxlan.vni_base}
            onBlur={(e) => {
              const v = Number(e.target.value) || 10000;
              if (v !== vxlan.vni_base) onPatch({ vni_base: v });
            }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="UDP dstport"
            type="number"
            defaultValue={vxlan.dstport}
            onBlur={(e) => {
              const v = Number(e.target.value) || 4789;
              if (v !== vxlan.dstport) onPatch({ dstport: v });
            }}
            sx={{ flex: 1 }}
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
