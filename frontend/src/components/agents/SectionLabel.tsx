import { Typography } from "@mui/material";

/** A small uppercase heading over a group in the AI agents panel. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" sx={{ display: "block", mb: 0.75, color: "text.secondary", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
      {children}
    </Typography>
  );
}
