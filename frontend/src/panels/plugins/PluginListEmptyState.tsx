import { Typography } from "@mui/material";

interface PluginListEmptyStateProps {
  error: string | null;
  totalCount: number;
  filteredCount: number;
}

export function PluginListEmptyState({ error, totalCount, filteredCount }: PluginListEmptyStateProps) {
  if (error) return null;
  if (totalCount === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", fontStyle: "italic", textAlign: "center", p: 2 }}>
        No plugins found
      </Typography>
    );
  }
  if (filteredCount === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", fontStyle: "italic", textAlign: "center", p: 2 }}>
        No matching plugins found
      </Typography>
    );
  }
  return null;
}
