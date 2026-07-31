import { useEffect, useState } from "react";
import { Box, CircularProgress, Fade, Typography } from "@mui/material";

interface TransformIndicatorProps {
  /** True while a background `netlab create` is warming the canvas projection. */
  active: boolean;
  /**
   * How long the transform has to run before we say anything. A transform that
   * resolves in a few hundred ms is invisible anyway — the canvas stays correct
   * throughout — so flashing a pill for it is worse than staying quiet.
   */
  delayMs?: number;
}

/**
 * A quiet inline "working on it" pill for the background netlab transform.
 *
 * This replaces the toasts that used to announce the transform starting and
 * finishing. A state that recurs on every topology edit and clears in a second
 * or two does not warrant a notification each time — toasts are reserved for
 * failures, which are the only outcome the user actually has to act on.
 */
export function TransformIndicator({ active, delayMs = 600 }: TransformIndicatorProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return (
    <Fade in={visible} unmountOnExit>
      <Box
        sx={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: (theme) => theme.zIndex.snackbar - 1,
          // Purely informational — it must never intercept a canvas drag.
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 0.75,
          px: 1.75,
          borderRadius: 999,
          border: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          backdropFilter: "blur(6px)",
          boxShadow: 3,
        }}
      >
        <CircularProgress size={14} thickness={5} />
        <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
          Updating topology…
        </Typography>
      </Box>
    </Fade>
  );
}
