import { Box, Button, Stack, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { SuggestionPrimitive, ThreadPrimitive } from "@assistant-ui/react";

import { NetlabMascot } from "./NetlabMascot";

export function AssistantWelcome() {
  return (
    <Stack spacing={1} alignItems="center" sx={{ px: 2.5, pt: 5, pb: 2, textAlign: "center" }}>
      <NetlabMascot size={110} />
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 0.5 }}>
        How can I help with this lab?
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300 }}>
        Ask about the topology, inspect the running lab, or have me propose changes for you to approve.
      </Typography>

      <Stack spacing={0.75} sx={{ width: "100%", maxWidth: 340, mt: 1.5 }}>
        <ThreadPrimitive.Suggestions>
          {() => (
            <SuggestionPrimitive.Trigger asChild send={false}>
              <Button
                variant="outlined"
                color="inherit"
                fullWidth
                endIcon={<ArrowForwardIcon sx={{ fontSize: 15, color: "text.secondary" }} />}
                sx={{
                  justifyContent: "space-between",
                  textAlign: "left",
                  textTransform: "none",
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  borderColor: "divider",
                  color: "text.primary",
                  fontWeight: 400,
                  fontSize: "0.8125rem",
                  lineHeight: 1.35,
                  "&:hover": { borderColor: "text.secondary", bgcolor: "action.hover" },
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <SuggestionPrimitive.Title />
                </Box>
              </Button>
            </SuggestionPrimitive.Trigger>
          )}
        </ThreadPrimitive.Suggestions>
      </Stack>
    </Stack>
  );
}
