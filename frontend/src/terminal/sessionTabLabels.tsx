import AccountTreeIcon from "@mui/icons-material/AccountTree";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import SubjectIcon from "@mui/icons-material/Subject";
import TerminalIcon from "@mui/icons-material/Terminal";

import { agentName } from "../components/agents/agentNames";
import type { SessionTab } from "../hooks/useSessionDock";

/** Icon, label and close-button label for a session dock tab. */
export function tabIcon(kind: SessionTab["kind"]) {
  if (kind === "shell") return <TerminalIcon sx={{ fontSize: 14 }} />;
  if (kind === "drawio") return <AccountTreeIcon sx={{ fontSize: 14 }} />;
  if (kind === "multi") return <DynamicFeedIcon sx={{ fontSize: 14 }} />;
  if (kind === "agent") return <SmartToyOutlinedIcon sx={{ fontSize: 14 }} />;
  return <SubjectIcon sx={{ fontSize: 14 }} />;
}

export function tabLabel(tab: SessionTab): string {
  if (tab.kind === "multi") return "run on nodes";
  if (tab.kind === "agent") return agentName(tab.node);
  return tab.kind === "drawio" ? "draw.io wizard" : tab.node;
}

export function tabCloseLabel(tab: SessionTab): string {
  if (tab.kind === "drawio") return "Close draw.io wizard";
  if (tab.kind === "multi") return "Close run on nodes";
  if (tab.kind === "agent") return `Close ${agentName(tab.node)}`;
  return `Close ${tab.node} ${tab.kind === "shell" ? "terminal" : "logs"}`;
}
