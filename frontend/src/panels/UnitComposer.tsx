import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, IconButton, MenuItem, Select, TextField, Tooltip, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import BoltIcon from "@mui/icons-material/Bolt";

import { DynamicList, PanelAddSection } from "@srl-labs/clab-ui";
import { getApiBase } from "../api/endpoint";
import { UnitPreview } from "../components/UnitPreview";
import type { UnitInfo } from "./units-dock/types";
import type { IncludeRow } from "../components/dialogs/create-group-template/types";
import { unitsIncluding } from "../components/dialogs/create-group-template/helpers";
import { buildEndpointOptions, type EndpointOption } from "./unit-composer/endpoints";

interface ConnRow {
  a: string;
  b: string;
}

interface UnitComposerProps {
  sessionId: string;
  /** yaml path of the unit currently open on the canvas. */
  unitPath: string;
  /** Bumps when the active tab changes, so the panel reloads. */
  refreshKey?: unknown;
  onSaved: () => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

function IncludesSection({ includes, includableUnits, mutateIncludes }: {
  includes: IncludeRow[];
  includableUnits: UnitInfo[];
  mutateIncludes: (v: IncludeRow[]) => void;
}) {
  return (
    <PanelAddSection
      title="Contents"
      addDisabled={includableUnits.length === 0}
      addTitle={includableUnits.length === 0 ? "No other units to include yet" : undefined}
      onAdd={() => mutateIncludes([...includes, { template: includableUnits[0]?.name ?? "", count: 1 }])}
    >
      {includes.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Build this unit from others — a room = 4 × workplace, a building = 3 × room.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {includes.map((row, idx) => (
            <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TextField
                type="number"
                size="small"
                value={row.count}
                onChange={(e) => {
                  const next = [...includes];
                  next[idx] = { ...row, count: Math.max(1, Number(e.target.value) || 1) };
                  mutateIncludes(next);
                }}
                inputProps={{ min: 1, "aria-label": "Count" }}
                sx={{ width: 68 }}
              />
              <Typography variant="body2" color="text.secondary">
                ×
              </Typography>
              <Select
                size="small"
                value={includableUnits.some((u) => u.name === row.template) ? row.template : ""}
                displayEmpty
                onChange={(e) => {
                  const next = [...includes];
                  next[idx] = { ...row, template: String(e.target.value) };
                  mutateIncludes(next);
                }}
                sx={{ flex: 1, minWidth: 0 }}
              >
                <MenuItem value="" disabled>
                  <em>Pick a unit…</em>
                </MenuItem>
                {includableUnits.map((u) => (
                  <MenuItem key={u.name} value={u.name}>
                    {u.name}
                  </MenuItem>
                ))}
              </Select>
              <IconButton size="small" aria-label="Remove" onClick={() => mutateIncludes(includes.filter((_, i) => i !== idx))}>
                <DeleteIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </PanelAddSection>
  );
}

function ConnectionsSection({ connections, endpointOptions, scalingCount, mutateConnections }: {
  connections: ConnRow[];
  endpointOptions: EndpointOption[];
  scalingCount: number;
  mutateConnections: (v: ConnRow[]) => void;
}) {
  return (
    <PanelAddSection
      title="Connections"
      addDisabled={endpointOptions.length < 2}
      addTitle={endpointOptions.length < 2 ? "Add devices or include a unit first" : undefined}
      onAdd={() =>
        mutateConnections([
          ...connections,
          { a: endpointOptions[0]?.value ?? "", b: endpointOptions.find((o) => o.scaling)?.value ?? endpointOptions[1]?.value ?? "" }
        ])
      }
    >
      {endpointOptions.length < 2 ? (
        <Typography variant="caption" color="text.secondary">
          Add own devices on the canvas or include a unit above, then wire them together here.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {connections.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              Wire a device to “each ×” an included unit and the link scales with the count.
            </Typography>
          )}
          {connections.map((row, idx) => (
            <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <EndpointSelect
                value={row.a}
                options={endpointOptions}
                onChange={(v) => {
                  const next = [...connections];
                  next[idx] = { ...row, a: v };
                  mutateConnections(next);
                }}
              />
              <Typography variant="body2" color="text.secondary">
                ↔
              </Typography>
              <EndpointSelect
                value={row.b}
                options={endpointOptions}
                onChange={(v) => {
                  const next = [...connections];
                  next[idx] = { ...row, b: v };
                  mutateConnections(next);
                }}
              />
              <IconButton size="small" aria-label="Remove connection" onClick={() => mutateConnections(connections.filter((_, i) => i !== idx))}>
                <DeleteIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ))}
          {scalingCount > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
              <BoltIcon sx={{ fontSize: 15, color: "primary.main" }} />
              <Typography variant="caption" color="text.secondary">
                {scalingCount} connection{scalingCount === 1 ? "" : "s"} scale with the counts above.
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </PanelAddSection>
  );
}

function PortsSection({ ownNodes, ports, mutatePorts }: {
  ownNodes: string[];
  ports: string[];
  mutatePorts: (v: string[]) => void;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ display: "block", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "text.secondary" }}>
        Exposed ports
      </Typography>
      {ownNodes.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          Add own devices on the canvas to expose them as connection points for parent units.
        </Typography>
      ) : (
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
            The nodes a parent may wire to. None selected = all are available.
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {ownNodes.map((node) => {
              const on = ports.includes(node);
              return (
                <Chip
                  key={node}
                  label={node}
                  size="small"
                  color={on ? "primary" : "default"}
                  variant={on ? "filled" : "outlined"}
                  onClick={() => mutatePorts(on ? ports.filter((p) => p !== node) : [...ports, node])}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ModulesFeatureSection({ modules, mutateModules }: { modules: string[]; mutateModules: (v: string[]) => void }) {
  return (
    <PanelAddSection title="Features (modules)" onAdd={() => mutateModules([...modules, ""])}>
      {modules.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Netlab modules every instance enables (bgp, ospf, vlan, …).
        </Typography>
      ) : (
        <DynamicList items={modules} onChange={mutateModules} placeholder="e.g. bgp, ospf, vlan" hideAddButton />
      )}
    </PanelAddSection>
  );
}

function ComposerBody({
  unit, loading, previewUnit, unitsByName, includes, includableUnits, mutateIncludes,
  connections, endpointOptions, scalingCount, mutateConnections,
  ownNodes, ports, mutatePorts, modules, mutateModules
}: {
  unit: UnitInfo | undefined;
  loading: boolean;
  previewUnit: UnitInfo | null;
  unitsByName: Record<string, UnitInfo>;
  includes: IncludeRow[];
  includableUnits: UnitInfo[];
  mutateIncludes: (v: IncludeRow[]) => void;
  connections: ConnRow[];
  endpointOptions: EndpointOption[];
  scalingCount: number;
  mutateConnections: (v: ConnRow[]) => void;
  ownNodes: string[];
  ports: string[];
  mutatePorts: (v: string[]) => void;
  modules: string[];
  mutateModules: (v: string[]) => void;
}) {
  if (loading && !unit) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (!unit) {
    return (
      <Typography variant="body2" color="text.secondary">
        This unit isn’t in the library yet. Reload once it has been saved.
      </Typography>
    );
  }
  return (
    <>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "action.hover", display: "grid", placeItems: "center", py: 1 }}>
        {previewUnit && <UnitPreview unit={previewUnit} unitsByName={unitsByName} width={296} height={112} />}
      </Box>

      <IncludesSection includes={includes} includableUnits={includableUnits} mutateIncludes={mutateIncludes} />
      <ConnectionsSection connections={connections} endpointOptions={endpointOptions} scalingCount={scalingCount} mutateConnections={mutateConnections} />
      <PortsSection ownNodes={ownNodes} ports={ports} mutatePorts={mutatePorts} />
      <ModulesFeatureSection modules={modules} mutateModules={mutateModules} />
    </>
  );
}

/** A tab in clab-ui's native right-hand palette (alongside Nodes / Groups /
 * Plugins / …), shown only while a unit is open on the canvas. The canvas
 * owns the unit's own devices, links and layout; this tab owns everything the
 * canvas can't draw — the units it's *made of*, the connections into them
 * (including ones that scale with the count), the ports it exposes, and its
 * modules. Living inside the same drawer (instead of a second floating panel)
 * means it never fights the palette for screen space. */
export function UnitComposer({ sessionId, unitPath, refreshKey, onSaved, onToast }: UnitComposerProps) {
  const BASE = getApiBase();
  const [units, setUnits] = useState<UnitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [includes, setIncludes] = useState<IncludeRow[]>([]);
  const [connections, setConnections] = useState<ConnRow[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [ports, setPorts] = useState<string[]>([]);

  const unit = useMemo(() => units.find((u) => u.path === unitPath), [units, unitPath]);
  const unitsByName = useMemo(() => Object.fromEntries(units.map((u) => [u.name, u])), [units]);
  const ownNodes = useMemo(() => (unit?.nodes || []).map((n) => n.name), [unit]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/topology/templates?sessionId=${sessionId}`);
      const data = res.ok ? await res.json() : { templates: [] };
      setUnits((data.templates || []) as UnitInfo[]);
    } catch {
      setUnits([]);
    } finally {
      setLoading(false);
    }
  }, [BASE, sessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Adopt the loaded unit into editable state when the unit identity or version
  // changes — but never clobber unsaved edits to the *same* unit.
  const syncSigRef = useRef<string>("");
  const pathRef = useRef<string>("");
  useEffect(() => {
    if (!unit) return;
    const sig = `${unit.path}#${unit.version ?? 0}`;
    const samePath = unit.path === pathRef.current;
    if (sig === syncSigRef.current) return;
    if (dirty && samePath) return;
    syncSigRef.current = sig;
    pathRef.current = unit.path;
    setIncludes((unit.includes || []).map((i) => ({ template: i.template, count: Math.max(1, Number(i.count) || 1) })));
    setConnections(
      (unit.links || [])
        .filter((l) => (l.endpoints || []).some((e) => typeof e === "string" && e.includes(".")))
        .map((l) => ({ a: l.endpoints?.[0] ?? "", b: l.endpoints?.[1] ?? "" }))
    );
    setModules([...(unit.module || [])]);
    setPorts([...(unit.ports || [])]);
    setDirty(false);
  }, [unit, dirty]);

  // Units that can be included without forming a cycle.
  const includableUnits = useMemo(() => {
    if (!unit) return [] as UnitInfo[];
    const cyclic = unitsIncluding(unit.name, units);
    return units.filter((u) => u.name !== unit.name && !cyclic.has(u.name));
  }, [units, unit]);

  const endpointOptions = useMemo(
    () => buildEndpointOptions(ownNodes, includes, unitsByName),
    [ownNodes, includes, unitsByName]
  );
  const scalingValues = useMemo(
    () => new Set(endpointOptions.filter((o) => o.scaling).map((o) => o.value)),
    [endpointOptions]
  );

  // A faithful miniature of the unit as currently composed (frames per include).
  const previewUnit = useMemo<UnitInfo | null>(
    () => (unit ? { ...unit, includes: includes.map((i) => ({ ...i })), module: modules } : null),
    [unit, includes, modules]
  );

  const mutate = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const save = async () => {
    if (!unit) return;
    setSaving(true);
    try {
      const body = {
        sessionId,
        includes: includes.filter((i) => i.template).map((i) => ({ template: i.template, count: Math.max(1, i.count) })),
        module: modules.filter((m) => m.trim() !== ""),
        ports: ports.filter((p) => ownNodes.includes(p)),
        links: connections
          .filter((c) => c.a && c.b && c.a !== c.b)
          .map((c) => ({ endpoints: [c.a, c.b], attrs: {} }))
      };
      const res = await fetch(
        `${BASE}/api/topology/templates/${encodeURIComponent(unit.name)}/composition?sessionId=${sessionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to save composition");
      setDirty(false);
      onToast(`Updated ${unit.name}`, "success");
      onSaved();
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const scalingCount = connections.filter((c) => scalingValues.has(c.a) || scalingValues.has(c.b)).length;

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.25, height: "100%", minHeight: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
            {unit?.name ?? "Unit"}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            What this unit is made of, wired to, and enables.
          </Typography>
        </Box>
        <Tooltip title="Reload from disk" arrow>
          <span>
            <IconButton size="small" onClick={() => void load()} disabled={loading} aria-label="Reload composer">
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1.5 }}>
        <ComposerBody
          unit={unit}
          loading={loading}
          previewUnit={previewUnit}
          unitsByName={unitsByName}
          includes={includes}
          includableUnits={includableUnits}
          mutateIncludes={mutate(setIncludes)}
          connections={connections}
          endpointOptions={endpointOptions}
          scalingCount={scalingCount}
          mutateConnections={mutate(setConnections)}
          ownNodes={ownNodes}
          ports={ports}
          mutatePorts={mutate(setPorts)}
          modules={modules}
          mutateModules={mutate(setModules)}
        />
      </Box>

      <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
        <Typography variant="caption" color={dirty ? "warning.main" : "text.secondary"} sx={{ flex: 1 }}>
          {dirty ? "Unsaved changes" : "Up to date"}
        </Typography>
        <Button size="small" variant="contained" onClick={() => void save()} disabled={saving || !dirty || !unit}>
          {saving ? "Saving…" : "Save composition"}
        </Button>
      </Box>
    </Box>
  );
}

/** Endpoint picker that groups options and flags the scaling ("each ×") ones. */
function EndpointSelect({
  value,
  options,
  onChange
}: {
  value: string;
  options: EndpointOption[];
  onChange: (value: string) => void;
}) {
  // Render grouped: a disabled heading per group, then its options.
  const groups = useMemo(() => {
    const map = new Map<string, EndpointOption[]>();
    for (const o of options) {
      const arr = map.get(o.group) ?? [];
      arr.push(o);
      map.set(o.group, arr);
    }
    return [...map.entries()];
  }, [options]);

  const known = options.some((o) => o.value === value);

  return (
    <Select
      size="small"
      value={known ? value : ""}
      displayEmpty
      onChange={(e) => onChange(String(e.target.value))}
      sx={{ flex: 1, minWidth: 0, "& .MuiSelect-select": { py: 0.6 } }}
      renderValue={(v) => (v ? options.find((o) => o.value === v)?.label ?? String(v) : <em>Endpoint…</em>)}
    >
      <MenuItem value="" disabled>
        <em>Endpoint…</em>
      </MenuItem>
      {groups.flatMap(([group, opts]) => [
        <MenuItem key={`h-${group}`} disabled sx={{ opacity: 0.7, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.4 }}>
          {group}
        </MenuItem>,
        ...opts.map((o) => (
          <MenuItem key={o.value} value={o.value} sx={{ pl: 2.5 }}>
            {o.scaling && <BoltIcon sx={{ fontSize: 14, mr: 0.5, color: "primary.main" }} />}
            {o.label}
          </MenuItem>
        ))
      ])}
    </Select>
  );
}
