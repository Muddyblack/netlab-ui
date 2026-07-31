import { Box } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TextMessagePartProps } from "@assistant-ui/react";

export function MarkdownText({ text }: TextMessagePartProps) {
  return (
    <Box
      sx={{
        minWidth: 0,
        overflowWrap: "anywhere",
        fontSize: "0.875rem",
        lineHeight: 1.55,
        "& p": { mt: 0, mb: 1 },
        "& p:last-child": { mb: 0 },
        "& ul, & ol": { mt: 0.5, mb: 1, pl: 2.5 },
        "& li": { mb: 0.35 },
        "& h1, & h2, & h3, & h4": {
          mt: 1.5,
          mb: 0.75,
          fontSize: "0.9375rem",
          lineHeight: 1.35,
        },
        "& h1:first-of-type, & h2:first-of-type, & h3:first-of-type": { mt: 0 },
        "& pre": {
          m: "8px 0",
          p: 1,
          maxWidth: "100%",
          overflowX: "auto",
          borderRadius: 1,
          bgcolor: "action.hover",
          border: 1,
          borderColor: "divider",
          fontSize: "0.75rem",
        },
        "& code": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "0.82em",
        },
        "& :not(pre) > code": {
          px: 0.4,
          py: 0.1,
          borderRadius: 0.5,
          bgcolor: "action.hover",
        },
        "& table": { display: "block", maxWidth: "100%", overflowX: "auto", borderCollapse: "collapse" },
        "& th, & td": { border: 1, borderColor: "divider", px: 0.75, py: 0.5 },
        "& a": { color: "primary.main" },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </Box>
  );
}
