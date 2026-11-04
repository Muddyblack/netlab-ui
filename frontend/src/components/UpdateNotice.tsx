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
    <Snackbar open anchorOrigin={{ vertical: "bottom", horizontal: "left" }} sx={{ maxWidth: { xs: "calc(100vw - 32px)", sm: 460 } }}>
      <Alert
        severity="info"
        variant="outlined"
        sx={{ bgcolor: "background.paper", alignItems: "flex-start" }}
        action={
          <>
            <Button color="inherit" size="small" href={update.releaseUrl} target="_blank" rel="noreferrer" onClick={dismiss}>
              What's new
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
