import { useState } from "react";
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DifferenceIcon from "@mui/icons-material/DifferenceOutlined";

import { type AssistantProposal } from "../../api/client";
import { ProposalDiffView } from "../ProposalDiffView";
import { changeCounts } from "./proposalGhost";
import { useResolveProposal } from "./useResolveProposal";

/**
 * One pending proposal as a single line above the agent's terminal: what it does, Apply / Reject, and a
 * button that opens the full YAML diff. The change itself is drawn on the canvas (ProposalGhostOverlay),
 * so the narrow panel keeps its height for the conversation.
 */
export function ProposalBar({ proposal, onApplied }: { proposal: AssistantProposal; onApplied: () => void }) {
  const { working, error, resolve } = useResolveProposal(proposal, onApplied);
  const [diffOpen, setDiffOpen] = useState(false);
  const counts = changeCounts(proposal);

  return (
    <Box sx={{ border: 1, borderColor: "primary.main", borderRadius: 1, px: 1, py: 0.5 }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={proposal.summary}>
            {proposal.summary || "Proposed change"}
          </Typography>
          {counts && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", lineHeight: 1.2 }}>
              {counts}
              {" · shown on the canvas"}
            </Typography>
          )}
        </Box>
        {proposal.kind === "edit" && (
          <Tooltip title="Show the YAML diff">
            <IconButton size="small" aria-label="Show the YAML diff" onClick={() => setDiffOpen(true)}>
              <DifferenceIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Reject">
          <span>
            <IconButton size="small" aria-label="Reject" disabled={working} onClick={() => void resolve("reject")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" variant="contained" startIcon={<CheckIcon />} disabled={working} onClick={() => void resolve("apply")}>
          Apply
        </Button>
      </Stack>
      {error && <Alert severity="warning" sx={{ mt: 0.5 }}>{error}</Alert>}
      <Dialog open={diffOpen} onClose={() => setDiffOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ pb: 0.5 }}>{proposal.summary || "Proposed change"}</DialogTitle>
        <DialogContent>
          {proposal.rationale && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{proposal.rationale}</Typography>
          )}
          <ProposalDiffView diff={proposal.diff} height={360} />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
