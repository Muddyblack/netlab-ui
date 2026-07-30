import { Typography } from "@mui/material";

interface PluginCatalogStatusProps {
  error: string | null;
  debug: string | null;
  totalCount: number;
  filteredCount: number;
  customCount: number;
  searchActive: boolean;
}

export function PluginCatalogStatus({ error, debug, totalCount, filteredCount, customCount, searchActive }: PluginCatalogStatusProps) {
  return (
    <>
      {!error && totalCount > 0 && (
        <Typography variant="caption" sx={{ color: "text.secondary", px: 0.25 }}>
          {searchActive ? `${filteredCount} of ${totalCount} available plugins` : `${totalCount} available plugins`}
          {customCount > 0 && !searchActive && ` · ${customCount} custom`}
        </Typography>
      )}

      {error && (
        <Typography variant="body2" sx={{ color: "error.main", fontSize: "0.8rem" }}>
          Failed to load plugin catalog: {error}
        </Typography>
      )}

      {debug && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {debug}
        </Typography>
      )}
    </>
  );
}
