import type { ReactNode } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Box, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

/** One row of the monitoring setup: a title, the current value at a glance, an optional inline control, and
 * (when there are children) details that open on click. */
export function SetupSection({ title, value, action, children, defaultExpanded }: {
  title: string;
  value?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  defaultExpanded?: boolean;
}) {
  const head = (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Box sx={{ flex: 1 }} />
      {value !== undefined && (
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {value}
        </Typography>
      )}
      {action && (
        <Box onClick={(event) => event.stopPropagation()} sx={{ display: "flex" }}>
          {action}
        </Box>
      )}
    </Stack>
  );
  const frame = { borderBottom: 1, borderColor: "divider" };
  if (!children) return <Box sx={{ ...frame, px: 2, minHeight: 48, display: "flex", alignItems: "center" }}>{head}</Box>;
  return (
    <Accordion
      disableGutters
      square
      elevation={0}
      defaultExpanded={defaultExpanded}
      slotProps={{ transition: { unmountOnExit: false } }}
      sx={{ ...frame, bgcolor: "transparent", "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 2, minHeight: 48 }}>
        {head}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pt: 0.5, pb: 2 }}>{children}</AccordionDetails>
    </Accordion>
  );
}
