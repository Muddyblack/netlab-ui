import { useMemo, useState } from "react";
import HistoryIcon from "@mui/icons-material/History";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { readPinnedLabPaths, readRecentLabPaths, togglePinnedLabPath } from "../lifecycle/persistence";
import type { LabFileEntry } from "../api/client";

export function AttractorEmptyState({ labs, onOpenLab }: { labs: LabFileEntry[]; onOpenLab: (topologyRef: LabFileEntry["topologyRef"]) => void }) {
  const [pinned, setPinned] = useState(readPinnedLabPaths);
  const animatedLogoSrc = `${import.meta.env.BASE_URL}netlab-full-lockup_animated.svg`;
  const byPath = useMemo(() => new Map(labs.map((lab) => [lab.path, lab])), [labs]);
  const pinnedLabs = pinned.map((path) => byPath.get(path)).filter((lab): lab is LabFileEntry => Boolean(lab));
  const recentLabs = readRecentLabPaths().filter((path) => !pinned.includes(path)).map((path) => byPath.get(path)).filter((lab): lab is LabFileEntry => Boolean(lab)).slice(0, 5);
  const visible = [...pinnedLabs, ...recentLabs];

  return (
    <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", color: "text.primary", px: 3, py: 6, overflow: "auto", zIndex: 5, userSelect: "none", pointerEvents: "none" }}>
      <Box sx={{ width: "min(600px, 100%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Box sx={{ textAlign: "center", maxWidth: 520 }}>
          <Box component="img" src={animatedLogoSrc} alt="Netlab" sx={{ width: { xs: 280, sm: 340 }, maxWidth: "100%", height: "auto", display: "block", mx: "auto", pointerEvents: "none" }} />
          <Typography variant="h4" sx={{ fontWeight: 700, mt: 1.5, letterSpacing: "-0.02em" }}>Open a lab</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
            Choose a recent topology below or open one from the workspace explorer.
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, mt: 1.25 }}>
            Press
            <Box component="kbd" sx={{ px: 0.75, py: 0.2, border: 1, borderColor: "divider", borderRadius: 0.75, bgcolor: "action.hover", color: "text.primary", fontFamily: "inherit", fontSize: "0.72rem", lineHeight: 1.5 }}>Ctrl+P</Box>
            for quick open
          </Typography>
        </Box>

        {visible.length > 0 && (
          <Paper variant="outlined" sx={{ width: "100%", mt: 4, p: 1.5, borderRadius: 2, bgcolor: "background.paper", boxShadow: "0 12px 32px rgba(0, 0, 0, 0.16)", pointerEvents: "auto" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, pt: 0.25, pb: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.09em" }}>Pinned and recent</Typography>
              <Typography variant="caption" color="text.disabled">{visible.length} {visible.length === 1 ? "lab" : "labs"}</Typography>
            </Box>
            <Stack spacing={0.5}>
              {visible.map((lab) => {
                const isPinned = pinned.includes(lab.path);
                return (
                  <Box key={lab.path} onClick={() => onOpenLab(lab.topologyRef)} sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1.25, py: 1.1, borderRadius: 1.25, cursor: "pointer", transition: "background-color 120ms ease", "&:hover": { bgcolor: "action.hover" } }}>
                    <Box sx={{ width: 32, height: 32, flex: "0 0 auto", display: "grid", placeItems: "center", borderRadius: 1, bgcolor: isPinned ? "primary.main" : "action.hover", color: isPinned ? "primary.contrastText" : "text.disabled" }}>
                      {isPinned ? <PushPinIcon sx={{ fontSize: 17 }} /> : <HistoryIcon sx={{ fontSize: 18 }} />}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{lab.labName || lab.filename}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{lab.path}</Typography>
                    </Box>
                    <Tooltip title={isPinned ? "Unpin" : "Pin"}>
                      <IconButton size="small" onClick={(event) => { event.stopPropagation(); setPinned(togglePinnedLabPath(lab.path)); }}>
                        {isPinned ? <PushPinIcon sx={{ fontSize: 17 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 17 }} />}
                      </IconButton>
                    </Tooltip>
                  </Box>
                );
              })}
            </Stack>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
