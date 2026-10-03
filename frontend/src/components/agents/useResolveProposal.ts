import { useState } from "react";

import { HttpError, api, type AssistantProposal } from "../../api/client";
import { shownGhostPositions } from "./proposalGhost";
import { refreshProposals } from "./proposalsStore";

/**
 * Apply or reject a proposal, with the error handling every place that offers those buttons needs.
 * Used by the review card, the compact bar above the terminal and the chip on the canvas.
 */
export function useResolveProposal(
  proposal: AssistantProposal,
  onApplied: () => void,
  onResolved?: (status: AssistantProposal["status"]) => void,
) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (action: "apply" | "reject") => {
    setWorking(true);
    setError(null);
    try {
      if (action === "apply") {
        const result = await api.applyAssistantProposal(
          proposal.id,
          shownGhostPositions((proposal.changes?.nodesAdded ?? []).map((node) => node.name)),
        );
        if (!result.ok) throw new Error(result.error ?? "could not apply the change");
        onResolved?.("applied");
        onApplied();
      } else {
        await api.rejectAssistantProposal(proposal.id);
        onResolved?.("rejected");
      }
    } catch (err) {
      // 409 means the backend refused a diff computed against an older
      // revision: the topology moved on since the user was shown this.
      if (err instanceof HttpError && err.status === 409) {
        onResolved?.("stale");
        setError("The topology changed since this was proposed. Ask for an updated version.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setWorking(false);
      void refreshProposals(proposal.sessionId);
    }
  };

  return { working, error, resolve };
}
