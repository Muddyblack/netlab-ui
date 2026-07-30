import { Stack, Typography } from "@mui/material";
import { AuiIf, type EmptyMessagePartProps } from "@assistant-ui/react";

import { NetlabMascot } from "./NetlabMascot";

export function AssistantThinking(_props: EmptyMessagePartProps) {
  // The Empty part renders whenever a message has no *standard* parts — which
  // includes a turn that produced only a data part (an error or a proposal).
  // Gate on running status so a finished-with-error turn doesn't sit here
  // "Thinking…" forever below its error box.
  return (
    <AuiIf condition={(state) => state.message.status?.type === "running"}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minHeight: 24 }}>
        <NetlabMascot size={20} state="thinking" showCaption={false} />
        <Typography variant="caption" color="text.secondary">
          Thinking…
        </Typography>
      </Stack>
    </AuiIf>
  );
}
