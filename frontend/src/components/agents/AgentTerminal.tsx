import { PtyTerminal } from "../../terminal/PtyTerminal";
import { agentName } from "./agentNames";

/** The user's own agent CLI, running in the lab's directory on the backend and
 * already connected to this lab over MCP. Everything inside the terminal is the
 * vendor's own interface, so it updates with the CLI, not with netlab-ui. */
export function AgentTerminal({ agentId, sessionId, onClose }: { agentId: string; sessionId: string; onClose?: () => void }) {
  return (
    <PtyTerminal
      path={`/api/assistant/harness/${encodeURIComponent(agentId)}/terminal?sessionId=${encodeURIComponent(sessionId)}`}
      title={`${agentName(agentId)}, connected to this lab over MCP`}
      onClose={onClose}
    />
  );
}
