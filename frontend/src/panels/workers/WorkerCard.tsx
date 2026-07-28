import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Chip,
  IconButton,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DnsIcon from "@mui/icons-material/Dns";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import type { WorkerInfo } from "../../api/client";
import { workerColor } from "./colors";

interface WorkerCardProps {
  worker: WorkerInfo;
  index: number;
  autoMode: boolean;
  saving: boolean;
  defaultVxlanDev: string;
  memberOptions: string[];
  groupOptions: string[];
  onPatch: (index: number, patch: Partial<WorkerInfo>) => void;
  onRemove: (index: number) => void;
}

export function WorkerCard({
  worker,
  index,
  autoMode,
  saving,
  defaultVxlanDev,
  memberOptions,
  groupOptions,
  onPatch,
  onRemove
}: WorkerCardProps) {
  const color = workerColor(index);
  return (
    <Accordion
      defaultExpanded
      disableGutters
      elevation={0}
      sx={{
        bgcolor: "transparent",
        "&:before": { display: "none" },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        borderLeft: `3px solid ${color}`
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexGrow: 1, minWidth: 0 }}>
          <DnsIcon sx={{ fontSize: 18, color }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {worker.name || "(unnamed)"}
          </Typography>
          {worker.host && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {worker.host}
            </Typography>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 1.25, pt: 0 }}>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            size="small"
            label="Name"
            defaultValue={worker.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== worker.name) onPatch(index, { name: v });
            }}
            sx={{ flex: 1 }}
          />
          <Tooltip title="Remove worker">
            <span>
              <IconButton size="small" color="error" disabled={saving} onClick={() => onRemove(index)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            size="small"
            label="Host (IP / hostname)"
            defaultValue={worker.host}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== worker.host) onPatch(index, { host: v });
            }}
            sx={{ flex: 2 }}
          />
          {autoMode && (
            <TextField
              size="small"
              label="Weight"
              type="number"
              defaultValue={worker.weight}
              inputProps={{ min: 1 }}
              onBlur={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1);
                if (v !== worker.weight) onPatch(index, { weight: v });
              }}
              sx={{ flex: 1 }}
            />
          )}
        </Box>

        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={groupOptions}
          value={worker.groups ?? []}
          onChange={(_, value) => onPatch(index, { groups: value as string[] })}
          renderTags={(value, getTagProps) =>
            value.map((option, i) => <Chip size="small" label={option} {...getTagProps({ index: i })} key={option} />)
          }
          renderInput={(params) => <TextField {...params} label="Groups on this worker" placeholder="add group" />}
        />

        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={memberOptions}
          value={worker.members ?? []}
          onChange={(_, value) => onPatch(index, { members: value as string[] })}
          renderTags={(value, getTagProps) =>
            value.map((option, i) => <Chip size="small" label={option} {...getTagProps({ index: i })} key={option} />)
          }
          renderInput={(params) => <TextField {...params} label="Individual nodes" placeholder="add node" />}
        />

        <TextField
          size="small"
          label="VXLAN interface override (optional)"
          defaultValue={worker.vxlan_dev ?? ""}
          placeholder={defaultVxlanDev}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const next = v ? v : null;
            if (next !== (worker.vxlan_dev ?? null)) onPatch(index, { vxlan_dev: next });
          }}
        />

        {worker.resolvedNodes.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary">
              Placed here:
            </Typography>
            {worker.resolvedNodes.map((n) => (
              <Chip key={n} size="small" label={n} sx={{ bgcolor: `${color}22`, color, fontSize: "0.68rem", height: 20 }} />
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
