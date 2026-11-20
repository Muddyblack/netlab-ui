import { readNumber, writeStored } from "../utils/storage";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Box, Paper } from "@mui/material";

import { TerminalHost, TerminalSlot, setRunningAgents, useAgentSurface } from "../components/agents/AgentSurface";
import { usePanelInsets } from "../panels/units-dock/usePanelInsets";
import type { SessionTab } from "../hooks/useSessionDock";
import { SessionDockHeader } from "./SessionDockHeader";

// xterm only loads once a shell tab actually opens — log tabs shouldn't pay for it.
const Shell = lazy(() => import("./Shell").then((m) => ({ default: m.Shell })));
const NodeLogsPanel = lazy(() => import("./NodeLogsPanel").then((m) => ({ default: m.NodeLogsPanel })));
const MultiExecPanel = lazy(() => import("./multi-exec/MultiExecPanel").then((m) => ({ default: m.MultiExecPanel })));
const DrawioWizard = lazy(() => import("./DrawioWizard").then((m) => ({ default: m.DrawioWizard })));
const AgentTerminal = lazy(() => import("../components/agents/AgentTerminal").then((m) => ({ default: m.AgentTerminal })));
const LocalTerminal = lazy(() => import("./LocalTerminal").then((m) => ({ default: m.LocalTerminal })));

const HEIGHT_KEY = "netlab.sessionDock.height";
const MIN_HEIGHT = 140;
const DEFAULT_HEIGHT = 320;

function loadHeight(): number {
  const raw = readNumber(HEIGHT_KEY, 0);
  return Number.isFinite(raw) && raw >= MIN_HEIGHT ? Math.round(raw) : DEFAULT_HEIGHT;
}

function sessionTabContent(tab: SessionTab, sessionId: string, onClose: (key: string) => void) {
  if (tab.kind === "shell") return <Shell node={tab.node} sessionId={sessionId} onClose={() => onClose(tab.key)} />;
  if (tab.kind === "drawio") return <DrawioWizard sessionId={sessionId} onClose={() => onClose(tab.key)} />;
  if (tab.kind === "multi") return <MultiExecPanel sessionId={sessionId} />;
  // The terminal itself is hosted by SessionDock (so it survives moving); this is where it shows up.
  if (tab.kind === "agent") return <TerminalSlot holderKey={`${sessionId}:${tab.key}`} />;
  if (tab.kind === "terminal") return <LocalTerminal sessionId={sessionId} onClose={() => onClose(tab.key)} />;
  return <NodeLogsPanel node={tab.node} sessionId={sessionId} />;
}

function SessionDockPanels({ tabs, sessionId, activeKey, open, onClose }: {
  tabs: SessionTab[];
  sessionId: string;
  activeKey: string | null;
  open: boolean;
  onClose: (key: string) => void;
}) {
  return (
    <Box sx={{ flex: open ? 1 : "0 0 0px", minHeight: 0, position: "relative", overflow: "hidden" }}>
      {tabs.map((tab) => (
        <Box key={tab.key} sx={{ display: tab.key === activeKey ? "block" : "none", position: "absolute", inset: 0 }}>
          <Suspense fallback={null}>{sessionTabContent(tab, sessionId, onClose)}</Suspense>
        </Box>
      ))}
    </Box>
  );
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
  onOpenMulti: () => void;
  onNewTerminal: () => void;
  onPopOut: (tab: SessionTab) => void;
}

/** VS Code-style bottom panel over the canvas: node shells and log streams as
 * sibling tabs. Collapsible to a header strip, drag-resizable, maximizable —
 * never a modal, so the canvas stays interactive. All tabs stay mounted (even
 * collapsed) to keep their WebSockets alive. */
export function SessionDock({ sessionId, tabs, activeKey, open, onSelect, onClose, onToggleOpen, onOpenShell, onOpenMulti, onNewTerminal, onPopOut }: SessionDockProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const insets = usePanelInsets(rootRef);
  const [height, setHeight] = useState(loadHeight);
  const [maximized, setMaximized] = useState(false);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  const [recentNodes, setRecentNodes] = useState<string[]>([]);

  useEffect(() => {
    writeStored(HEIGHT_KEY, String(height));
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

  // Agent terminals are always hosted here, but with placement "here" they are shown in the AI agents tab
  // instead of the strip below, so the dock only lists (and only appears for) everything else.
  const { placement } = useAgentSurface();
  const agentTabs = tabs.filter((tab) => tab.kind === "agent");
  const agentIds = agentTabs.map((tab) => tab.node).join(",");
  useEffect(() => {
    setRunningAgents(agentIds ? agentIds.split(",") : []);
    return () => setRunningAgents([]);
  }, [agentIds]);
  const hosts = (
    <Suspense fallback={null}>
      {agentTabs.map((tab) => (
        <TerminalHost key={tab.key} holderKey={`${sessionId}:${tab.key}`}>
          <AgentTerminal agentId={tab.node} sessionId={sessionId} onClose={() => onClose(tab.key)} />
        </TerminalHost>
      ))}
    </Suspense>
  );
  const dockTabs = placement === "here" ? tabs.filter((tab) => tab.kind !== "agent") : tabs;
  const dockActiveKey = dockTabs.some((tab) => tab.key === activeKey) ? activeKey : (dockTabs[0]?.key ?? null);
  const activeTab = dockTabs.find((tab) => tab.key === dockActiveKey) ?? null;
  const recentOutsideTabs = recentNodes.filter((node) => !tabs.some((tab) => tab.kind === "shell" && tab.node === node));
  let dockHeight: number | string = "auto";
  if (open) dockHeight = maximized ? "100%" : height;

  // Always the same element tree: returning `hosts` alone while no dock tab is open would remount (and so
  // kill) every agent terminal the moment a normal terminal opens or closes.
  return (
    <>
    {hosts}
    {dockTabs.length > 0 && <Box
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
          height: dockHeight,
          borderTop: 1,
          borderColor: "divider",
          overflow: "hidden"
        }}
      >
        {open && !maximized && (
          <Box onPointerDown={startResize} sx={{ height: 5, flexShrink: 0, cursor: "ns-resize", "&:hover": { bgcolor: "action.hover" } }} />
        )}

        <SessionDockHeader
          tabs={dockTabs}
          activeTab={activeTab}
          open={open}
          maximized={maximized}
          onSelect={onSelect}
          onClose={onClose}
          onToggleOpen={onToggleOpen}
          onOpenShell={onOpenShell}
          onOpenMulti={onOpenMulti}
          onNewTerminal={onNewTerminal}
          onPopOut={onPopOut}
          historyAnchor={historyAnchor}
          setHistoryAnchor={setHistoryAnchor}
          recentOutsideTabs={recentOutsideTabs}
          setRecentNodes={setRecentNodes}
          setMaximized={setMaximized}
        />

        {/* Collapsing shrinks this to zero height instead of unmounting so
            shells and log streams keep their connections. */}
        <SessionDockPanels tabs={dockTabs} sessionId={sessionId} activeKey={dockActiveKey} open={open} onClose={onClose} />
      </Paper>
    </Box>}
    </>
  );
}
