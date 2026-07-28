import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from "@mui/material";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export function NewLabDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  const handleConfirm = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate(name.trim());
    } finally {
      setLoading(false);
    }
  };

  const safe = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "";
  const previewFilename = safe ? `${safe}.yml` : "";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Create Lab Topology</DialogTitle>
      <DialogContent sx={{ pt: "8px !important" }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose a name for the new netlab topology file.
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Endpoint: <strong>Local workspace</strong>
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="Topology file name"
          placeholder="new-lab"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleConfirm(); } }}
          disabled={loading}
          helperText={previewFilename ? `Will be saved as: ${previewFilename}` : "Example: new-lab"}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={loading || !name.trim()}>
          {loading ? "Creating..." : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
