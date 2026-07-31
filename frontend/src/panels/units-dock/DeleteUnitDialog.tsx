import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

interface DeleteUnitDialogProps {
  unitName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteUnitDialog({ unitName, onCancel, onConfirm }: DeleteUnitDialogProps) {
  return (
    <Dialog open={Boolean(unitName)} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Delete Unit</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2">
          Are you sure you want to delete the unit <strong>{unitName}</strong>? Its file is
          removed from the workspace. This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} size="small">
          Cancel
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained" size="small">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
