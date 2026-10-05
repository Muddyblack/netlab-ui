import { useEffect, useMemo, useState } from "react";
import HistoryIcon from "@mui/icons-material/History";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { togglePinnedLabPath } from "../lifecycle/persistence";
import { useUserState } from "../api/userState";
import type { LabFileEntry } from "../api/client";
import { NetlabMascot, type MascotState } from "./agents/NetlabMascot";
import { terminalShortcutLabel, useQuickOpenShortcut } from "../app/terminalShortcut";

// Relative odds of each mood; the angry one is a rare treat.
const MOOD_WEIGHTS: [MascotState, number][] = [["idle", 3], ["thinking", 3], ["sleeping", 3], ["idea", 3], ["hustle", 3], ["stressed", 2], ["alarm", 1]];

function nextMood(current: MascotState): MascotState {
  const options = MOOD_WEIGHTS.filter(([mood]) => mood !== current);
  let roll = Math.random() * options.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [mood, weight] of options) {
    roll -= weight;
    if (roll < 0) return mood;
  }
  return options[0][0];
}

export function AttractorEmptyState({ labs, onOpenLab, onCreateWithAi }: { labs: LabFileEntry[]; onOpenLab: (topologyRef: LabFileEntry["topologyRef"]) => void; onCreateWithAi?: () => void }) {
  const pinned = useUserState("pinnedLabs");
  const recent = useUserState("recentLabs");
  const quickOpenShortcut = useQuickOpenShortcut();
  // The mascot drifts between moods while idle and giggles when hovered.
  const [mood, setMood] = useState<MascotState>("idle");
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!onCreateWithAi) return;
    const id = window.setInterval(() => setMood(nextMood), 5000);
    return () => window.clearInterval(id);
  }, [onCreateWithAi]);
  const animatedLogoSrc = `${import.meta.env.BASE_URL}netlab-full-lockup_animated.svg`;
  const byPath = useMemo(() => new Map(labs.map((lab) => [lab.path, lab])), [labs]);
  const pinnedLabs = pinned.map((path) => byPath.get(path)).filter((lab): lab is LabFileEntry => Boolean(lab));
  const recentLabs = recent.filter((path) => !pinned.includes(path)).map((path) => byPath.get(path)).filter((lab): lab is LabFileEntry => Boolean(lab)).slice(0, 5);
  const visible = [...pinnedLabs, ...recentLabs];

  return (
    <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", color: "text.primary", px: 3, py: 6, overflow: "auto", zIndex: 5, userSelect: "none", pointerEvents: "none" }}>
      <Box sx={{ width: "min(600px, 100%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Box sx={{ textAlign: "center", maxWidth: 520 }}>
          <Box component="img" src={animatedLogoSrc} alt="Netlab" sx={{ width: { xs: 280, sm: 340 }, maxWidth: "100%", height: "auto", display: "block", mx: "auto", pointerEvents: "none" }} />
        </Box>

          <Paper variant="outlined" sx={{ width: "100%", mt: 3, p: 1.5, borderRadius: 2, bgcolor: "background.paper", boxShadow: "0 12px 32px rgba(0, 0, 0, 0.16)", pointerEvents: "auto" }}>
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 1, pt: 0.5, pb: 1.25 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Open a lab</Typography>
              {visible.length > 0 && <Typography variant="caption" color="text.disabled">{visible.length} {visible.length === 1 ? "lab" : "labs"}</Typography>}
            </Box>
            {visible.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>No recent labs yet. Open one from the workspace explorer.</Typography>
            )}
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
                      <IconButton size="small" onClick={(event) => { event.stopPropagation(); togglePinnedLabPath(lab.path); }}>
                        {isPinned ? <PushPinIcon sx={{ fontSize: 17 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 17 }} />}
                      </IconButton>
                    </Tooltip>
                  </Box>
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.75, px: 1, pt: 1.25 }}>
              Press
              <Box component="kbd" sx={{ px: 0.75, py: 0.2, border: 1, borderColor: "divider", borderRadius: 0.75, bgcolor: "action.hover", color: "text.primary", fontFamily: "inherit", fontSize: "0.72rem", lineHeight: 1.5 }}>{terminalShortcutLabel(quickOpenShortcut)}</Box>
              for quick open
            </Typography>
          </Paper>

        {onCreateWithAi && (
          <Box
            role="button"
            tabIndex={0}
            onClick={onCreateWithAi}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onCreateWithAi(); } }}
            sx={{ mt: 3, px: 2.5, py: 1, display: "flex", alignItems: "center", gap: 1.5, borderRadius: 2, cursor: "pointer", pointerEvents: "auto", transition: "background-color 120ms ease", "&:hover, &:focus-visible": { bgcolor: "action.hover", outline: "none" } }}
          >
            <NetlabMascot size={64} state={hovered ? "giggle" : mood} showCaption={false} />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>Create a lab with AI</Typography>
              <Typography variant="caption" color="text.secondary">Start from scratch and describe the network to your agent</Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
