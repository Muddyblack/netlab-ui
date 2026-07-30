import { useState } from "react";
import { Box, ButtonBase, CircularProgress, Collapse, Stack, Typography } from "@mui/material";
import BuildIcon from "@mui/icons-material/Build";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

function toolStatusLabel(label: string, running: boolean, isError: boolean): string {
  if (running) return `Running ${label}`;
  if (isError) return `${label} failed`;
  return `Used ${label}`;
}

function formatToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

export function ToolCall({
  toolName,
  args,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  const [open, setOpen] = useState(false);
  const running = status.type === "running" && result === undefined;
  const label = toolName.replaceAll("_", " ");
  const statusLabel = toolStatusLabel(label, running, Boolean(isError));

  return (
    <Box
      sx={{
        borderLeft: 2,
        borderColor: isError ? "error.main" : "divider",
        pl: 1,
      }}
    >
      <ButtonBase
        onClick={() => setOpen((value) => !value)}
        sx={{
          width: "100%",
          minHeight: 28,
          justifyContent: "flex-start",
          borderRadius: 1,
          px: 0.5,
          color: "text.secondary",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
          {running ? (
            <CircularProgress size={12} />
          ) : (
            <BuildIcon color={isError ? "error" : "inherit"} sx={{ fontSize: 14 }} />
          )}
          <Typography
            variant="caption"
            sx={{ minWidth: 0, flex: 1, textAlign: "left", fontFamily: "monospace" }}
            noWrap
          >
            {statusLabel}
          </Typography>
          <ExpandMoreIcon
            sx={{
              fontSize: 16,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 120ms ease",
            }}
          />
        </Stack>
      </ButtonBase>
      <Collapse in={open}>
        <Box
          component="pre"
          sx={{
            m: 0.5,
            p: 1,
            maxHeight: "24vh",
            overflow: "auto",
            borderRadius: 1,
            bgcolor: "action.hover",
            color: "text.secondary",
            fontSize: "0.7rem",
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {JSON.stringify(args ?? {}, null, 2)}
          {result !== undefined ? `\n\n${formatToolResult(result)}` : ""}
        </Box>
      </Collapse>
    </Box>
  );
}
