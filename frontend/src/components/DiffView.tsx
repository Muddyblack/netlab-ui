import { Box } from "@mui/material";

function diffLineColor(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "success.main";
  if (line.startsWith("-") && !line.startsWith("---")) return "error.main";
  return "text.primary";
}

/** Renders a unified diff with per-line red/green coloring. */
export function DiffView({ diff, maxHeight = "55vh", fontSize = "0.75rem" }: {
  diff: string;
  maxHeight?: number | string;
  fontSize?: number | string;
}) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight, overflow: "auto", bgcolor: "action.hover", borderRadius: 1, border: 1, borderColor: "divider", fontFamily: "monospace", fontSize, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
      {diff.split("\n").map((line, index) => (
        <Box component="span" key={index} sx={{ display: "block", color: diffLineColor(line) }}>{line || " "}</Box>
      ))}
    </Box>
  );
}
