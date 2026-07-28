import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useNodes } from "@srl-labs/clab-ui";
import { api } from "../api/client";
import type { LinkKind } from "./netlab-links/types";
import { LINK_KIND_LABEL } from "./netlab-links/types";
import { BridgeTypePicker, type BridgeType } from "./netlab-links/BridgeTypePicker";
import { LinkActionsList } from "./netlab-links/LinkActionsList";
import { AddLinkDialog } from "./netlab-links/AddLinkDialog";
import { DEMO_MODE } from "../lifecycle/types";

interface NetlabLinksProps {
  sessionId: string;
  onChanged: () => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

function nodeNamesFromModel(model: Record<string, unknown>): string[] {
  const nodes = model.nodes;
  if (Array.isArray(nodes)) {
    return nodes.flatMap((entry) => typeof entry === "string" ? [entry] : []);
  }
  if (nodes && typeof nodes === "object") return Object.keys(nodes);
  return [];
}

function bridgeTypeFromModel(model: Record<string, unknown>): BridgeType {
  const defaults = model.defaults;
  if (!defaults || typeof defaults !== "object") return "bridge";
  const providers = (defaults as Record<string, unknown>).providers;
  if (!providers || typeof providers !== "object") return "bridge";
  const clab = (providers as Record<string, unknown>).clab;
  if (!clab || typeof clab !== "object") return "bridge";
  return (clab as Record<string, unknown>).bridge_type === "ovs-bridge" ? "ovs-bridge" : "bridge";
}

export function NetlabLinks({ sessionId, onChanged, onToast }: NetlabLinksProps) {
  const canvasNodes = useNodes();
  const canvasNodeNames = useMemo(
    () => canvasNodes.filter((node) => node.type === "topology-node").map((node) => node.id),
    [canvasNodes]
  );
  const selectedNodeNames = useMemo(
    () => canvasNodes.filter((node) => node.selected && node.type === "topology-node").map((node) => node.id),
    [canvasNodes]
  );
  const [modelNodeNames, setModelNodeNames] = useState<string[]>([]);
  const nodeNames = useMemo(
    () => Array.from(new Set([...modelNodeNames, ...canvasNodeNames])).sort((a, b) => a.localeCompare(b)),
    [canvasNodeNames, modelNodeNames]
  );
  const [bridgeType, setBridgeType] = useState<BridgeType>("bridge");
  const [dialogKind, setDialogKind] = useState<LinkKind | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [bridge, setBridge] = useState("");
  const [hostInterface, setHostInterface] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (DEMO_MODE) {
      setModelNodeNames([]);
      setBridgeType("bridge");
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const model = await api.getModel(sessionId);
      setModelNodeNames(nodeNamesFromModel(model));
      setBridgeType(bridgeTypeFromModel(model));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  const openDialog = (kind: LinkKind) => {
    const maximum = kind === "lan" ? selectedNodeNames.length : Math.min(selectedNodeNames.length, 1);
    setSelected(selectedNodeNames.slice(0, maximum));
    setName("");
    setBridge("");
    setHostInterface("");
    setError(null);
    setDialogKind(kind);
  };

  const saveLink = async () => {
    if (!dialogKind) return;
    if (DEMO_MODE) {
      setError("Netlab link authoring requires a running netlab-ui backend.");
      return;
    }
    setSaving(true);
    try {
      await api.addNetlabLink(sessionId, {
        kind: dialogKind,
        nodes: selected,
        name,
        bridge,
        hostInterface,
      });
      setDialogKind(null);
      const label = LINK_KIND_LABEL[dialogKind];
      onToast(`${label.charAt(0).toUpperCase()}${label.slice(1)} added`, "success");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveBridgeType = async (next: BridgeType) => {
    if (DEMO_MODE) {
      setError("Bridge type changes require a running netlab-ui backend.");
      return;
    }
    const previous = bridgeType;
    setBridgeType(next);
    setSaving(true);
    try {
      await api.addNetlabLink(sessionId, { kind: "bridge-type", bridgeType: next });
      onToast(next === "ovs-bridge" ? "LANs will use Open vSwitch bridges" : "LANs will use Linux bridges", "success");
      onChanged();
    } catch (err) {
      setBridgeType(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const minimum = dialogKind === "lan" ? 2 : 1;
  const selectionValid = selected.length >= minimum && (dialogKind === "lan" || selected.length === 1);
  const canSave = selectionValid && (dialogKind !== "uplink" || hostInterface.trim().length > 0);

  let listView: "loading" | "empty" | "list" = "list";
  if (loading) listView = "loading";
  else if (nodeNames.length === 0) listView = "empty";

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          borderTop: 1,
          borderBottom: 1,
          borderColor: "divider",
          px: 2,
          py: 1,
        }}
      >
        <Typography variant="subtitle2">Netlab links</Typography>
      </Box>

      <Stack spacing={1.25} sx={{ p: 2 }}>
        {DEMO_MODE && (
          <Alert severity="info" sx={{ py: 0.25 }}>
            Netlab link authoring is disabled in the browser-only demo. Open the app with a backend to edit LAN, stub, uplink, and bridge settings.
          </Alert>
        )}

        {error && !dialogKind && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0.25 }}>
            {error}
          </Alert>
        )}

        <BridgeTypePicker bridgeType={bridgeType} saving={saving} onChange={(next) => void saveBridgeType(next)} />

        {listView === "loading" && (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress size={22} /></Box>
        )}
        {listView === "empty" && (
          <Alert severity="info" sx={{ py: 0.25 }}>Add a node before creating links.</Alert>
        )}
        {listView === "list" && (
          <LinkActionsList selectedNodeCount={selectedNodeNames.length} onSelect={openDialog} />
        )}
      </Stack>

      <AddLinkDialog
        dialogKind={dialogKind}
        nodeNames={nodeNames}
        selected={selected}
        onSelectedChange={setSelected}
        name={name}
        onNameChange={setName}
        bridge={bridge}
        onBridgeChange={setBridge}
        hostInterface={hostInterface}
        onHostInterfaceChange={setHostInterface}
        error={error}
        saving={saving}
        canSave={canSave}
        onClose={() => setDialogKind(null)}
        onSave={() => void saveLink()}
      />
    </Box>
  );
}
