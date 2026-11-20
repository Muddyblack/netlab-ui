import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import UpgradeIcon from "@mui/icons-material/Upgrade";
import { Box, Button, IconButton, Paper, Snackbar, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { api, type UpdateStatus } from "../api/client";

const DISMISSED_KEY = "netlab-ui.dismissedUpdate";

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * "A newer version is out", once per version: closing the notice remembers that version, so it comes back only
 * when a still newer release appears. The backend asks PyPI (rarely, cached); NETLAB_UI_UPDATE_CHECK=off disables it.
 */
export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getUpdateStatus()
      .then((status) => {
        if (!cancelled && status.available && status.latest && status.latest !== dismissedVersion()) setUpdate(status);
      })
      .catch(() => undefined); // no notice is better than an error about a notice
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, update.latest ?? "");
    } catch {
      /* private window: it will ask again next time */
    }
    setUpdate(null);
  };

  const copy = () => {
    if (!update.upgradeCommand) return;
    navigator.clipboard
      ?.writeText(update.upgradeCommand)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    // Bottom right: the setup notice sits top centre, and transient toasts use the bottom centre.
    <Snackbar
      open
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      sx={{
        bottom: { xs: 220, sm: 24 }, // on a phone, above the setup notice and the transient toasts
        left: { xs: 16, sm: "auto" },
        right: { xs: 16, sm: 24 }
      }}
    >
      <Paper
        elevation={6}
        role="status"
        sx={{
          width: { xs: "100%", sm: 340 },
          p: 1.5,
          pl: 2,
          borderRadius: 2,
          borderLeft: 3,
          borderLeftColor: "primary.main"
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <UpgradeIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>
            netlab-ui {update.latest} is out
          </Typography>
          <IconButton aria-label="Dismiss update notice" size="small" onClick={dismiss} sx={{ mr: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ ml: 3.5, mt: -0.25 }}>
          You have {update.current}
        </Typography>
        {update.upgradeCommand && (
          <Stack
            direction="row"
            alignItems="flex-start"
            sx={{ mt: 1.25, pl: 1, borderRadius: 1, bgcolor: "action.hover", fontFamily: "monospace", fontSize: 12 }}
          >
            <Box
              component="code"
              title={update.upgradeCommand}
              sx={{ flex: 1, minWidth: 0, py: 0.5, overflowWrap: "anywhere", lineHeight: 1.5 }}
            >
              {update.upgradeCommand}
            </Box>
            <Tooltip title={copied ? "Copied" : "Copy command"}>
              <IconButton aria-label="Copy update command" size="small" onClick={copy}>
                {copied ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          </Stack>
        )}
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.75, mb: -0.5 }}>
          <Button size="small" variant="text" href={update.releaseUrl} target="_blank" rel="noreferrer" onClick={dismiss}>
            What&apos;s new
          </Button>
        </Box>
      </Paper>
    </Snackbar>
  );
}
