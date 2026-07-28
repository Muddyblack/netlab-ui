import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";

import { getApiBase } from "../../api/endpoint";

interface PlaceUnitDialogProps {
  open: boolean;
  sessionId: string;
  unitName: string;
  onClose: () => void;
  onPlaced: () => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

// Parameterized placement — "a room of N workstations, device = X, image = Y".
// Count/prefix control naming; device/image standardize every placed node
// (applied server-side during expansion, propagating into sub-units).
export function PlaceUnitDialog({ open, sessionId, unitName, onClose, onPlaced, onToast }: PlaceUnitDialogProps) {
  const [count, setCount] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [device, setDevice] = useState("");
  const [image, setImage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCount(1);
      setPrefix("");
      setDevice("");
      setImage("");
    }
  }, [open, unitName]);

  const place = async () => {
    setSaving(true);
    try {
      const overrides: Record<string, string> = {};
      if (device.trim()) overrides.device = device.trim();
      if (image.trim()) overrides.image = image.trim();
      const res = await fetch(`${getApiBase()}/api/topology/templates/instantiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          template: unitName,
          count: Math.max(1, count),
          prefix: prefix.trim() || undefined,
          origin: { x: 0, y: 0 },
          overrides: Object.keys(overrides).length ? overrides : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to place unit");
      onToast(`Placed ${count} × ${unitName}`, "success");
      onPlaced();
      onClose();
    } catch (err) {
      onToast(`Could not place ${unitName}: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Place {unitName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <TextField
            label="Count"
            type="number"
            size="small"
            value={count}
            onChange={(event) => setCount(Number(event.target.value) || 1)}
            slotProps={{ htmlInput: { min: 1, max: 200 } }}
            helperText={count > 1 ? `Creates ${prefix || unitName}1 … ${prefix || unitName}${count}` : "One instance"}
          />
          <TextField
            label="Name prefix (optional)"
            size="small"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            placeholder={unitName}
          />
          <Typography variant="overline" color="text.secondary">Standardize (optional)</Typography>
          <TextField
            label="Device override"
            size="small"
            value={device}
            onChange={(event) => setDevice(event.target.value)}
            placeholder="e.g. eos, frr, linux"
            helperText="Replaces every node's device"
          />
          <TextField
            label="Image override"
            size="small"
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="e.g. ceos:4.34.2F"
          />
          {(device.trim() || image.trim()) && (
            <Alert severity="info" sx={{ py: 0.25 }}>
              Every placed node will use {device.trim() && <strong>{device.trim()}</strong>}
              {device.trim() && image.trim() ? " / " : ""}
              {image.trim() && <strong>{image.trim()}</strong>}.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void place()} disabled={saving}>Place</Button>
      </DialogActions>
    </Dialog>
  );
}
