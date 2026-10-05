import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { Box } from "@mui/material";

// One SVG per agent in src/assets/agents/, named after the agent's id in the backend's harness
// table (services/assistant/harness.py). Adding an agent's icon is adding that file.
const files = import.meta.glob<string>("../../assets/agents/*.svg", { eager: true, query: "?url", import: "default" });
const icons: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split("/").pop()!.replace(/\.svg$/, ""), url])
);

/** The agent's logo, or a generic robot for one without a logo yet. */
export function AgentIcon({ id, size = 18 }: { id: string; size?: number }) {
  const src = icons[id];
  if (!src) return <SmartToyOutlinedIcon sx={{ fontSize: size, flex: "none" }} />;
  return <Box component="img" src={src} alt="" draggable={false} sx={{ width: size, height: size, flex: "none" }} />;
}
