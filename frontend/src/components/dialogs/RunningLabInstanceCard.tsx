import { Alert, Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { LabInstance } from "../../api/client";

type InstanceAction = "cleanup" | "force-cleanup" | "forget";

interface RunningLabInstanceCardProps {
  instance: LabInstance;
  running: boolean;
  onAction: (instance: LabInstance, action: InstanceAction) => void;
}

export function RunningLabInstanceCard({ instance, running, onAction }: RunningLabInstanceCardProps) {
  const forceCleanupAllowed = instance.directoryExists || (instance.providers.length === 1 && instance.providers[0] === "clab");
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" fontWeight={700}>{instance.name}</Typography>
            <Chip size="small" label={`id: ${instance.id}`} variant="outlined" />
            {instance.providers.map((provider) => <Chip key={provider} size="small" label={provider} />)}
          </Stack>
          <Typography variant="body2" sx={{ mt: 0.75 }}>{instance.status}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
            {instance.directory || "No directory recorded"}
          </Typography>
        </Box>
      </Stack>
      {!instance.directoryExists && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{
            mt: 1.5,
            bgcolor: "var(--vscode-inputValidation-warningBackground)",
            color: "text.primary",
            "& .MuiAlert-icon": { color: "warning.main" },
          }}
        >
          The recorded directory no longer exists. Normal shutdown is unavailable. Force cleanup can recover a containerlab-only instance from its recorded name; otherwise clean resources manually and then forget the stale record.
        </Alert>
      )}
      <Divider sx={{ my: 1.5 }} />
      <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="outlined"
          startIcon={<PowerSettingsNewIcon />}
          disabled={!instance.directoryExists || running}
          onClick={() => onAction(instance, "cleanup")}
          sx={{ textTransform: "none" }}
        >
          Shut down
        </Button>
        <Button
          size="small"
          color="warning"
          variant="outlined"
          startIcon={<WarningAmberIcon />}
          disabled={running || !forceCleanupAllowed}
          onClick={() => onAction(instance, "force-cleanup")}
          sx={{ textTransform: "none" }}
        >
          Force cleanup
        </Button>
        <Button
          size="small"
          color="error"
          variant="outlined"
          startIcon={<DeleteForeverIcon />}
          disabled={running}
          onClick={() => onAction(instance, "forget")}
          sx={{ textTransform: "none" }}
        >
          Forget record
        </Button>
      </Stack>
    </Box>
  );
}
