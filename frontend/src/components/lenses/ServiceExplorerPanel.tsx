import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import LayersClearIcon from "@mui/icons-material/LayersClear";
import RouterOutlinedIcon from "@mui/icons-material/RouterOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import type { ServiceExplorerLens, ServiceVlan, ServiceVrf } from "../../api/client";

interface ServiceExplorerPanelProps {
  explorer: ServiceExplorerLens;
  selectedRef: string | null;
  followedServiceRef: string | null;
  onFollow: (ref: string | null) => void;
  onSelectRef: (ref: string) => void;
}

function RouteTargets({ label, targets }: { label: string; targets: string[] }) {
  if (!targets.length) return null;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 42 }}>{label}</Typography>
      {targets.map((rt) => <Chip key={rt} size="small" variant="outlined" label={rt} sx={{ height: 20, fontFamily: "monospace" }} />)}
    </Stack>
  );
}

function NodeChips({ nodes, onSelectRef }: { nodes: string[]; onSelectRef: (ref: string) => void }) {
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {nodes.map((node) => (
        <Chip key={node} size="small" label={node} onClick={() => onSelectRef(`node:${node}`)} sx={{ height: 22, cursor: "pointer" }} />
      ))}
    </Stack>
  );
}

function VlanCard({ vlan, following, onFollow, onSelectRef }: {
  vlan: ServiceVlan;
  following: boolean;
  onFollow: (ref: string | null) => void;
  onSelectRef: (ref: string) => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <LanOutlinedIcon fontSize="small" color="warning" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>VLAN {vlan.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            id {vlan.id ?? "—"}{vlan.vni ? ` · VNI ${vlan.vni}` : ""} · {vlan.mode}
          </Typography>
        </Box>
        <Chip
          size="small"
          color={following ? "warning" : "default"}
          variant={following ? "filled" : "outlined"}
          icon={following ? <CenterFocusStrongIcon /> : undefined}
          label={following ? "Following" : "Follow"}
          onClick={() => onFollow(following ? null : `vlan:${vlan.name}`)}
          sx={{ cursor: "pointer" }}
        />
      </Stack>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        {vlan.mode === "irb" && <Chip size="small" color="info" variant="outlined" label="IRB gateway" sx={{ height: 20, alignSelf: "flex-start" }} />}
        {vlan.prefix && <Typography variant="caption" color="text.secondary">Prefix {vlan.prefix}</Typography>}
        {vlan.vrf && (
          <Typography variant="caption">
            Tenant{" "}
            <Chip size="small" variant="outlined" label={vlan.vrf} onClick={() => onSelectRef(`vrf:${vlan.vrf}`)} sx={{ height: 18, cursor: "pointer" }} />
          </Typography>
        )}
        <NodeChips nodes={vlan.nodeIds} onSelectRef={onSelectRef} />
        {vlan.evpn && (
          <Box sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
            <Typography variant="overline" color="text.secondary">EVPN service</Typography>
            <Typography variant="caption" display="block">EVI {vlan.evpn.evi ?? "—"} · RD {vlan.evpn.rd ?? "—"}</Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              <RouteTargets label="import" targets={vlan.evpn.importTargets} />
              <RouteTargets label="export" targets={vlan.evpn.exportTargets} />
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function VrfCard({ vrf, following, onFollow, onSelectRef }: {
  vrf: ServiceVrf;
  following: boolean;
  onFollow: (ref: string | null) => void;
  onSelectRef: (ref: string) => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <RouterOutlinedIcon fontSize="small" color="warning" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>Tenant {vrf.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            RD {vrf.rd ?? "—"}{vrf.evpnTransitVni ? ` · transit VNI ${vrf.evpnTransitVni}` : ""}
          </Typography>
        </Box>
        <Chip
          size="small"
          color={following ? "warning" : "default"}
          variant={following ? "filled" : "outlined"}
          icon={following ? <CenterFocusStrongIcon /> : undefined}
          label={following ? "Following" : "Follow"}
          onClick={() => onFollow(following ? null : `vrf:${vrf.name}`)}
          sx={{ cursor: "pointer" }}
        />
      </Stack>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <RouteTargets label="import" targets={vrf.importTargets} />
        <RouteTargets label="export" targets={vrf.exportTargets} />
        {vrf.vlans.length > 0 && (
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 42 }}>vlans</Typography>
            {vrf.vlans.map((name) => <Chip key={name} size="small" label={name} onClick={() => onSelectRef(`vlan:${name}`)} sx={{ height: 20, cursor: "pointer" }} />)}
          </Stack>
        )}
        <NodeChips nodes={vrf.nodeIds} onSelectRef={onSelectRef} />
      </Stack>
    </Paper>
  );
}

export function ServiceExplorerPanel({
  explorer,
  selectedRef,
  followedServiceRef,
  onFollow,
  onSelectRef,
}: ServiceExplorerPanelProps) {
  if (!explorer.available) {
    return (
      <Alert severity="info" icon={<HubOutlinedIcon fontSize="small" />}>
        This topology has no VLAN, VRF, VXLAN, or EVPN services. Add a service module to your YAML
        to explore tenants and overlays here.
      </Alert>
    );
  }

  const selectedName = selectedRef?.startsWith("vlan:") || selectedRef?.startsWith("vrf:")
    ? selectedRef.slice(selectedRef.indexOf(":") + 1)
    : null;

  return (
    <Stack spacing={1.25}>
      {followedServiceRef && (
        <Button size="small" variant="outlined" startIcon={<LayersClearIcon />} onClick={() => onFollow(null)} sx={{ alignSelf: "flex-start", textTransform: "none" }}>
          Show all services
        </Button>
      )}

      {explorer.evpn.enabled && (
        <Paper variant="outlined" sx={{ p: 1 }}>
          <Typography variant="overline" color="text.secondary">EVPN overlay</Typography>
          <Typography variant="caption" display="block">
            {explorer.evpn.sessions.join(", ") || "sessions"} · transport {explorer.evpn.transport ?? "device default"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {explorer.evpn.vlans.length} L2 VNI · {explorer.evpn.vrfs.length} L3 VRF
          </Typography>
        </Paper>
      )}

      {explorer.vrfs.length > 0 && (
        <>
          <Typography variant="overline" color="text.secondary">Tenants (VRF)</Typography>
          {explorer.vrfs.map((vrf) => (
            <VrfCard
              key={vrf.name}
              vrf={vrf}
              following={followedServiceRef === `vrf:${vrf.name}` || selectedName === vrf.name}
              onFollow={onFollow}
              onSelectRef={onSelectRef}
            />
          ))}
        </>
      )}

      {explorer.vlans.length > 0 && (
        <>
          <Typography variant="overline" color="text.secondary">VLANs</Typography>
          {explorer.vlans.map((vlan) => (
            <VlanCard
              key={vlan.name}
              vlan={vlan}
              following={followedServiceRef === `vlan:${vlan.name}` || selectedName === vlan.name}
              onFollow={onFollow}
              onSelectRef={onSelectRef}
            />
          ))}
        </>
      )}

      {explorer.vteps.length > 0 && (
        <>
          <Divider />
          <Typography variant="overline" color="text.secondary">VXLAN VTEPs</Typography>
          {explorer.vteps.map((vtep) => (
            <Stack key={vtep.node} direction="row" justifyContent="space-between" alignItems="center">
              <Chip size="small" label={vtep.node} onClick={() => onSelectRef(`node:${vtep.node}`)} sx={{ cursor: "pointer" }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>{vtep.address}</Typography>
            </Stack>
          ))}
        </>
      )}
    </Stack>
  );
}
