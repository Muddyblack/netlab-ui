import { Avatar, Box, Button, Stack, Typography } from "@mui/material";
import CableIcon from "@mui/icons-material/Cable";
import LanIcon from "@mui/icons-material/Lan";
import RouteIcon from "@mui/icons-material/Route";

import type { LinkKind } from "./types";

const LINK_ACTIONS: Array<{
  kind: LinkKind;
  title: string;
  description: string;
  icon: typeof RouteIcon;
}> = [
  {
    kind: "stub",
    title: "Stub link",
    description: "One node, one dead-end interface (netlab makes the endpoint).",
    icon: RouteIcon,
  },
  {
    kind: "lan",
    title: "LAN",
    description: "Two or more nodes on one shared network.",
    icon: LanIcon,
  },
  {
    kind: "uplink",
    title: "External uplink",
    description: "One container node to a host interface, via macvlan.",
    icon: CableIcon,
  },
];

function selectionHintFor(kind: LinkKind, selectedCount: number): string | null {
  if (selectedCount === 0) return null;
  const minimum = kind === "lan" ? 2 : 1;
  return selectedCount >= minimum ? `${selectedCount} selected` : null;
}

interface LinkActionsListProps {
  selectedNodeCount: number;
  onSelect: (kind: LinkKind) => void;
}

export function LinkActionsList({ selectedNodeCount, onSelect }: LinkActionsListProps) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary">
        Beyond node-to-node links. Select nodes on the canvas first to fill them in.
      </Typography>
      {LINK_ACTIONS.map((action) => {
        const Icon = action.icon;
        const selectionHint = selectionHintFor(action.kind, selectedNodeCount);
        return (
          <Button
            key={action.kind}
            color="inherit"
            onClick={() => onSelect(action.kind)}
            sx={{
              justifyContent: "flex-start",
              textAlign: "left",
              textTransform: "none",
              p: 1,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
              color: "text.primary",
              "&:hover": { bgcolor: "action.hover", borderColor: "text.disabled" },
            }}
          >
            <Avatar variant="rounded" sx={{ width: 28, height: 28, mr: 1, bgcolor: "action.selected", color: "text.secondary" }}>
              <Icon sx={{ fontSize: 17 }} />
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{action.title}</Typography>
                {selectionHint && (
                  <Typography
                    variant="caption"
                    sx={{
                      px: 0.55,
                      borderRadius: 1,
                      bgcolor: "action.selected",
                      color: "text.secondary",
                      fontWeight: 600,
                      fontSize: "0.65rem",
                      lineHeight: 1.55,
                      flexShrink: 0,
                    }}
                  >
                    {selectionHint}
                  </Typography>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.35 }}>{action.description}</Typography>
            </Box>
          </Button>
        );
      })}
    </Stack>
  );
}
