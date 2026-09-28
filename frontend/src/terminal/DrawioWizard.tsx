import { PtyTerminal } from "./PtyTerminal";

/** clab-io-draw's interactive assign-levels wizard (`containerlab graph
 * --drawio --drawio-args --interactive`) — a full-screen terminal UI, so it
 * can only actually be driven from a real terminal, not a plain HTTP call. */
export function DrawioWizard({ sessionId, onClose }: { sessionId: string; onClose?: () => void }) {
  return (
    <PtyTerminal
      path={`/api/lab/graph/drawio/interactive?sessionId=${encodeURIComponent(sessionId)}`}
      title="draw.io interactive layout — arrow keys/space to assign levels, Enter to confirm"
      onClose={onClose}
    />
  );
}
