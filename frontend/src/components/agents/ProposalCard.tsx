import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

import { type AssistantProposal } from "../../api/client";
import { ProposalDiffView } from "../ProposalDiffView";
import { useResolveProposal } from "./useResolveProposal";

/** Fit the diff box to the change: ~19 px a line, 90–320 px. */
const diffHeight = (diff: string) => Math.min(320, Math.max(90, diff.split("\n").length * 19 + 16));

/**
 * A change an AI agent proposed over MCP, shown as a diff with Apply/Reject.
 *
 * This is the only way an agent's topology edit reaches disk — the backend stages the
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
  const { working, error, resolve } = useResolveProposal(proposal, onApplied, onResolved);

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
        <ProposalDiffView diff={proposal.diff} height={diffHeight(proposal.diff)} />
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
          <Button size="small" variant="text" startIcon={<CloseIcon />} disabled={working} onClick={() => void resolve("reject")}>
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
