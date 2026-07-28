import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import { api } from "../../api/client";

interface ExampleLab {
  name: string;
  description: string;
  repoUrl: string;
  stars: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Clone the chosen repo (URL) into the primary workspace. */
  onClone: (repoUrl: string) => Promise<void>;
}

/** One-click picker of curated netlab example repositories (mirrors
 * containerlab-app's "popular labs" flow) — clone without hunting for a URL. */
export function ExampleLabsDialog({ open, onClose, onClone }: Props) {
  const [labs, setLabs] = useState<ExampleLab[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .listExampleLabs()
      .then((res) => setLabs(res.labs))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  const handleClone = async (repoUrl: string) => {
    setCloning(repoUrl);
    setError(null);
    try {
      await onClone(repoUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Browse Example Labs</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Clone a ready-to-run netlab lab into your primary workspace.
          </Typography>
          {loading ? (
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          ) : (
            <List dense disablePadding>
              {labs.map((lab) => (
                <ListItemButton
                  key={lab.repoUrl}
                  onClick={() => void handleClone(lab.repoUrl)}
                  disabled={cloning !== null}
                  sx={{ borderRadius: 1, mb: 0.5, bgcolor: "action.hover" }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600}>{lab.name}</Typography>
                        <Chip
                          icon={<StarIcon sx={{ fontSize: 14 }} />}
                          label={lab.stars}
                          size="small"
                          variant="outlined"
                        />
                        {cloning === lab.repoUrl && <Typography variant="caption">cloning…</Typography>}
                      </Stack>
                    }
                    secondary={lab.description}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
          {error && (
            <Alert
              severity="error"
              onClose={() => setError(null)}
              sx={{
                "& .MuiAlert-message": {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: "0.8rem"
                }
              }}
            >
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={cloning !== null}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
