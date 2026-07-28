import { lazy, Suspense, useMemo } from "react";
import { Box, CircularProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";

import { languageForPath } from "./languageForPath";
import { parseUnifiedDiff } from "./parseUnifiedDiff";

import { resolveThemeMode } from "../theme";

const MonacoDiffViewer = lazy(() => import("./lenses/MonacoDiffViewer"));

/** Renders a proposal's unified diff with the same Monaco diff editor the config-compare view uses. */
export function ProposalDiffView({ diff, height = 220 }: { diff: string; height?: number | string }) {
  const theme = useTheme();
  const effectiveTheme = theme.palette.mode === "dark" || resolveThemeMode() === "dark" ? "dark" : "light";
  const { original, modified, path } = useMemo(() => parseUnifiedDiff(diff), [diff]);

  return (
    <Box sx={{ height, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      <Suspense fallback={<Box sx={{ display: "grid", placeItems: "center", height: "100%" }}><CircularProgress size={20} /></Box>}>
        <MonacoDiffViewer
          original={original}
          modified={modified}
          language={languageForPath(path)}
          theme={effectiveTheme}
          renderSideBySide={false}
          lineNumbers="off"
        />
      </Suspense>
    </Box>
  );
}
