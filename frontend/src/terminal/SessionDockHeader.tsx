import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryIcon from "@mui/icons-material/History";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import { Box, IconButton, Menu, MenuItem, Tab, Tabs, Tooltip, Typography } from "@mui/material";

import { loadRecentShellNodes, type SessionTab } from "../hooks/useSessionDock";
import { tabCloseLabel, tabIcon, tabLabel } from "./sessionTabLabels";

function SessionDockTabStrip({ tabs, activeTab, onSelect, onClose }: {
  tabs: SessionTab[];
  activeTab: SessionTab | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}) {
  return (
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
              {tabIcon(tab)}
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
  );
}

function RecentConnectionsMenu({ anchorEl, onClose, recentOutsideTabs, onOpenShell }: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  recentOutsideTabs: string[];
  onOpenShell: (node: string) => void;
}) {
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
      {recentOutsideTabs.length === 0 ? (
        <MenuItem disabled>No closed connections</MenuItem>
      ) : recentOutsideTabs.map((node) => (
        <MenuItem key={node} onClick={() => { onOpenShell(node); onClose(); }}>{node}</MenuItem>
      ))}
    </Menu>
  );
}

export function SessionDockHeader({
  tabs, activeTab, open, maximized, onSelect, onClose, onToggleOpen, onOpenShell, onOpenMulti, onNewTerminal, onPopOut,
  historyAnchor, setHistoryAnchor, recentOutsideTabs, setRecentNodes, setMaximized,
}: {
  tabs: SessionTab[];
  activeTab: SessionTab | null;
  open: boolean;
  maximized: boolean;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onToggleOpen: () => void;
  onOpenShell: (node: string) => void;
  onOpenMulti: () => void;
  onNewTerminal: () => void;
  onPopOut: (tab: SessionTab) => void;
  historyAnchor: HTMLElement | null;
  setHistoryAnchor: (el: HTMLElement | null) => void;
  recentOutsideTabs: string[];
  setRecentNodes: (nodes: string[]) => void;
  setMaximized: (updater: (value: boolean) => boolean) => void;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, pr: 0.5, ...(open ? { borderBottom: 1, borderColor: "divider" } : {}) }}>
      <SessionDockTabStrip tabs={tabs} activeTab={activeTab} onSelect={onSelect} onClose={onClose} />

      <Tooltip title="New terminal (Ctrl+Shift+`)">
        <IconButton size="small" aria-label="New terminal" onClick={onNewTerminal}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Run a command on several nodes">
        <IconButton size="small" aria-label="Run a command on several nodes" onClick={onOpenMulti}>
          <DynamicFeedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Recent node connections">
        <IconButton
          size="small"
          aria-label="Recent node connections"
          onClick={(event) => { setRecentNodes(loadRecentShellNodes()); setHistoryAnchor(event.currentTarget); }}
        >
          <HistoryIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <RecentConnectionsMenu anchorEl={historyAnchor} onClose={() => setHistoryAnchor(null)} recentOutsideTabs={recentOutsideTabs} onOpenShell={onOpenShell} />

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
  );
}
