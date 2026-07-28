import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from "@mui/material";

interface Props {
  open: boolean;
  parentPath: string | null;
  onClose: () => void;
  onCreate: (parentPath: string, name: string) => Promise<void>;
}

/** Prompt for a new folder name inside a chosen parent directory. */
export function NewFolderDialog({ open, parentPath, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(""); setError(null); }
  }, [open]);

  const handleCreate = async () => {
    if (!name.trim() || !parentPath) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(parentPath, name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Folder</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {parentPath && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
              in {parentPath}
            </Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleCreate(); } }}
            disabled={loading}
          />
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleCreate()} disabled={loading || !name.trim()}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
