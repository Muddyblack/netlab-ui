import { Alert, Autocomplete, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from "@mui/material";

import { LINK_KIND_LABEL, type LinkKind } from "./types";

interface AddLinkDialogProps {
  dialogKind: LinkKind | null;
  nodeNames: string[];
  selected: string[];
  onSelectedChange: (selected: string[]) => void;
  name: string;
  onNameChange: (name: string) => void;
  bridge: string;
  onBridgeChange: (bridge: string) => void;
  hostInterface: string;
  onHostInterfaceChange: (hostInterface: string) => void;
  error: string | null;
  saving: boolean;
  canSave: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function AddLinkDialog({
  dialogKind,
  nodeNames,
  selected,
  onSelectedChange,
  name,
  onNameChange,
  bridge,
  onBridgeChange,
  hostInterface,
  onHostInterfaceChange,
  error,
  saving,
  canSave,
  onClose,
  onSave,
}: AddLinkDialogProps) {
  return (
    <Dialog open={dialogKind !== null} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {dialogKind && `Add ${LINK_KIND_LABEL[dialogKind]}`}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Autocomplete
            multiple
            options={nodeNames}
            value={selected}
            onChange={(_event, value) => onSelectedChange(dialogKind === "lan" ? value : value.slice(-1))}
            renderInput={(params) => (
              <TextField {...params} label={dialogKind === "lan" ? "Nodes" : "Node"} helperText={dialogKind === "lan" ? "Choose at least two nodes." : "Choose one node."} />
            )}
          />
          <TextField label="Link name (optional)" value={name} onChange={(event) => onNameChange(event.target.value)} />
          {dialogKind === "lan" && (
            <TextField label="Bridge name (optional)" value={bridge} onChange={(event) => onBridgeChange(event.target.value)} helperText="Pin the underlying provider bridge name." />
          )}
          {dialogKind === "uplink" && (
            <TextField autoFocus label="Host interface" required value={hostInterface} onChange={(event) => onHostInterfaceChange(event.target.value)} placeholder="enp5s0" />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={saving || !canSave}>
          {saving ? <CircularProgress size={18} color="inherit" /> : "Add link"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
