import { useState } from "react";
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, ListItemText, Menu, MenuItem,
  Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";

import { postLinkCommand } from "../../../api/linkCommands";
import type { LinkTraffic } from "./linkTraffic";

type Impairment = { delay?: string; jitter?: string; loss?: string; rate?: string; corruption?: string };

/** The custom form's fields, in the backend's units (delay/jitter get "ms"). */
const CUSTOM_FIELDS: Array<{ key: keyof Impairment; label: string; unit: string }> = [
  { key: "delay", label: "Delay", unit: "ms" },
  { key: "jitter", label: "Jitter", unit: "ms" },
  { key: "loss", label: "Loss", unit: "%" },
  { key: "rate", label: "Rate limit", unit: "kbit/s" },
  { key: "corruption", label: "Corruption", unit: "%" },
];

const PRESETS: Array<{ label: string; hint: string; fields: Impairment }> = [
  { label: "Add 100 ms delay", hint: "each direction", fields: { delay: "100ms" } },
  { label: "Drop 5 % of packets", hint: "each direction", fields: { loss: "5" } },
  { label: "Cap at 1 Mb/s", hint: "each direction", fields: { rate: "1000" } },
  { label: "Clear impairments", hint: "back to a clean link", fields: {} },
];

/** One-click faults for a live link: pull the cable, or apply a common netem
 * preset to both ends (the Link Impairments form on the link's context menu
 * takes arbitrary values). */
export function LinkFaultMenu({ sessionId, link, onResult }: {
  sessionId: string;
  link: LinkTraffic;
  onResult: (message: string, severity: "success" | "error") => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const ends = [link.source, link.target].filter((end) => end.stats);
  const name = `${link.source.node}:${link.source.iface} ↔ ${link.target.node}:${link.target.iface}`;

  const run = async (label: string, requests: Array<[string, Record<string, unknown>]>) => {
    setAnchor(null);
    const errors = (await Promise.all(requests.map(([path, body]) => postLinkCommand(path, { sessionId, ...body })))).filter(Boolean);
    if (errors.length === requests.length) onResult(`${label} on ${name} failed — ${errors[0]}`, "error");
    else onResult(`${label}: ${name}`, "success");
  };

  const setState = (up: boolean) => run(up ? "Brought up" : "Taken down",
    (up ? ends : ends.slice(0, 1)).map((end) => ["link-state", { node: end.node, interface: end.iface, up }]));

  const impair = (label: string, fields: Impairment) => run(label,
    ends.map((end) => ["link-impairment", { node: end.node, interface: end.iface, ...fields }]));

  return (
    <>
      <Tooltip title="Inject a fault">
        <IconButton size="small" aria-label={`Inject a fault on ${name}`} onClick={(event) => setAnchor(event.currentTarget)} sx={{ width: 22, height: 22 }}>
          <BoltIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {link.down
          ? <MenuItem onClick={() => void setState(true)}><ListItemText primary="Bring link up" /></MenuItem>
          : <MenuItem onClick={() => void setState(false)}><ListItemText primary="Take link down" secondary="like pulling the cable" /></MenuItem>}
        <Divider />
        {PRESETS.map((preset) => (
          <MenuItem key={preset.label} onClick={() => void impair(preset.label, preset.fields)}>
            <ListItemText primary={preset.label} secondary={preset.hint} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); setCustomOpen(true); }}>
          <ListItemText primary="Custom…" secondary="delay, jitter, loss, rate, corruption" />
        </MenuItem>
      </Menu>
      <CustomImpairmentDialog
        open={customOpen}
        name={name}
        onClose={() => setCustomOpen(false)}
        onApply={(fields) => { setCustomOpen(false); void impair("Impairments applied", fields); }}
      />
    </>
  );
}

function CustomImpairmentDialog({ open, name, onClose, onApply }: {
  open: boolean;
  name: string;
  onClose: () => void;
  onApply: (fields: Impairment) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const invalid = CUSTOM_FIELDS.some(({ key }) => values[key] && !/^\d+(\.\d+)?$/.test(values[key].trim()));
  const apply = () => {
    const fields: Impairment = {};
    for (const { key, unit } of CUSTOM_FIELDS) {
      const value = values[key]?.trim();
      if (value) fields[key] = unit === "ms" ? `${value}ms` : value;
    }
    onApply(fields);
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Link impairments</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontFamily: "monospace", fontSize: "0.8rem" }}>{name}</Typography>
        <Stack spacing={1.5}>
          {CUSTOM_FIELDS.map(({ key, label, unit }) => (
            <TextField
              key={key}
              size="small"
              label={label}
              value={values[key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              error={Boolean(values[key]) && !/^\d+(\.\d+)?$/.test(values[key].trim())}
              inputProps={{ inputMode: "decimal" }}
              InputProps={{ endAdornment: <InputAdornment position="end">{unit}</InputAdornment> }}
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          Applied to both ends, so each direction gets it. Empty fields are cleared.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={invalid} onClick={apply}>Apply</Button>
      </DialogActions>
    </Dialog>
  );
}
