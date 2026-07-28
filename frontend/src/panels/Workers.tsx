import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, CircularProgress, Divider, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import HubIcon from "@mui/icons-material/Hub";
import { useTopoViewerStore } from "@srl-labs/clab-ui";

import { api, type MultiserverResult, type WorkerInfo } from "../api/client";
import { blurTrigger } from "../utils/focus";
import { PlacementBanner } from "./workers/PlacementBanner";
import { WorkerCard } from "./workers/WorkerCard";
import { VxlanOverlaySection } from "./workers/VxlanOverlaySection";

interface WorkersPanelProps {
  sessionId: string;
  /** Refresh the canvas after an edit so plugin-driven changes surface. */
  onChanged: () => void;
}

// The plugin requires exactly containerlab and a global VXLAN interface; these
// are surfaced inline rather than buried so the topology is deployable.
const DEFAULT_VXLAN_DEV = "eth0";

export function WorkersPanel({ sessionId, onChanged }: WorkersPanelProps) {
  const [data, setData] = useState<MultiserverResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // clab-ui's shared lifecycle flag: true while netlab create/up/down runs. We
  // reuse it (rather than inventing a "converting" state) so the placement area
  // shows a spinner during generation instead of a misleading "not created yet".
  const isProcessing = useTopoViewerStore((state) => state.isProcessing);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getMultiserver(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // When a create/deploy finishes, the generated worker dirs have (dis)appeared —
  // re-fetch so resolved placement and its status reflect the new reality.
  const prevProcessing = useRef(false);
  useEffect(() => {
    if (prevProcessing.current && !isProcessing) void load();
    prevProcessing.current = isProcessing;
  }, [isProcessing, load]);

  // Every save replaces the whole block, so the panel always sends the current
  // in-memory shape. The backend echoes back the canonical result (including
  // resolved placement), which we adopt as the new source of truth.
  const save = useCallback(
    async (next: MultiserverResult) => {
      setSaving(true);
      setError(null);
      try {
        const echoed = await api.putMultiserver(sessionId, {
          enabled: next.enabled,
          assignment: next.assignment,
          servers: next.servers,
          vxlan: next.vxlan
        });
        setData(echoed);
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [sessionId, onChanged]
  );

  const enable = useCallback(() => {
    if (!data) return;
    void save({
      ...data,
      enabled: true,
      assignment: data.assignment || "explicit",
      vxlan: { ...data.vxlan, dev: data.vxlan.dev || DEFAULT_VXLAN_DEV }
    });
  }, [data, save]);

  const disable = useCallback(() => {
    if (!data) return;
    void save({ ...data, enabled: false });
  }, [data, save]);

  const setAssignment = useCallback(
    (mode: string) => {
      if (!data) return;
      void save({ ...data, assignment: mode });
    },
    [data, save]
  );

  const patchWorker = useCallback(
    (index: number, patch: Partial<WorkerInfo>) => {
      if (!data) return;
      const servers = data.servers.map((w, i) => (i === index ? { ...w, ...patch } : w));
      void save({ ...data, servers });
    },
    [data, save]
  );

  const addWorker = useCallback(() => {
    if (!data) return;
    const existing = new Set(data.servers.map((w) => w.name));
    let n = data.servers.length + 1;
    while (existing.has(`srv${n}`)) n += 1;
    const worker: WorkerInfo = {
      name: `srv${n}`,
      host: "",
      weight: 1,
      vxlan_dev: null,
      members: [],
      groups: [],
      resolvedNodes: []
    };
    void save({ ...data, servers: [...data.servers, worker] });
  }, [data, save]);

  const removeWorker = useCallback(
    (index: number) => {
      if (!data) return;
      void save({ ...data, servers: data.servers.filter((_, i) => i !== index) });
    },
    [data, save]
  );

  const patchVxlan = useCallback(
    (patch: Partial<MultiserverResult["vxlan"]>) => {
      if (!data) return;
      void save({ ...data, vxlan: { ...data.vxlan, ...patch } });
    },
    [data, save]
  );

  // Assignable member/group options for a given worker: all nodes plus all
  // groups. Groups pin their whole membership onto the worker.
  const memberOptions = useMemo(() => data?.nodes ?? [], [data]);
  const groupOptions = useMemo(() => data?.groups ?? [], [data]);

  const autoMode = data?.assignment === "auto";

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  if (!data) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="error">
          {error ?? "Failed to load multiserver configuration"}
        </Typography>
      </Box>
    );
  }

  // ── Not enabled: a single quiet call-to-action ───────────────────────────
  if (!data.enabled) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HubIcon fontSize="small" color="disabled" />
          <Typography variant="subtitle2">Multi-worker deployment</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Split this topology across multiple worker hosts. Nodes are assigned to
          workers and cross-worker links are provisioned over VXLAN. Enabling adds
          the <code>multiserver</code> plugin to the topology.
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<HubIcon />}
          disabled={saving}
          onClick={(e) => {
            blurTrigger(e.currentTarget);
            enable();
          }}
          sx={{ textTransform: "none", py: 0.75 }}
        >
          Enable multi-worker deployment
        </Button>
        {error && (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        )}
      </Box>
    );
  }

  // ── Enabled: assignment + worker cards + VXLAN + legend ───────────────────
  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HubIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">Multi-worker</Typography>
          {saving && <CircularProgress size={12} />}
        </Box>
        <Button
          size="small"
          color="error"
          variant="outlined"
          disabled={saving}
          onClick={disable}
          sx={{ textTransform: "none", fontSize: "0.72rem" }}
        >
          Disable
        </Button>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          Assignment
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={data.assignment}
          onChange={(_, mode) => mode && setAssignment(mode)}
          fullWidth
        >
          <ToggleButton value="explicit" sx={{ textTransform: "none", py: 0.4 }}>
            Explicit
          </ToggleButton>
          <ToggleButton value="auto" sx={{ textTransform: "none", py: 0.4 }}>
            Auto
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {autoMode
            ? "Unpinned nodes are balanced across workers by weight. Groups stay together."
            : "Every node must be pinned to a worker via its members or groups."}
        </Typography>
      </Box>

      <Divider />

      <PlacementBanner
        isProcessing={isProcessing}
        status={data.placementStatus}
        hasWorkers={data.servers.length > 0}
      />

      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}

      {data.servers.map((worker, index) => (
        <WorkerCard
          key={index}
          worker={worker}
          index={index}
          autoMode={autoMode}
          saving={saving}
          defaultVxlanDev={data.vxlan.dev || DEFAULT_VXLAN_DEV}
          memberOptions={memberOptions}
          groupOptions={groupOptions}
          onPatch={patchWorker}
          onRemove={removeWorker}
        />
      ))}

      <Button
        variant="outlined"
        size="small"
        startIcon={<AddIcon />}
        disabled={saving}
        onClick={(e) => {
          blurTrigger(e.currentTarget);
          addWorker();
        }}
        sx={{ textTransform: "none", py: 0.6 }}
      >
        Add worker
      </Button>

      <Divider />

      <VxlanOverlaySection vxlan={data.vxlan} onPatch={patchVxlan} />
    </Box>
  );
}
