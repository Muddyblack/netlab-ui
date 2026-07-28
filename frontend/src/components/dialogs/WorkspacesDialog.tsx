import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { WorkspaceEntry } from "../../lifecycle/types";
import { FolderBrowserDialog } from "./FolderBrowserDialog";

interface Props {
  open: boolean;
  workspaces: WorkspaceEntry[];
  onClose: () => void;
  onAdd: (path: string) => Promise<void>;
  onRemove: (path: string) => Promise<void>;
}

export function WorkspacesDialog({ open, workspaces, onClose, onAdd, onRemove }: Props) {
  const [newPath, setNewPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const runGuarded = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    const path = newPath.trim();
    if (!path) return;
    await runGuarded(async () => {
      await onAdd(path);
      setNewPath("");
    });
  };

  const handleRemove = (path: string) => runGuarded(() => onRemove(path));

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 2, overflow: "hidden" } } }}
      >
        <DialogTitle
          sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 3, py: 2.25 }}
        >
          <Box sx={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 1.5, bgcolor: "primary.main", color: "primary.contrastText" }}>
            <FolderOpenIcon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={650} lineHeight={1.25}>Workspaces</Typography>
            <Typography variant="caption" color="text.secondary">Choose where netlab looks for topology files</Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ px: 3, py: 2.5 }}>
          <Stack spacing={2.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="subtitle2" fontWeight={650}>Workspace folders</Typography>
                <Typography variant="caption" color="text.secondary">YAML topology files are discovered automatically.</Typography>
              </Box>
              <Chip size="small" variant="outlined" label={`${workspaces.length} ${workspaces.length === 1 ? "folder" : "folders"}`} />
            </Stack>

            {workspaces.length === 0 ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                  py: 3.5,
                  px: 2,
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderStyle: "dashed",
                  color: "text.secondary"
                }}
              >
                <FolderOutlinedIcon fontSize="large" />
                <Typography variant="body2">No workspaces yet</Typography>
                <Typography variant="caption">Add a directory below to start scanning for labs.</Typography>
              </Box>
            ) : (
              <Stack spacing={0.75}>
                {workspaces.map((ws) => (
                  <Stack
                    key={ws.path}
                    direction="row"
                    spacing={1.25}
                    alignItems="center"
                    sx={{
                      px: 1.5,
                      py: 1.25,
                      borderRadius: 1.5,
                      border: 1,
                      borderColor: ws.exists ? "divider" : "warning.main",
                      bgcolor: ws.exists ? "background.paper" : "action.hover",
                      transition: "border-color 120ms ease, background-color 120ms ease",
                      "&:hover": { borderColor: ws.exists ? "text.disabled" : "warning.main", bgcolor: "action.hover" }
                    }}
                  >
                    <Box sx={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 1, bgcolor: ws.exists ? "action.selected" : "warning.main", color: ws.exists ? "text.secondary" : "warning.contrastText", flexShrink: 0 }}>
                      {ws.exists ? <FolderOutlinedIcon fontSize="small" /> : <WarningAmberIcon fontSize="small" />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        title={ws.path}
                        sx={{ fontFamily: "monospace", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {ws.path}
                      </Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
                        {!ws.exists ? (
                          <Chip
                            label="missing"
                            size="small"
                            color="warning"
                            variant="outlined"
                            sx={{ height: 18, fontSize: 10.5 }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            {ws.labCount ?? 0} {(ws.labCount ?? 0) === 1 ? "lab" : "labs"}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                    <Tooltip title={workspaces.length > 1 ? "Remove workspace" : "At least one workspace is required"}>
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => void handleRemove(ws.path)}
                          disabled={loading || workspaces.length <= 1}
                          aria-label={`Remove ${ws.path}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
            )}

            <Divider />

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={650}>Add another workspace</Typography>
                  <Typography variant="caption" color="text.secondary">Select a folder or enter its absolute path.</Typography>
                </Box>
                <Button variant="contained" startIcon={<FolderOpenIcon />} onClick={() => setBrowseOpen(true)} disabled={loading}>
                  Browse folders
                </Button>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  fullWidth
                  size="small"
                  placeholder="/home/user/labs"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAdd();
                    }
                  }}
                  disabled={loading}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><FolderOutlinedIcon fontSize="small" color="disabled" /></InputAdornment> } }}
                />
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => void handleAdd()}
                  disabled={loading || !newPath.trim()}
                  sx={{ flexShrink: 0 }}
                >
                  Add path
                </Button>
              </Stack>
            </Box>

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: "auto" }}>
            {workspaces.reduce((total, workspace) => total + (workspace.labCount ?? 0), 0)} labs available
          </Typography>
          <Button onClick={onClose} variant="contained">Done</Button>
        </DialogActions>
      </Dialog>

      <FolderBrowserDialog
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onChoose={async (path) => {
          await onAdd(path);
        }}
      />
    </>
  );
}
