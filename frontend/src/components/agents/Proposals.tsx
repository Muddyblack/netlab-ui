import { useCallback } from "react";
import { Box, Stack } from "@mui/material";
import { ProposalBar } from "./ProposalBar";
import { ProposalCard } from "./ProposalCard";
import { pendingProposals, refreshProposals, useProposals } from "./proposalsStore";
import { SectionLabel } from "./SectionLabel";

/** Changes an agent proposed for this lab and the user has not decided on yet: full cards, or one bar each when
 * the panel is compact (an agent's terminal is showing). */
export function Proposals({ sessionId, onApplied, compact }: { sessionId: string; onApplied: () => void; compact?: boolean }) {
  const { proposals } = useProposals();
  const load = useCallback(() => { void refreshProposals(sessionId); }, [sessionId]);
  const pending = pendingProposals(proposals);
  if (pending.length === 0) return null;
  if (compact) {
    return (
      <Stack spacing={0.5} sx={{ py: 0.5 }}>
        {pending.map((proposal) => <ProposalBar key={proposal.id} proposal={proposal} onApplied={onApplied} />)}
      </Stack>
    );
  }
  return (
    <Box>
      <SectionLabel>Review · {pending.length}</SectionLabel>
      <Stack spacing={1}>
        {pending.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onResolved={load} onApplied={onApplied} />
        ))}
      </Stack>
    </Box>
  );
}
