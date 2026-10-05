import CloseIcon from "@mui/icons-material/Close";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Button, IconButton, Paper, Stack, Typography } from "@mui/material";

import { AGENT_SPOTLIGHT_LABEL, clearAgentGuide, useAgentGuide } from "../../host/agentGuideStore";
import { setSpotlight, useSpotlight } from "../../host/canvasSpotlight";

/** The explanation an attached AI agent shows next to what it opened or spotlighted. */
export function AgentGuideCard() {
  const note = useAgentGuide();
  const spotlight = useSpotlight();
  if (!note) return null;
  const dismiss = () => {
    clearAgentGuide();
    if (spotlight?.label === AGENT_SPOTLIGHT_LABEL) setSpotlight(null);
  };
  return (
    <Paper
      key={note.seq}
      elevation={8}
      role="status"
      aria-live="polite"
      sx={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        // above dialogs, so a note can point at what an agent just opened
        zIndex: (theme) => theme.zIndex.modal + 2,
        maxWidth: "min(560px, calc(100vw - 32px))",
        px: 2,
        py: 1.5,
        borderLeft: 4,
        borderColor: "primary.main"
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <SmartToyOutlinedIcon color="primary" sx={{ mt: 0.25 }} />
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {note.title || "Your AI agent"}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {note.message}
          </Typography>
          {note.link && (
            <Button
              size="small"
              variant="outlined"
              endIcon={<OpenInNewIcon fontSize="small" />}
              href={note.link.url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ alignSelf: "flex-start", mt: 0.75 }}
            >
              {note.link.label}
            </Button>
          )}
        </Stack>
        <IconButton size="small" aria-label="Dismiss" onClick={dismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  );
}
