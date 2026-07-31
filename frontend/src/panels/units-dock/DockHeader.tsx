import type { RefObject } from "react";
import { Box, Button, IconButton, InputAdornment, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WidgetsIcon from "@mui/icons-material/Widgets";
import { blurTrigger } from "../../utils/focus";

interface DockHeaderProps {
  isLocked: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCount: number;
  onNewUnit: () => void;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  onCollapse: () => void;
}

export function DockHeader({
  isLocked,
  searchQuery,
  onSearchChange,
  selectedCount,
  onNewUnit,
  importInputRef,
  onImportFile,
  onCollapse
}: DockHeaderProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, px: 1.5, pt: 0.75 }}>
      <WidgetsIcon sx={{ fontSize: 16, color: "text.secondary" }} />
      <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
        Units
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
        {isLocked ? "unlock the lab to place units" : "drag onto the canvas to place"}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <TextField
        size="small"
        placeholder="Search units..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        variant="outlined"
        sx={{
          width: 200,
          minWidth: 120,
          flexShrink: 1,
          "& .MuiOutlinedInput-root": {
            fontSize: "0.75rem",
            bgcolor: "action.hover",
            "& fieldset": { borderColor: "divider" },
            "& .MuiOutlinedInput-input": { py: 0.5 }
          }
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            </InputAdornment>
          ),
          endAdornment: searchQuery ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => onSearchChange("")} edge="end" sx={{ color: "text.secondary", p: 0.25 }}>
                <ClearIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </InputAdornment>
          ) : null
        }}
      />
      <Button
        variant="contained"
        size="small"
        startIcon={<AddIcon />}
        onClick={(event) => {
          blurTrigger(event.currentTarget);
          onNewUnit();
        }}
        sx={{ textTransform: "none", py: 0.25, flexShrink: 0 }}
      >
        {selectedCount > 0 ? `Package ${selectedCount} selected` : "New Unit"}
      </Button>
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = "";
        }}
      />
      <Tooltip title="Import a unit (.netlab-unit.json)" arrow>
        <IconButton size="small" onClick={() => importInputRef.current?.click()} aria-label="Import unit" sx={{ flexShrink: 0 }}>
          <FileUploadOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Collapse units dock" arrow>
        <IconButton size="small" onClick={onCollapse} aria-label="Collapse units dock">
          <ExpandMoreIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
