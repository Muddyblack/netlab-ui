import { useState } from "react";
import { Alert, Box, Button, Card, Chip, Divider, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import type { WorkspaceEntry } from "../../lifecycle/types";
import { FolderBrowserDialog } from "./FolderBrowserDialog";

export interface SettingsWorkspacesTabProps {
  workspaces: WorkspaceEntry[];
  onAddWorkspace: (path: string) => Promise<void>;
  onRemoveWorkspace: (path: string) => Promise<void>;
}

function useWorkspaceMutation(mutate: (path: string) => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      await mutate(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, setError, run };
}

export function SettingsWorkspacesTab({ workspaces, onAddWorkspace, onRemoveWorkspace }: SettingsWorkspacesTabProps) {
  const [newPath, setNewPath] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const add = useWorkspaceMutation(async (path) => {
    await onAddWorkspace(path);
    setNewPath("");
  });
  const remove = useWorkspaceMutation(onRemoveWorkspace);
  const loading = add.loading || remove.loading;
  const error = add.error ?? remove.error;

  const handleAdd = () => {
    const path = newPath.trim();
    if (!path) return;
    void add.run(path);
  };

  const dismissError = () => {
    add.setError(null);
    remove.setError(null);
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="subtitle2" fontWeight={650}>Workspace folders</Typography>
          <Typography variant="caption" color="text.secondary">
            Netlab automatically discovers topology YAML files inside these directories.
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={`${workspaces.length} ${workspaces.length === 1 ? "folder" : "folders"}`} />
      </Stack>

      {error && <Alert severity="error" onClose={dismissError}>{error}</Alert>}

      {workspaces.length === 0 ? (
        <Box sx={{ py: 3, textAlign: "center", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1.5 }}>
          <FolderOutlinedIcon color="action" sx={{ fontSize: 36, mb: 0.5 }} />
          <Typography variant="body2" color="text.secondary">No workspace folders added yet.</Typography>
        </Box>
      ) : (
        <Stack spacing={1}>
          {workspaces.map((ws) => {
            const wsName = ws.path.split("/").filter(Boolean).pop() || ws.path;
            return (
              <Card key={ws.path} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                    <FolderOpenIcon color="primary" fontSize="small" />
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography variant="body2" fontWeight={600} noWrap>{wsName}</Typography>
                        {ws.labCount !== undefined && (
                          <Chip size="small" variant="outlined" label={`${ws.labCount} labs`} sx={{ height: 18, fontSize: "0.7rem" }} />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }} noWrap display="block">
                        {ws.path}
                      </Typography>
                    </Box>
                  </Stack>
                  <Tooltip title="Remove workspace">
                    <IconButton size="small" color="error" onClick={() => void remove.run(ws.path)} disabled={loading}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={650} gutterBottom>
          Add workspace folder
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="/path/to/my/netlab-labs"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            disabled={loading}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <FolderOutlinedIcon fontSize="small" color="action" />
                </InputAdornment>
              )
            }}
          />
          <Button variant="outlined" onClick={() => setBrowseOpen(true)} disabled={loading} sx={{ whiteSpace: "nowrap" }}>
            Browse...
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd} disabled={loading || !newPath.trim()}>
            Add
          </Button>
        </Stack>
      </Box>

      <FolderBrowserDialog
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onChoose={async (path) => {
          setNewPath(path);
          setBrowseOpen(false);
        }}
      />
    </Stack>
  );
}
