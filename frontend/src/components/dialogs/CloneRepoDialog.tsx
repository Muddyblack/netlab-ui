import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";

interface Props {
  open: boolean;
  onClose: () => void;
  onClone: (repoUrl: string) => Promise<void>;
}

export function CloneRepoDialog({ open, onClose, onClone }: Props) {
  const [mode, setMode] = useState<"url" | "popular">("url");
  const [popularValue, setPopularValue] = useState("https://github.com/ipspace/netlab-examples");
  const [urlInput, setUrlInput] = useState("https://github.com/ipspace/netlab-examples");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const targetUrl = mode === "popular" ? popularValue : urlInput;
    if (!targetUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onClone(targetUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Clone Repository</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Clone a Git repository containing topologies and labs to your local environment.
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel id="clone-source-label">Source</InputLabel>
            <Select
              labelId="clone-source-label"
              label="Source"
              value={mode}
              onChange={(e) => setMode(e.target.value as "url" | "popular")}
            >
              <MenuItem value="url">Repository URL</MenuItem>
              <MenuItem value="popular">Popular Lab</MenuItem>
            </Select>
          </FormControl>
          {mode === "popular" ? (
            <FormControl fullWidth size="small">
              <InputLabel id="clone-popular-label">Popular Lab</InputLabel>
              <Select
                labelId="clone-popular-label"
                label="Popular Lab"
                value={popularValue}
                onChange={(e) => setPopularValue(e.target.value)}
              >
                <MenuItem value="https://github.com/ipspace/netlab-examples">
                  netlab-examples (ipspace/netlab-examples)
                </MenuItem>
              </Select>
            </FormControl>
          ) : (
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Repository or topology URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSubmit(); } }}
            />
          )}
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || (mode === "url" ? !urlInput.trim() : !popularValue)}
        >
          {loading ? "Cloning..." : "Clone"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
