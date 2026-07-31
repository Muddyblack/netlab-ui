import { Alert, Button, Chip, Divider, Stack, Typography } from "@mui/material";

import type { DeployDiffResult } from "../../api/client";
import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import { DerivationInspector } from "./DerivationInspector";
import { DiffView } from "../DiffView";

export function shortRef(ref: string): string {
  const [kind, value] = ref.split(":", 2);
  return value ? `${kind} · ${value}` : ref;
}

export function ChangesLensView({ deployDiff }: { deployDiff: DeployDiffResult | null }) {
  return (
    <Stack spacing={1.25}>
      <Typography variant="body2" color="text.secondary">Changes since the last successful deploy baseline.</Typography>
      {deployDiff?.baselineExists ? (
        <>
          <Chip label={deployDiff.changed ? "Deployment changes pending" : "Matches deployed baseline"} color={deployDiff.changed ? "warning" : "success"} />
          <DiffView diff={deployDiff.diff || "No changes"} maxHeight={320} fontSize={11} />
        </>
      ) : <Alert severity="info">Deploy once to establish a comparison baseline.</Alert>}
    </Stack>
  );
}

type DerivationNode = NonNullable<NetlabLensesState["bundle"]>["derivation"]["nodes"][number];

interface PhysicalLensViewProps {
  selectedNode: string | null;
  selectedRef: string | null;
  setSelectedRef: (ref: string | null) => void;
  derivationNodes: DerivationNode[];
}

export function PhysicalLensView({ selectedNode, selectedRef, setSelectedRef, derivationNodes }: PhysicalLensViewProps) {
  if (!selectedNode) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a node to inspect how netlab derived its settings — authored vs inherited vs computed.
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2">Selected {shortRef(selectedRef!)}</Typography>
        <Button size="small" onClick={() => setSelectedRef(null)}>Clear</Button>
      </Stack>
      <Divider />
      <DerivationInspector node={derivationNodes.find((item) => item.node === selectedNode)} />
    </Stack>
  );
}

type Segment = NonNullable<NetlabLensesState["bundle"]>["addressing"]["segments"][number];

export function SelectedSegmentSummary({ segment }: { segment: Segment }) {
  return (
    <Stack spacing={0.75}>
      <Divider />
      <Typography variant="overline" color="text.secondary">Selected segment</Typography>
      <Typography variant="body2">{segment.nodeIds.join(" ↔ ")}</Typography>
      <Stack direction="row" gap={0.5} flexWrap="wrap">{Object.entries(segment.prefixes).map(([key, value]) => <Chip key={key} size="small" label={`${key} ${value}`} />)}</Stack>
      <Chip size="small" variant="outlined" label={`${segment.assignmentOrigin} assignment`} />
    </Stack>
  );
}
