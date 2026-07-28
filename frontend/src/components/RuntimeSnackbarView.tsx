import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Alert, IconButton, Snackbar, Stack, Tooltip } from "@mui/material";
import { useState } from "react";
import type { RuntimeSnackbarState } from "../lifecycle/types";

interface Props {
  snackbar: RuntimeSnackbarState;
  onClose: () => void;
}

export function RuntimeSnackbarView({ snackbar, onClose }: Props) {
  const { severity } = snackbar;
  const [copied, setCopied] = useState(false);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(snackbar.message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Snackbar
      open={snackbar.open}
      autoHideDuration={5000}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      sx={{ maxWidth: { xs: "calc(100vw - 32px)", sm: 560 } }}
    >
      <Alert
        severity={severity}
        variant="outlined"
        action={
          <Stack direction="row" spacing={0.25}>
            <Tooltip title={copied ? "Copied" : "Copy message"}>
              <IconButton
                aria-label="Copy notification message"
                color="inherit"
                size="small"
                onClick={() => void copyMessage()}
                sx={{
                  color: copied ? "success.main" : "inherit",
                  transform: copied ? "scale(1.12)" : "scale(1)",
                  transition: "color 160ms ease, transform 160ms ease",
                }}
              >
                <ContentCopyIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
            <IconButton aria-label="Close notification" color="inherit" size="small" onClick={onClose}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Stack>
        }
        sx={(theme) => ({
          alignItems: "flex-start",
          bgcolor: "background.paper",
          borderColor: `${severity}.main`,
          boxShadow: theme.shadows[6],
          color: "text.primary",
          width: "100%",
          "& .MuiAlert-icon": { color: `${severity}.main` },
          "& .MuiAlert-action": { color: "text.secondary" },
          "& .MuiAlert-message": { whiteSpace: "pre-wrap", wordBreak: "break-word" }
        })}
      >
        {snackbar.message}
      </Alert>
    </Snackbar>
  );
}
