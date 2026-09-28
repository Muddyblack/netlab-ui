import { useCallback, useEffect, useState } from "react";
import { Box, Button, Chip, Tooltip, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { api } from "../../api/client";
import type { Generator, TopologyPattern } from "../../api/client";
import { GeneratorDialog, type GeneratorSeed } from "./GeneratorDialog";
import { ORIGIN_LABELS } from "./types";

const KIND_LABELS: Record<string, string> = {
  leaf_spine: "leaf-spine",
  clone: "identical nodes",
  full_mesh: "full mesh",
  ring: "ring",
  chain: "chain",
  star: "star",
};

function PatternRow({
  pattern,
  onUse,
}: {
  pattern: TopologyPattern;
  onUse: () => void;
}) {
  const suggestion = pattern.suggestion;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, border: "1px dashed", borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }}>
      <Chip label={KIND_LABELS[pattern.kind] ?? pattern.kind} size="small" color="primary" variant="outlined"
        sx={{ height: 18, fontSize: "0.65rem", flexShrink: 0 }} />
      <Typography variant="caption" sx={{ flexGrow: 1, minWidth: 0, lineHeight: 1.35 }}>
        {pattern.summary}
      </Typography>
      {suggestion ? (
        <Button size="small" onClick={onUse} sx={{ fontSize: "0.7rem", py: 0, flexShrink: 0 }}>
          Use {suggestion.generator}
        </Button>
      ) : (
        <Tooltip title="No installed generator declares this shape. Start one from Add custom plugin → Generator template.">
          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>no generator</Typography>
        </Tooltip>
      )}
    </Box>
  );
}

/**
 * Generators are plugins with a `topology_expand` hook: they build nodes and
 * links from a small parameter block, so scaling a lab is editing a number.
 * This section shows the shapes the lab was drawn with (and which generator
 * could produce them instead) plus every installed generator.
 *
 * `topologyKey` changes whenever the topology does, so detection re-runs.
 */
export function GeneratorsSection({
  sessionId,
  topologyKey,
  onApplied,
}: {
  sessionId: string;
  topologyKey: string;
  onApplied: (message: string) => void;
}) {
  const [generators, setGenerators] = useState<Generator[]>([]);
  const [patterns, setPatterns] = useState<TopologyPattern[]>([]);
  const [active, setActive] = useState<{ generator: Generator; seed: GeneratorSeed | null } | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [gens, found] = await Promise.all([api.getGenerators(sessionId), api.getTopologyPatterns(sessionId)]);
      setGenerators(gens);
      setPatterns(found);
    } catch (err) {
      // The rest of the Plugins panel works without this section.
      console.error("Failed to load generators:", err);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, topologyKey]);

  if (generators.length === 0 && patterns.length === 0) return null;

  const openFor = (pattern: TopologyPattern) => {
    const suggestion = pattern.suggestion;
    const generator = generators.find((g) => g.plugin === suggestion?.generator);
    if (!suggestion || !generator) return;
    setActive({
      generator,
      seed: {
        params: suggestion.params,
        node: suggestion.node,
        replaceNodes: suggestion.replaceNodes,
        notes: suggestion.notes,
      },
    });
  };

  return (
    <Box sx={{ display: "grid", gap: 0.75 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <AutoFixHighIcon sx={{ fontSize: 16, color: "primary.main" }} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
          Generators — scale the lab by editing a number
        </Typography>
      </Box>

      {patterns.map((pattern) => (
        <PatternRow key={`${pattern.kind}:${pattern.nodes.join(",")}`} pattern={pattern} onUse={() => openFor(pattern)} />
      ))}

      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
        {generators.map((generator) => (
          <Tooltip key={generator.plugin} title={generator.description || generator.plugin}>
            <Chip
              label={
                generator.origin === "builtin"
                  ? generator.title
                  : `${generator.title} · ${ORIGIN_LABELS[generator.origin] ?? generator.origin}`
              }
              size="small"
              variant="outlined"
              onClick={() => setActive({ generator, seed: null })}
              sx={{ fontSize: "0.7rem" }}
            />
          </Tooltip>
        ))}
      </Box>

      <GeneratorDialog
        open={active !== null}
        sessionId={sessionId}
        generator={active?.generator ?? null}
        seed={active?.seed ?? null}
        onClose={() => setActive(null)}
        onApplied={(message) => {
          onApplied(message);
          void load();
        }}
      />
    </Box>
  );
}
