import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import { Box, IconButton, Paper, Stack, Typography } from "@mui/material";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";

import type { TeachingDocument } from "../../api/client";

interface TourPresenterProps {
  document: TeachingDocument;
  index: number;
  setIndex: Dispatch<SetStateAction<number>>;
  onExit: () => void;
}

// Full-bleed playback layer. It sits above the app chrome but stays
// pointer-events transparent over the canvas, so the presenter can still click
// live nodes while narrating — the whole point of presenting a real lab rather
// than slides. Only the caption bar and nav buttons capture clicks.
export function TourPresenter({ document: doc, index, setIndex, onExit }: TourPresenterProps) {
  const total = doc.steps.length;
  const step = doc.steps[index] ?? null;
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        setIndex((i) => Math.min(total - 1, i + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (event.key === "Escape") {
        event.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, setIndex, onExit]);

  return createPortal(
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        pointerEvents: "none",
        // Subtle vignette pulls the eye toward the spotlighted canvas centre.
        background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)",
      }}
    >
      {/* Exit affordance, top-right */}
      <Paper
        elevation={6}
        sx={{ position: "absolute", top: 12, right: 12, pointerEvents: "auto", borderRadius: 2, px: 1, py: 0.25 }}
      >
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
            {doc.title}
          </Typography>
          <IconButton size="small" onClick={onExit} aria-label="Exit tour"><CloseIcon fontSize="small" /></IconButton>
        </Stack>
      </Paper>

      {/* Caption bar, bottom-centre */}
      <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 24, display: "flex", justifyContent: "center", px: 2 }}>
        <Paper
          elevation={10}
          sx={{
            pointerEvents: "auto",
            width: "min(760px, 92vw)",
            borderRadius: 3,
            px: 1,
            py: 1,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton disabled={atStart} onClick={() => setIndex((i) => Math.max(0, i - 1))} aria-label="Previous step">
              <ChevronLeftIcon />
            </IconButton>
            <Box
              // Re-mount on step change so the fade re-runs.
              key={index}
              sx={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                animation: "tourFade 260ms ease",
                "@keyframes tourFade": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
              }}
            >
              {step ? (
                <>
                  <Typography variant="subtitle1" fontWeight={700} noWrap>
                    {step.caption || `Step ${index + 1}`}
                  </Typography>
                  {step.note && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                      {step.note}
                    </Typography>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">This tour has no steps.</Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {total ? index + 1 : 0} / {total} · ← → to navigate · Esc to exit
              </Typography>
            </Box>
            <IconButton disabled={atEnd} onClick={() => setIndex((i) => Math.min(total - 1, i + 1))} aria-label="Next step">
              <ChevronRightIcon />
            </IconButton>
          </Stack>
        </Paper>
      </Box>
    </Box>,
    window.document.body
  );
}
