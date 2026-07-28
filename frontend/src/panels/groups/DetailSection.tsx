import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

export function StatPill({
  icon,
  label,
  empty
}: {
  icon: ReactNode;
  label: string;
  empty?: boolean;
}) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.4,
        px: 0.75,
        py: 0.15,
        borderRadius: 1,
        bgcolor: empty ? "transparent" : "action.hover",
        border: "1px solid",
        borderColor: empty ? "transparent" : "divider",
        color: empty ? "text.disabled" : "text.secondary",
        fontSize: "0.7rem",
        lineHeight: 1.6,
        whiteSpace: "nowrap"
      }}
    >
      <Box component="span" sx={{ display: "inline-flex", opacity: 0.8, "& > svg": { fontSize: 13 } }}>
        {icon}
      </Box>
      {label}
    </Box>
  );
}

export function DetailSection({
  icon,
  title,
  count,
  emptyHint,
  children
}: {
  icon: ReactNode;
  title: string;
  count: number;
  emptyHint: string;
  children?: ReactNode;
}) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
        <Box sx={{ display: "flex", color: "text.secondary", "& > svg": { fontSize: 15 } }}>{icon}</Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase", color: "text.secondary" }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600 }}>
          {count}
        </Typography>
      </Stack>
      {count === 0 ? (
        <Typography variant="caption" color="text.disabled" sx={{ display: "block", pl: 0.25 }}>
          {emptyHint}
        </Typography>
      ) : (
        children
      )}
    </Box>
  );
}
