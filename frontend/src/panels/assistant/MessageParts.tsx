import { Box, IconButton, Stack, Tooltip } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { ActionBarPrimitive, AuiIf, MessagePrimitive } from "@assistant-ui/react";

type MessageComponents = NonNullable<Parameters<typeof MessagePrimitive.Parts>[0]["components"]>;

export function UserMessage({ components }: { components: MessageComponents }) {
  return (
    <MessagePrimitive.Root
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}
    >
      <Box
        sx={{
          maxWidth: "88%",
          borderRadius: 1,
          bgcolor: "action.selected",
          px: 1.25,
          py: 0.8,
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
          fontSize: "0.875rem",
        }}
      >
        <MessagePrimitive.Parts components={components} />
      </Box>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage({ components }: { components: MessageComponents }) {
  return (
    <MessagePrimitive.Root style={{ minWidth: 0 }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack spacing={1}>
          <MessagePrimitive.Parts components={components} />
        </Stack>
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <AuiIf condition={(state) => state.message.parts.some((part) => part.type === "text")}>
            <Tooltip title="Copy response">
              <ActionBarPrimitive.Copy asChild>
                <IconButton
                  size="small"
                  aria-label="Copy response"
                  sx={{ mt: 0.25, ml: -0.5, width: 26, height: 26, color: "text.secondary" }}
                >
                  <AuiIf condition={(state) => state.message.isCopied}>
                    <CheckIcon color="success" sx={{ fontSize: 14 }} />
                  </AuiIf>
                  <AuiIf condition={(state) => !state.message.isCopied}>
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </AuiIf>
                </IconButton>
              </ActionBarPrimitive.Copy>
            </Tooltip>
          </AuiIf>
        </ActionBarPrimitive.Root>
      </Box>
    </MessagePrimitive.Root>
  );
}
