import { IconButton, InputAdornment, TextField } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";

interface PluginSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function PluginSearchField({ value, onChange }: PluginSearchFieldProps) {
  return (
    <TextField
      size="small"
      placeholder="Search plugins..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      variant="outlined"
      sx={{
        mb: 0.5,
        "& .MuiOutlinedInput-root": {
          fontSize: "0.8rem",
          bgcolor: "action.hover",
          "& fieldset": { borderColor: "divider" },
        }
      }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={() => onChange("")}
              edge="end"
              sx={{ color: "text.secondary", p: 0.25 }}
            >
              <ClearIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </InputAdornment>
        ) : null
      }}
    />
  );
}
