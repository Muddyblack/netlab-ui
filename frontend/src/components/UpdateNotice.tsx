import CloseIcon from "@mui/icons-material/Close";
import { Alert, Button, IconButton, Snackbar } from "@mui/material";
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

  return (
    // Bottom right, lifted above the row the bottom-centre toasts (host setup, runtime) use: at the bottom left it hid
    // the sidebar's Help & Feedback links and slid under those toasts, which covered its buttons; the top centre
    // belongs to the host-setup banner and lab hints.
    <Snackbar
      open
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      sx={{
        maxWidth: { sm: 400 },
        bottom: { xs: 200, sm: 120 }, // a phone wraps the bottom toast onto more lines
        left: { xs: 16, sm: "auto" },
        right: { xs: 16, sm: 24 }
      }}
    >
      <Alert
        severity="info"
        variant="outlined"
        sx={{ bgcolor: "background.paper", alignItems: "flex-start" }}
        action={
          <>
            <Button color="inherit" size="small" href={update.releaseUrl} target="_blank" rel="noreferrer" onClick={dismiss}>
              What&apos;s new
            </Button>
            <IconButton aria-label="Dismiss update notice" color="inherit" size="small" onClick={dismiss}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </>
        }
      >
        netlab-ui {update.latest} is available (you have {update.current}).
        {update.upgradeCommand && (
          <>
            {" "}
            Update with <code>{update.upgradeCommand}</code>.
          </>
        )}
      </Alert>
    </Snackbar>
  );
}
