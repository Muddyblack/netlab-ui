import { useState } from "react";

import { PtyTerminal } from "../../terminal/PtyTerminal";
import { agentBase, agentConnectsItself, agentName } from "./agentNames";
import { readAgentConnect, readAgentSkipPermissions } from "./preferences";

/** The user's own agent CLI, running in the lab's directory on the backend and
 * (unless the panel's "Connect the agent to this lab" switch is off, or it has to be connected by hand)
 * already connected to this lab over MCP. Everything inside the terminal is the vendor's own
 * interface, so it updates with the CLI, not with netlab-ui. */
export function AgentTerminal({ agentId, sessionId, onClose }: { agentId: string; sessionId: string; onClose?: () => void }) {
  // Read once, when the agent starts: changing the switch later must not restart an agent that is running.
  const [connect] = useState(readAgentConnect);
  const [skipPermissions] = useState(readAgentSkipPermissions);
  const name = agentName(agentId);
  let title = name;
  if (!connect) title = `${name}, not connected to the lab`;
  else if (agentConnectsItself(agentId)) title = `${name}, connected to this lab over MCP`;
  if (skipPermissions) title += ", without permission prompts";
  return (
    <PtyTerminal
      path={`/api/assistant/harness/${encodeURIComponent(agentBase(agentId))}/terminal?sessionId=${encodeURIComponent(sessionId)}&mcp=${connect}${skipPermissions ? "&yolo=true" : ""}`}
      title={title}
      onClose={onClose}
    />
  );
}
