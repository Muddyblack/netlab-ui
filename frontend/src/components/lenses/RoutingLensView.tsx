import { Box, Chip, Paper, Stack, Typography } from "@mui/material";

import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import type { RoutingLayer } from "./LensCanvasOverlay";
import { LensWarnings } from "./LensBanners";

export const ROUTING_LAYERS: RoutingLayer[] = ["bgp", "ospf", "isis", "bfd", "evpn"];

type ControlPlane = NonNullable<NetlabLensesState["bundle"]>["controlPlane"];
type Adjacency = ControlPlane["adjacencies"][number];

interface RoutingLensViewProps {
  controlPlane: ControlPlane;
  routingLayers: RoutingLayer[];
  setRoutingLayers: (updater: (layers: RoutingLayer[]) => RoutingLayer[]) => void;
  selectedAdjacency: Adjacency | undefined;
  onSelectRef: (ref: string) => void;
}

export function RoutingLensView({ controlPlane, routingLayers, setRoutingLayers, selectedAdjacency, onSelectRef }: RoutingLensViewProps) {
  return (
    <Stack spacing={1.25}>
      <LensWarnings
        warnings={controlPlane.warnings}
        noun="control-plane warning"
        emptyText="No control-plane warnings."
        onSelectRef={onSelectRef}
      />
      <Typography variant="overline" color="text.secondary">Control-plane overlays</Typography>
      <Stack direction="row" gap={0.75} flexWrap="wrap">
        {ROUTING_LAYERS.map((layer) => {
          const available = controlPlane.availableLayers.includes(layer);
          const active = routingLayers.includes(layer);
          return (
            <Chip
              key={layer}
              size="small"
              label={layer.toUpperCase()}
              disabled={!available}
              color={active ? "warning" : "default"}
              variant={active ? "filled" : "outlined"}
              onClick={() => available && setRoutingLayers((layers) => (active ? layers.filter((item) => item !== layer) : [...layers, layer]))}
            />
          );
        })}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        iBGP uses dashed paths; eBGP uses solid paths. Each AS, OSPF area, and IS-IS area gets a shaded domain bubble. RR, ABR, and passive state appear as badges.
      </Typography>
      {selectedAdjacency ? (
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Typography variant="subtitle2">{selectedAdjacency.protocol.toUpperCase()} · {selectedAdjacency.sessionType}</Typography>
          <Typography variant="caption" color="text.secondary">{selectedAdjacency.nodeIds.join(" ↔ ")}</Typography>
          {selectedAdjacency.explanation.map((line) => <Typography key={line} variant="body2" sx={{ mt: 1 }}>{line}</Typography>)}
          <Typography variant="overline" display="block" color="text.secondary" sx={{ mt: 1 }}>Resolved settings</Typography>
          <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "action.hover", overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>{selectedAdjacency.resolvedYaml}</Box>
          <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 1 }}>{selectedAdjacency.yamlPaths.map((path) => <Chip key={path} size="small" variant="outlined" label={path} />)}</Stack>
        </Paper>
      ) : <Typography variant="body2" color="text.secondary">Select an overlay path for derived settings and relevant YAML paths.</Typography>}
    </Stack>
  );
}
