import { useState } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

import { HttpError, api, type AssistantProposal } from "../../api/client";
import { ProposalDiffView } from "../../components/ProposalDiffView";

/**
 * A change the assistant wants to make, shown as a diff with Apply/Reject.
 *
 * This is the only way an assistant edit reaches disk — the backend stages the
 * change and applies it here, through the same undoable command path the
 * canvas uses.
 */
export function ProposalCard({
  proposal,
  onResolved,
  onApplied,
}: {
  proposal: AssistantProposal;
  onResolved: (status: AssistantProposal["status"]) => void;
  onApplied: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (action: "apply" | "reject") => {
    setWorking(true);
    setError(null);
    try {
      if (action === "apply") {
        const result = await api.applyAssistantProposal(proposal.id);
        if (!result.ok) throw new Error(result.error ?? "could not apply the change");
        onResolved("applied");
        onApplied();
      } else {
        await api.rejectAssistantProposal(proposal.id);
        onResolved("rejected");
      }
    } catch (err) {
      // 409 means the backend refused a diff computed against an older
      // revision — the topology moved on since the user was shown this.
      if (err instanceof HttpError && err.status === 409) {
        onResolved("stale");
        setError("The topology changed since this was proposed — ask for an updated version.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setWorking(false);
    }
  };

  const pending = proposal.status === "pending";

  return (
    <Box sx={{ border: 1, borderColor: pending ? "primary.main" : "divider", borderRadius: 1, p: 1.25 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {proposal.summary || "Proposed change"}
        </Typography>
        {!pending && (
          <Chip
            size="small"
            label={proposal.status}
            color={proposal.status === "applied" ? "success" : "default"}
          />
        )}
      </Stack>

      {proposal.rationale && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
          {proposal.rationale}
        </Typography>
      )}

      {proposal.kind === "edit" ? (
        <ProposalDiffView diff={proposal.diff} />
      ) : (
        <Box component="pre" sx={{ m: 0, p: 1, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.75rem" }}>
          {JSON.stringify(proposal.action, null, 2)}
        </Box>
      )}

      {error && (
        <Alert severity="warning" sx={{ mt: 0.75 }}>
          {error}
        </Alert>
      )}

      {pending && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 0.75 }}>
          <Button size="small" startIcon={<CloseIcon />} disabled={working} onClick={() => void resolve("reject")}>
            Reject
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<CheckIcon />}
            disabled={working}
            onClick={() => void resolve("apply")}
          >
            Apply
          </Button>
        </Stack>
      )}
    </Box>
  );
}
