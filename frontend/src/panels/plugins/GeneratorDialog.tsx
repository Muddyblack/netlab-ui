import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { api } from "../../api/client";
import type { Generator, GeneratorApplyRequest, GeneratorParam, GeneratorPreview } from "../../api/client";

/** What a detected pattern pre-fills: parameters, the node a node-scoped
 * generator sits on, and the hand-built nodes it replaces. */
export interface GeneratorSeed {
  params?: Record<string, unknown>;
  node?: string | null;
  replaceNodes?: string[];
  notes?: string[];
}

type FieldValue = string | boolean;

function toField(param: GeneratorParam, value: unknown): FieldValue {
  if (value === undefined || value === null) return param.type === "bool" ? false : "";
  if (param.type === "bool") return Boolean(value);
  if (param.type === "dict" || param.type === "list") return JSON.stringify(value);
  return String(value);
}

function parseField(param: GeneratorParam, text: string): unknown {
  if (param.type === "int" || param.type === "float") return Number(text);
  if (param.type === "dict" || param.type === "list") {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${param.name} is not valid JSON`);
    }
  }
  return text;
}

/** Form fields → the params the backend validates. Empty fields are left out
 * so the plugin's own defaults apply. Throws on bad JSON. */
function collectParams(generator: Generator, fields: Record<string, FieldValue>, touched: Set<string>) {
  const params: Record<string, unknown> = {};
  for (const param of generator.params ?? []) {
    const value = fields[param.name];
    if (param.type === "bool") {
      if (touched.has(param.name)) params[param.name] = value;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text !== "") params[param.name] = parseField(param, text);
  }
  return params;
}

function paramHint(param: GeneratorParam): string {
  const range = param.min != null || param.max != null ? `${param.min ?? ""}…${param.max ?? ""}` : "";
  const fallback = param.default != null && param.type !== "bool" ? `default ${JSON.stringify(param.default)}` : "";
  return [param.description, range, fallback].filter(Boolean).join(" · ");
}

function structuredPlaceholder(type: string): string | undefined {
  if (type === "dict") return "{ }  (JSON)";
  if (type === "list") return "[ ]  (JSON)";
  return undefined;
}

interface FieldProps {
  param: GeneratorParam;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}

function ChoiceField({ param, value, onChange }: FieldProps) {
  const hint = paramHint(param);
  return (
    <TextField select size="small" label={param.name} value={value} required={param.required}
      onChange={(e) => onChange(e.target.value)} helperText={hint || undefined}>
      <MenuItem value="">(default)</MenuItem>
      {(param.choices ?? []).map((choice) => (
        <MenuItem key={String(choice)} value={String(choice)}>{String(choice)}</MenuItem>
      ))}
    </TextField>
  );
}

function TextParamField({ param, value, onChange }: FieldProps) {
  const hint = paramHint(param);
  const numeric = param.type === "int" || param.type === "float";
  const placeholder = structuredPlaceholder(param.type);
  const bounds = { min: param.min ?? undefined, max: param.max ?? undefined, step: param.type === "int" ? 1 : "any" };
  return (
    <TextField
      size="small"
      label={param.name}
      value={value}
      required={param.required}
      type={numeric ? "number" : "text"}
      slotProps={numeric ? { htmlInput: bounds } : undefined}
      multiline={placeholder !== undefined}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      helperText={hint || undefined}
      sx={placeholder ? { "& textarea": { fontFamily: "monospace", fontSize: "0.8rem" } } : undefined}
    />
  );
}

function ParamField(props: FieldProps) {
  const { param, value, onChange } = props;
  if (param.type === "bool") {
    const hint = paramHint(param);
    return (
      <FormControlLabel
        control={<Checkbox size="small" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />}
        label={<Typography variant="body2">{param.name}{hint ? ` — ${hint}` : ""}</Typography>}
      />
    );
  }
  if (param.choices?.length) return <ChoiceField {...props} />;
  return <TextParamField {...props} />;
}

function NodeChips({ label, names, color }: { label: string; names: string[]; color: "success" | "warning" }) {
  if (names.length === 0) return null;
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
      <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 56 }}>{label}</Typography>
      {names.slice(0, 30).map((n) => (
        <Chip key={n} label={n} size="small" variant="outlined" color={color} sx={{ height: 18, fontSize: "0.65rem" }} />
      ))}
      {names.length > 30 && <Typography variant="caption">+{names.length - 30} more</Typography>}
    </Box>
  );
}

function countsLine(preview: GeneratorPreview): string {
  const { before, after } = preview;
  const from = before ? `${before.nodes.length} nodes / ${before.links} links → ` : "";
  const to = after ? `${after.nodes.length} nodes / ${after.links} links` : "";
  const devices = Object.entries(after?.devices ?? {});
  const mix = devices.length > 0 ? ` (${devices.map(([d, n]) => `${n}× ${d}`).join(", ")})` : "";
  return `${from}${to}${mix}`;
}

function PreviewSummary({ preview }: { preview: GeneratorPreview }) {
  if (!preview.ok) {
    return (
      <Alert severity="error" sx={{ "& pre": { m: 0, whiteSpace: "pre-wrap", fontSize: "0.72rem" } }}>
        netlab rejects this:
        <pre>{preview.error}</pre>
      </Alert>
    );
  }
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <Alert severity="success" sx={{ py: 0.25 }}>{countsLine(preview)}</Alert>
      <NodeChips label="Added" names={preview.addedNodes ?? []} color="success" />
      <NodeChips label="Removed" names={preview.removedNodes ?? []} color="warning" />
      <Box component="pre" sx={{
        m: 0, p: 1, maxHeight: 220, overflow: "auto", fontSize: "0.72rem", borderRadius: 1,
        bgcolor: "action.hover", fontFamily: "monospace",
      }}>
        {preview.diff || "(no change to the topology file)"}
      </Box>
    </Box>
  );
}

function ReplaceChips({ names, onRemove }: { names: string[]; onRemove: (name: string) => void }) {
  if (names.length === 0) return null;
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>Replaces</Typography>
      {names.map((name) => (
        <Chip key={name} label={name} size="small" onDelete={() => onRemove(name)} sx={{ height: 20, fontSize: "0.7rem" }} />
      ))}
    </Box>
  );
}

function GeneratorHeader({ generator, notes }: { generator: Generator; notes: string[] }) {
  return (
    <>
      {generator.description && (
        <Typography variant="body2" color="text.secondary">{generator.description}</Typography>
      )}
      {notes.map((note) => (
        <Alert key={note} severity="info" sx={{ py: 0 }}>{note}</Alert>
      ))}
      {(generator.params ?? []).length === 0 && (
        <Typography variant="caption" color="text.secondary">
          This generator declares no parameters. Add a <code>_generator</code> schema to the plugin
          (or <code>attributes.global</code> in its defaults.yml) to get a form here.
        </Typography>
      )}
    </>
  );
}

/** Form state for one generator, reset whenever the dialog opens. A preview
 * is only valid for the inputs it was made from, so every edit drops it. */
function useGeneratorForm(open: boolean, generator: Generator | null, seed: GeneratorSeed | null) {
  const [fields, setFields] = useState<Record<string, FieldValue>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [node, setNodeState] = useState("");
  const [replaceNodes, setReplaceNodes] = useState<string[]>([]);
  const [preview, setPreview] = useState<GeneratorPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !generator) return;
    const initial: Record<string, FieldValue> = {};
    for (const param of generator.params ?? []) {
      initial[param.name] = toField(param, seed?.params?.[param.name]);
    }
    setFields(initial);
    setTouched(new Set(Object.keys(seed?.params ?? {})));
    setNodeState(seed?.node ?? "");
    setReplaceNodes(seed?.replaceNodes ?? []);
    setPreview(null);
    setError(null);
  }, [open, generator, seed]);

  const invalidate = () => {
    setPreview(null);
    setError(null);
  };

  return {
    fields,
    node,
    replaceNodes,
    preview,
    setPreview,
    error,
    setError,
    setField: (name: string, value: FieldValue) => {
      setFields((prev) => ({ ...prev, [name]: value }));
      setTouched((prev) => new Set(prev).add(name));
      invalidate();
    },
    setNode: (value: string) => {
      setNodeState(value);
      invalidate();
    },
    removeReplaced: (name: string) => {
      setReplaceNodes((prev) => prev.filter((n) => n !== name));
      invalidate();
    },
    request: (sessionId: string, gen: Generator): GeneratorApplyRequest => ({
      sessionId,
      plugin: gen.plugin,
      params: collectParams(gen, fields, touched),
      node: gen.scope === "node" ? node.trim() || null : null,
      replaceNodes,
    }),
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Configure a generator plugin, preview what netlab builds from it, and apply
 * it to the topology as one undoable step. Apply is only offered for a
 * preview netlab accepted.
 */
export function GeneratorDialog({
  open,
  sessionId,
  generator,
  seed,
  onClose,
  onApplied,
}: {
  open: boolean;
  sessionId: string;
  generator: Generator | null;
  seed: GeneratorSeed | null;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const form = useGeneratorForm(open, generator, seed);
  const [busy, setBusy] = useState(false);

  if (!generator) return null;

  const runPreview = async () => {
    setBusy(true);
    form.setError(null);
    try {
      form.setPreview(await api.previewGenerator(form.request(sessionId, generator)));
    } catch (err) {
      form.setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const preview = form.preview;
    if (!preview?.ok) return;
    setBusy(true);
    form.setError(null);
    try {
      const ack = await api.applyTopologyCommand(sessionId, preview.command);
      if (ack.error) throw new Error(ack.error);
      const count = preview.after?.nodes.length;
      onApplied(`Applied ${generator.plugin}${count == null ? "" : `; the lab now expands to ${count} nodes`}.`);
      onClose();
    } catch (err) {
      form.setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const target = generator.scope === "node" ? `node attribute ${generator.key}:` : `top-level ${generator.key}:`;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        {generator.title}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {`${generator.plugin} · ${target}`}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 1.5, pt: "8px !important" }}>
        <GeneratorHeader generator={generator} notes={seed?.notes ?? []} />

        {generator.scope === "node" && (
          <TextField size="small" label="Node" required value={form.node}
            helperText="The node this generator is attached to"
            onChange={(e) => form.setNode(e.target.value)} />
        )}

        {(generator.params ?? []).map((param) => (
          <ParamField key={param.name} param={param} value={form.fields[param.name] ?? ""}
            onChange={(value) => form.setField(param.name, value)} />
        ))}

        <ReplaceChips names={form.replaceNodes} onRemove={form.removeReplaced} />

        {form.error && <Alert severity="error">{form.error}</Alert>}
        {form.preview && <PreviewSummary preview={form.preview} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void runPreview()} disabled={busy}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}>
          Preview
        </Button>
        <Button variant="contained" onClick={() => void apply()} disabled={busy || !form.preview?.ok}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
