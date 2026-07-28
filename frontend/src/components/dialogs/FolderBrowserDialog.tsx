import { useEffect, useState, useCallback } from "react";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { api } from "../../api/client";

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the absolute path of the chosen directory. */
  onChoose: (path: string) => Promise<void>;
}

/** Server-backed directory picker for adding a workspace root — navigates the
 * backend filesystem instead of asking the user to type an absolute path. */
export function FolderBrowserDialog({ open, onClose, onChoose }: Props) {
  const [cwd, setCwd] = useState<string>("");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.browseFs(path);
      setCwd(res.path);
      setParent(res.parent);
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void browse(undefined);
  }, [open, browse]);

  const handleChoose = async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      await onChoose(cwd);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const segments = cwd.split("/").filter(Boolean);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Folder to Workspace</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              startIcon={<ArrowUpwardIcon fontSize="small" />}
              disabled={loading || !parent}
              onClick={() => parent && void browse(parent)}
            >
              Up
            </Button>
            <Breadcrumbs sx={{ flex: 1, minWidth: 0 }} maxItems={4}>
              <Link component="button" underline="hover" onClick={() => void browse("/")}>/</Link>
              {segments.map((seg, i) => {
                const segPath = "/" + segments.slice(0, i + 1).join("/");
                return (
                  <Link key={segPath} component="button" underline="hover" onClick={() => void browse(segPath)}>
                    {seg}
                  </Link>
                );
              })}
            </Breadcrumbs>
          </Stack>

          <Box sx={{ height: 300, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
            {entries.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                {loading ? "Loading…" : "No subfolders here."}
              </Typography>
            ) : (
              <List dense disablePadding>
                {entries.map((e) => (
                  <ListItemButton key={e.path} onClick={() => void browse(e.path)} disabled={loading}>
                    <ListItemIcon sx={{ minWidth: 34 }}>
                      <FolderIcon fontSize="small" color="primary" />
                    </ListItemIcon>
                    <ListItemText primary={e.name} />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
            {cwd || "—"}
          </Typography>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleChoose()} disabled={loading || !cwd}>
          Add this folder
        </Button>
      </DialogActions>
    </Dialog>
  );
}
