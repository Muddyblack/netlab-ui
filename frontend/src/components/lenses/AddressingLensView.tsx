import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Box,
  Button,
  ButtonBase,
  Collapse,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";

import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import type { AddressFamily } from "./LensCanvasOverlay";
import { LensWarnings } from "./LensBanners";

type Addressing = NonNullable<NetlabLensesState["bundle"]>["addressing"];
type AddressAssignment = Addressing["assignments"][number];

// Utilisation stays calm (accent fill, neutral %) until a pool is actually
// filling up — so a page of 0%-used pools doesn't read as a wall of warnings.
function poolTier(utilization: number, exhausted: boolean): { bar: string; emphasize: boolean } {
  if (exhausted || utilization >= 90) return { bar: "#ef4444", emphasize: true };
  if (utilization >= 70) return { bar: "#f59e0b", emphasize: true };
  return { bar: "#3b82f6", emphasize: false };
}

interface AddressingLensViewProps {
  addressing: Addressing;
  family: AddressFamily;
  setFamily: (family: AddressFamily) => void;
  search: string;
  setSearch: (search: string) => void;
  addressResults: AddressAssignment[];
  hiddenAddressPools: string[];
  toggleAddressPool: (poolId: string) => void;
  onSelectRef: (ref: string) => void;
}

export function AddressingLensView({
  addressing,
  family,
  setFamily,
  search,
  setSearch,
  addressResults,
  hiddenAddressPools,
  toggleAddressPool,
  onSelectRef,
}: AddressingLensViewProps) {
  const [poolsOpen, setPoolsOpen] = useState(true);
  const poolsForFamily = addressing.pools.filter((pool) => pool.family === family);

  return (
    <Stack spacing={1.25}>
      <LensWarnings
        warnings={addressing.warnings}
        noun="addressing conflict"
        emptyText="No addressing conflicts found."
        onSelectRef={onSelectRef}
      />
      <ToggleButtonGroup
        exclusive
        size="small"
        value={family}
        onChange={(_event, value) => value && setFamily(value)}
        aria-label="Address family"
        sx={{ alignSelf: "flex-start", "& .MuiToggleButton-root": { px: 1.25, py: 0.4, textTransform: "none", fontWeight: 600 } }}
      >
        {addressing.families.map((value) => <ToggleButton key={value} value={value}>{value.toUpperCase()}</ToggleButton>)}
      </ToggleButtonGroup>
      <TextField
        size="small"
        placeholder="Find IP, prefix, node, pool…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      />
      {addressResults.map((assignment) => (
        <Button key={assignment.id} size="small" variant="text" onClick={() => onSelectRef(`node:${assignment.node}`)} sx={{ justifyContent: "flex-start", textTransform: "none" }}>
          {assignment.address} · {assignment.node} {assignment.interface}
        </Button>
      ))}
      <Box>
        <ButtonBase
          onClick={() => setPoolsOpen((open) => !open)}
          aria-expanded={poolsOpen}
          sx={{ width: "100%", justifyContent: "space-between", borderRadius: 1, px: 0.5, py: 0.25, color: "text.secondary", "&:hover": { bgcolor: "action.hover", color: "text.primary" } }}
        >
          <Typography variant="overline" sx={{ letterSpacing: 0.4 }}>Address pools · {poolsForFamily.length}</Typography>
          <ExpandMoreIcon fontSize="small" sx={{ transition: "transform 160ms ease", transform: poolsOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
        </ButtonBase>
        <Collapse in={poolsOpen}>
          <Stack spacing={0.75} sx={{ mt: 0.5 }}>
            {poolsForFamily.map((pool) => {
              const tier = poolTier(pool.utilization, pool.exhausted);
              const hidden = hiddenAddressPools.includes(pool.id);
              return (
                <Paper key={pool.id} variant="outlined" sx={{ p: 1, borderRadius: 2, opacity: hidden ? 0.55 : 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography variant="body2" fontWeight={600} sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pool.name}</Typography>
                    <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexShrink: 0 }}>
                      <Typography variant="caption" sx={{ fontWeight: tier.emphasize ? 700 : 600, color: tier.emphasize ? tier.bar : "text.secondary" }}>{pool.utilization}%</Typography>
                      <Tooltip title={hidden ? `Show ${pool.name} on canvas` : `Hide ${pool.name} from canvas`}>
                        <IconButton size="small" aria-label={hidden ? `Show ${pool.name}` : `Hide ${pool.name}`} onClick={() => toggleAddressPool(pool.id)} sx={{ p: 0.35 }}>
                          {hidden ? <VisibilityOffIcon sx={{ fontSize: 17 }} /> : <VisibilityIcon sx={{ fontSize: 17 }} />}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{pool.network} · {pool.usedSubnets}/{pool.subnetCapacity} prefixes</Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, pool.utilization)}
                    sx={{ mt: 0.75, height: 6, borderRadius: 3, bgcolor: "action.hover", "& .MuiLinearProgress-bar": { borderRadius: 3, backgroundColor: tier.bar } }}
                  />
                </Paper>
              );
            })}
            {poolsForFamily.length === 0 && <Typography variant="caption" color="text.secondary">No pools for this family.</Typography>}
          </Stack>
        </Collapse>
      </Box>
    </Stack>
  );
}
