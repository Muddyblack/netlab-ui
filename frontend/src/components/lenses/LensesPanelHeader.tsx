import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import DifferenceOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SlideshowOutlinedIcon from "@mui/icons-material/SlideshowOutlined";
import { Box, ButtonBase, CircularProgress, IconButton, Stack, Tooltip, Typography } from "@mui/material";

import type { LensWarning } from "../../api/client";
import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import type { LensId } from "./LensCanvasOverlay";
import { LENSES } from "./LensDefinitions";

type LensBadge = { count: number; severity: "error" | "warning" };

function badgeFor(warnings: LensWarning[]): LensBadge | undefined {
  if (!warnings.length) return undefined;
  const severity = warnings.some((warning) => warning.severity === "error") ? "error" as const : "warning" as const;
  return { count: warnings.length, severity };
}

// Warning counts surface on the lens tabs themselves, so a conflict is
// visible before the lens is even opened — no scroll position can hide it.
function computeLensBadges(bundle: NetlabLensesState["bundle"]): Partial<Record<LensId, LensBadge>> {
  if (!bundle) return {};
  return { addressing: badgeFor(bundle.addressing.warnings), routing: badgeFor(bundle.controlPlane.warnings) };
}

interface LensesPanelHeaderProps {
  bundle: NetlabLensesState["bundle"];
  lens: LensId;
  setLens: (lens: LensId) => void;
  teachingOpen: boolean;
  setTeachingOpen: (updater: (open: boolean) => boolean) => void;
  overlayPinned: boolean;
  toggleOverlayPinned: () => void;
  loading: boolean;
  refresh: () => Promise<unknown>;
  onOpenReport: () => void;
  onOpenConfigDiff: () => void;
}

export function LensesPanelHeader({
  bundle,
  lens,
  setLens,
  teachingOpen,
  setTeachingOpen,
  overlayPinned,
  toggleOverlayPinned,
  loading,
  refresh,
  onOpenReport,
  onOpenConfigDiff,
}: LensesPanelHeaderProps) {
  const lensBadges = computeLensBadges(bundle);
  return (
    <Box sx={{ flexShrink: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Netlab Lenses</Typography>
          {bundle && (
            <Typography variant="caption" color="text.secondary">
              Revision {bundle.revision} · Netlab {bundle.netlabVersion ?? "unknown"}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
          <Tooltip title="Interactive reports"><IconButton size="small" onClick={onOpenReport}><ArticleOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Compare node configs"><IconButton size="small" onClick={onOpenConfigDiff}><DifferenceOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={overlayPinned ? "Overlay pinned — stays on other tabs" : "Pin overlay to keep it when you leave Lenses"}><IconButton size="small" color={overlayPinned ? "warning" : "default"} onClick={toggleOverlayPinned}><PushPinOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Guided tour"><IconButton size="small" color={teachingOpen ? "warning" : "default"} onClick={() => setTeachingOpen((open) => !open)}><SlideshowOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Refresh lens data"><span><IconButton size="small" disabled={loading} onClick={() => void refresh()}>{loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}</IconButton></span></Tooltip>
        </Stack>
      </Stack>
      {!teachingOpen && (
        <Box
          role="tablist"
          aria-label="Netlab lens"
          sx={{ mt: 1, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 0.5 }}
        >
          {LENSES.map((item) => {
            const active = lens === item.id;
            const badge = lensBadges[item.id];
            return (
              <ButtonBase
                key={item.id}
                role="tab"
                aria-selected={active}
                onClick={() => setLens(item.id)}
                sx={{
                  justifyContent: "flex-start",
                  gap: 0.75,
                  px: 1,
                  py: 0.55,
                  borderRadius: 1.5,
                  border: "1px solid",
                  borderColor: active ? "primary.main" : "divider",
                  bgcolor: active ? "action.selected" : "transparent",
                  color: active ? "primary.main" : "text.secondary",
                  transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
                  "& .MuiSvgIcon-root": { fontSize: 18, flexShrink: 0 },
                  "&:hover": {
                    bgcolor: "action.hover",
                    borderColor: active ? "primary.main" : "text.disabled",
                    color: active ? "primary.main" : "text.primary",
                  },
                }}
              >
                {item.icon}
                <Box
                  component="span"
                  sx={{ fontSize: "0.78rem", fontWeight: active ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {item.label}
                </Box>
                {badge && (
                  <Box
                    component="span"
                    aria-label={`${badge.count} warning${badge.count === 1 ? "" : "s"}`}
                    sx={{
                      ml: "auto",
                      flexShrink: 0,
                      minWidth: 16,
                      height: 16,
                      px: 0.4,
                      borderRadius: 999,
                      bgcolor: `${badge.severity}.main`,
                      color: `${badge.severity}.contrastText`,
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      lineHeight: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {badge.count}
                  </Box>
                )}
              </ButtonBase>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
