import { Suspense, lazy, useEffect, useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryIcon from "@mui/icons-material/History";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import SubjectIcon from "@mui/icons-material/Subject";
import TerminalIcon from "@mui/icons-material/Terminal";
import { Box, IconButton, Menu, MenuItem, Paper, Tab, Tabs, Tooltip, Typography } from "@mui/material";

import { usePanelInsets } from "../panels/units-dock/usePanelInsets";
import { loadRecentShellNodes, type SessionTab } from "../hooks/useSessionDock";

// xterm only loads once a shell tab actually opens — log tabs shouldn't pay for it.
const Shell = lazy(() => import("./Shell").then((m) => ({ default: m.Shell })));
const NodeLogsPanel = lazy(() => import("./NodeLogsPanel").then((m) => ({ default: m.NodeLogsPanel })));
const DrawioWizard = lazy(() => import("./DrawioWizard").then((m) => ({ default: m.DrawioWizard })));

const HEIGHT_KEY = "netlab.sessionDock.height";
const MIN_HEIGHT = 140;
const DEFAULT_HEIGHT = 320;

function loadHeight(): number {
  const raw = Number(localStorage.getItem(HEIGHT_KEY));
  return Number.isFinite(raw) && raw >= MIN_HEIGHT ? Math.round(raw) : DEFAULT_HEIGHT;
}

function tabIcon(kind: SessionTab["kind"]) {
  if (kind === "shell") return <TerminalIcon sx={{ fontSize: 14 }} />;
  if (kind === "drawio") return <AccountTreeIcon sx={{ fontSize: 14 }} />;
  return <SubjectIcon sx={{ fontSize: 14 }} />;
}

function tabLabel(tab: SessionTab): string {
  return tab.kind === "drawio" ? "draw.io wizard" : tab.node;
}

function tabCloseLabel(tab: SessionTab): string {
  if (tab.kind === "drawio") return "Close draw.io wizard";
  return `Close ${tab.node} ${tab.kind === "shell" ? "terminal" : "logs"}`;
}

interface SessionDockProps {
  sessionId: string;
  tabs: SessionTab[];
  activeKey: string | null;
  open: boolean;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onToggleOpen: () => void;
  onOpenShell: (node: string) => void;
  onPopOut: (tab: SessionTab) => void;
}

/** VS Code-style bottom panel over the canvas: node shells and log streams as
 * sibling tabs. Collapsible to a header strip, drag-resizable, maximizable —
 * never a modal, so the canvas stays interactive. All tabs stay mounted (even
 * collapsed) to keep their WebSockets alive. */
export function SessionDock({ sessionId, tabs, activeKey, open, onSelect, onClose, onToggleOpen, onOpenShell, onPopOut }: SessionDockProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const insets = usePanelInsets(rootRef);
  const [height, setHeight] = useState(loadHeight);
  const [maximized, setMaximized] = useState(false);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  const [recentNodes, setRecentNodes] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem(HEIGHT_KEY, String(height));
  }, [height]);

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const container = rootRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const max = Math.max(MIN_HEIGHT, rect.height - 48);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (e: PointerEvent) => {
      setHeight(Math.min(max, Math.max(MIN_HEIGHT, Math.round(rect.bottom - e.clientY))));
    };
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const activeTab = tabs.find((tab) => tab.key === activeKey) ?? null;
  const recentOutsideTabs = recentNodes.filter((node) => !tabs.some((tab) => tab.kind === "shell" && tab.node === node));

  return (
    <Box
      ref={rootRef}
      data-netlab-session-dock
      sx={{
        position: "absolute",
        bottom: 0,
        left: insets.left,
        right: insets.right,
        ...(open && maximized ? { top: 8 } : {}),
        zIndex: 6,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        pointerEvents: "none"
      }}
    >
      <Paper
        elevation={8}
        square
        sx={{
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          height: open ? (maximized ? "100%" : height) : "auto",
          borderTop: 1,
          borderColor: "divider",
          overflow: "hidden"
        }}
      >
        {open && !maximized && (
          <Box onPointerDown={startResize} sx={{ height: 5, flexShrink: 0, cursor: "ns-resize", "&:hover": { bgcolor: "action.hover" } }} />
        )}

        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, pr: 0.5, ...(open ? { borderBottom: 1, borderColor: "divider" } : {}) }}>
          <Tabs
            value={activeTab ? activeTab.key : false}
            onChange={(_event, key: string) => onSelect(key)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 34, flex: 1, "& .MuiTab-root": { minHeight: 34, py: 0, px: 1.25, textTransform: "none" } }}
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.key}
                value={tab.key}
                label={
                  <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    {tabIcon(tab.kind)}
                    <Typography component="span" variant="caption" sx={{ fontFamily: "monospace" }}>{tabLabel(tab)}</Typography>
                    <IconButton
                      component="span"
                      size="small"
                      aria-label={tabCloseLabel(tab)}
                      onClick={(event) => { event.stopPropagation(); onClose(tab.key); }}
                      sx={{ width: 20, height: 20 }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                }
              />
            ))}
          </Tabs>

          <Tooltip title="Recent node connections">
            <IconButton
              size="small"
              aria-label="Recent node connections"
              onClick={(event) => { setRecentNodes(loadRecentShellNodes()); setHistoryAnchor(event.currentTarget); }}
            >
              <HistoryIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={historyAnchor} open={Boolean(historyAnchor)} onClose={() => setHistoryAnchor(null)}>
            {recentOutsideTabs.length === 0 ? (
              <MenuItem disabled>No closed connections</MenuItem>
            ) : recentOutsideTabs.map((node) => (
              <MenuItem key={node} onClick={() => { onOpenShell(node); setHistoryAnchor(null); }}>{node}</MenuItem>
            ))}
          </Menu>

          {activeTab && (
            <Tooltip title="Move to its own window">
              <IconButton size="small" aria-label="Move session to its own window" onClick={() => onPopOut(activeTab)}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {open && (
            <Tooltip title={maximized ? "Restore panel size" : "Maximize panel"}>
              <IconButton size="small" aria-label={maximized ? "Restore panel size" : "Maximize panel"} onClick={() => setMaximized((value) => !value)}>
                {maximized ? <CloseFullscreenIcon sx={{ fontSize: 16 }} /> : <OpenInFullIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={open ? "Collapse panel" : "Expand panel"}>
            <IconButton size="small" aria-label={open ? "Collapse panel" : "Expand panel"} onClick={onToggleOpen}>
              {open ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Collapsing shrinks this to zero height instead of unmounting so
            shells and log streams keep their connections. */}
        <Box sx={{ flex: open ? 1 : "0 0 0px", minHeight: 0, position: "relative", overflow: "hidden" }}>
          {tabs.map((tab) => (
            <Box key={tab.key} sx={{ display: tab.key === activeKey ? "block" : "none", position: "absolute", inset: 0 }}>
              <Suspense fallback={null}>
                {tab.kind === "shell"
                  ? <Shell node={tab.node} sessionId={sessionId} onClose={() => onClose(tab.key)} />
                  : tab.kind === "drawio"
                  ? <DrawioWizard sessionId={sessionId} onClose={() => onClose(tab.key)} />
                  : <NodeLogsPanel node={tab.node} sessionId={sessionId} />}
              </Suspense>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
