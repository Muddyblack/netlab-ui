import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ComputerIcon from "@mui/icons-material/Computer";
import DynamicFeedIcon from "@mui/icons-material/DynamicFeed";
import SubjectIcon from "@mui/icons-material/Subject";
import TerminalIcon from "@mui/icons-material/Terminal";

import { AgentIcon } from "../components/agents/AgentIcon";
import { agentBase, agentName } from "../components/agents/agentNames";
import type { SessionTab } from "../hooks/useSessionDock";

/** Icon, label and close-button label for a session dock tab. */
export function tabIcon({ kind, node }: Pick<SessionTab, "kind" | "node">) {
  if (kind === "shell") return <TerminalIcon sx={{ fontSize: 14 }} />;
  if (kind === "terminal") return <ComputerIcon sx={{ fontSize: 14 }} />;
  if (kind === "drawio") return <AccountTreeIcon sx={{ fontSize: 14 }} />;
  if (kind === "multi") return <DynamicFeedIcon sx={{ fontSize: 14 }} />;
  if (kind === "agent") return <AgentIcon id={agentBase(node)} size={14} />;
  return <SubjectIcon sx={{ fontSize: 14 }} />;
}

export function tabLabel(tab: SessionTab): string {
  if (tab.kind === "multi") return "run on nodes";
  if (tab.kind === "agent") return agentName(tab.node);
  if (tab.kind === "terminal") return tab.node === "1" ? "terminal" : `terminal ${tab.node}`;
  return tab.kind === "drawio" ? "draw.io wizard" : tab.node;
}

export function tabCloseLabel(tab: SessionTab): string {
  if (tab.kind === "drawio") return "Close draw.io wizard";
  if (tab.kind === "multi") return "Close run on nodes";
  if (tab.kind === "agent") return `Close ${agentName(tab.node)}`;
  if (tab.kind === "terminal") return `Close ${tabLabel(tab)}`;
  return `Close ${tab.node} ${tab.kind === "shell" ? "terminal" : "logs"}`;
}
