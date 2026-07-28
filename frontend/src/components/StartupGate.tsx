import { Alert, Box, Button, Typography } from "@mui/material";
import type { StartupState } from "../lifecycle/types";

interface Props {
  startup: StartupState;
  onRetry: () => void;
}

export function StartupGate({ startup, onRetry }: Props) {
  const isChecking = startup.status === "checking";
  const animatedLogoSrc = `${import.meta.env.BASE_URL}netlab-full-lockup_animated.svg`;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 3
      }}
    >
      {isChecking ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 480 }}>
          <Box
            sx={{
              position: "relative",
              width: 260,
              height: 260,
              mb: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Box
              sx={{
                position: "absolute",
                width: 180,
                height: 180,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(255, 120, 0, 0.18) 0%, rgba(255, 60, 0, 0.05) 50%, transparent 100%)",
                filter: "blur(20px)",
                zIndex: 1
              }}
            />
            <Box
              component="img"
              src={animatedLogoSrc}
              alt="Checking netlab"
              sx={{ width: 260, height: "auto", transform: "scale(2)", transformOrigin: "center", zIndex: 2, pointerEvents: "none" }}
            />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 1.5, letterSpacing: "-0.5px" }}>
            Checking netlab environment
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", px: 2, lineHeight: 1.6 }}>
            Verifying the backend before opening the topology UI.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 480, width: "100%" }}>
          <Box
            sx={{
              position: "relative",
              width: 260,
              height: 260,
              mb: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Box
              sx={{
                position: "absolute",
                width: 180,
                height: 180,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(244, 135, 113, 0.14) 0%, rgba(244, 135, 113, 0.04) 50%, transparent 100%)",
                filter: "blur(20px)",
                zIndex: 1
              }}
            />
            <Box
              component="img"
              src={animatedLogoSrc}
              alt="netlab"
              sx={{ width: 260, height: "auto", transform: "scale(2)", transformOrigin: "center", zIndex: 2, pointerEvents: "none" }}
            />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 1.5, letterSpacing: "-0.5px" }}>
            Backend unreachable
          </Typography>
          <Alert severity="error" variant="outlined" sx={{ mb: 2, width: "100%", textAlign: "left" }}>
            {startup.status === "blocked" ? startup.error : ""}
          </Alert>
          <Button variant="contained" onClick={onRetry}>Retry</Button>
        </Box>
      )}
    </Box>
  );
}
