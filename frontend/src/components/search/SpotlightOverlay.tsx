import { useEffect, useMemo, useState } from "react";
import { Chip, GlobalStyles, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useEdges } from "@containerlab/clab-ui";

import { api, type LabSearchHit } from "../../api/client";
import { setSpotlight, useSpotlight } from "../../host/canvasSpotlight";

const DIMMED = "netlab-spotlight-dimmed";

/** Dims every node and link outside the spotlight (an edge stays lit when both
 * ends are), and shows what is lit with one-click module filters. Works on
 * the rendered React Flow DOM, like the lens overlays. */
export function SpotlightOverlay({ container, sessionId }: { container: HTMLElement; sessionId: string }) {
  const spotlight = useSpotlight();
  const edges = useEdges();
  const [modules, setModules] = useState<LabSearchHit[]>([]);

  useEffect(() => { setSpotlight(null); }, [sessionId]);

  useEffect(() => {
    if (!spotlight) return;
    let cancelled = false;
    void api.searchLab(sessionId, "").then((result) => { if (!cancelled) setModules(result.modules); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionId, spotlight]);

  const litEdges = useMemo(() => {
    if (!spotlight) return new Set<string>();
    const nodes = new Set(spotlight.nodes);
    return new Set(edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)).map((edge) => edge.id));
  }, [edges, spotlight]);

  useEffect(() => {
    if (!spotlight) return;
    const nodes = new Set(spotlight.nodes);
    const apply = () => {
      frame = 0;
      container.querySelectorAll<HTMLElement>(".react-flow__node[data-id]").forEach((element) => {
        element.classList.toggle(DIMMED, !nodes.has(element.dataset.id ?? ""));
      });
      container.querySelectorAll<HTMLElement>(".react-flow__edge[data-id]").forEach((element) => {
        element.classList.toggle(DIMMED, !litEdges.has(element.dataset.id ?? ""));
      });
    };
    let frame = 0;
    // React Flow re-creates elements on its own schedule; re-apply after it.
    const observer = new MutationObserver(() => { if (!frame) frame = window.requestAnimationFrame(apply); });
    observer.observe(container, { childList: true, subtree: true });
    apply();
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      container.querySelectorAll(`.${DIMMED}`).forEach((element) => element.classList.remove(DIMMED));
    };
  }, [container, spotlight, litEdges]);

  if (!spotlight) return null;
  return (
    <>
      <GlobalStyles styles={{ [`.${DIMMED}`]: { opacity: "0.15 !important", filter: "grayscale(1)", transition: "opacity 160ms ease" } }} />
      <Paper
        elevation={4}
        sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 7, pointerEvents: "auto",
          display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.5, maxWidth: "80%", flexWrap: "wrap" }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{spotlight.label}</Typography>
        <Typography variant="caption" color="text.secondary">{spotlight.nodes.length} node{spotlight.nodes.length === 1 ? "" : "s"}</Typography>
        {modules.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>module:</Typography>}
        {modules.map((module) => {
          const label = `module ${module.title}`;
          return (
            <Chip key={module.title} size="small" label={module.title}
              color={spotlight.label === label ? "primary" : "default"}
              onClick={() => setSpotlight({ label, nodes: module.nodes ?? [] })} />
          );
        })}
        <Tooltip title="Show everything (Esc)">
          <IconButton size="small" aria-label="Clear spotlight" onClick={() => setSpotlight(null)}><CloseIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Paper>
      <EscapeClears />
    </>
  );
}

function EscapeClears() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSpotlight(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
