import { PtyTerminal } from "./PtyTerminal";

/** A normal terminal in the lab's folder, as the user. Where netlab-ui runs in a container that can reach its
 * host, this is the host's shell, so it is the terminal the user would open themselves. */
export function LocalTerminal({ sessionId, onClose }: { sessionId: string; onClose?: () => void }) {
  return <PtyTerminal path={`/api/shell/local?sessionId=${encodeURIComponent(sessionId)}`} title="Terminal in the lab's folder" onClose={onClose} />;
}
