import { useRef, useState } from "react";
import type { RefObject } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";

import { api } from "../../api/client";
import type { PluginImportRequest, PluginImportResult } from "../../api/client";

type ImportMode = "upload" | "path" | "template";

function canSubmitImport(mode: ImportMode, busy: boolean, name: string, content: string | null, sourcePath: string): boolean {
  if (busy || name.trim() === "") return false;
  if (mode === "template") return true;
  if (mode === "upload") return content !== null;
  return sourcePath.trim() !== "";
}

function UploadModeFields({
  fileInput,
  content,
  onFile,
}: {
  fileInput: RefObject<HTMLInputElement | null>;
  content: string | null;
  onFile: (file: File) => void;
}) {
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <input
        ref={fileInput}
        type="file"
        accept=".py"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileInput.current?.click()}>
        {content === null ? "Choose a .py file" : "Choose a different file"}
      </Button>
      {content !== null && (
        <Typography variant="caption" color="text.secondary">
          {content.split("\n").length} lines loaded. It is checked for
          syntax errors and netlab hooks before being written.
        </Typography>
      )}
    </Box>
  );
}

function PathModeFields({
  sourcePath,
  setSourcePath,
  link,
  setLink,
  name,
  setName,
}: {
  sourcePath: string;
  setSourcePath: (value: string) => void;
  link: boolean;
  setLink: (value: boolean) => void;
  name: string;
  setName: (value: string) => void;
}) {
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <TextField
        label="Path to the .py file on this machine"
        placeholder="/home/you/plugins/my_tweak.py"
        size="small"
        value={sourcePath}
        onChange={(e) => setSourcePath(e.target.value)}
        onBlur={() => {
          const stem = sourcePath.trim().split("/").pop()?.replace(/\.py$/, "");
          if (stem && !name) setName(stem);
        }}
      />
      <FormControlLabel
        control={<Checkbox size="small" checked={link} onChange={(e) => setLink(e.target.checked)} />}
        label={
          <Typography variant="caption">
            Symlink instead of copying — keep editing the original and
            netlab picks up every change
          </Typography>
        }
      />
    </Box>
  );
}

function ImportErrorAlert({
  error,
  overwrite,
  setOverwrite,
}: {
  error: string;
  overwrite: boolean;
  setOverwrite: (value: boolean) => void;
}) {
  return (
    <Alert severity="error" sx={{ py: 0.5 }}>
      {error}
      {/\balready exists\b/.test(error) && (
        <FormControlLabel
          control={<Checkbox size="small" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />}
          label={<Typography variant="caption">Replace the existing file</Typography>}
        />
      )}
    </Alert>
  );
}

/**
 * Add a user-written plugin to netlab's plugin search path.
 *
 * netlab has always supported custom plugins — it just never had anywhere to
 * say so, which is why most users assume the built-in list is all there is.
 * Three routes in, because the app runs in three places: upload works in the
 * browser (where the user's file never reaches the server), a server path
 * works on the host, and a template covers "I want to write one but don't
 * know the shape".
 */
export function PluginImportDialog({
  open,
  sessionId,
  hasOpenLab,
  onClose,
  onImported,
}: {
  open: boolean;
  sessionId: string;
  hasOpenLab: boolean;
  onClose: () => void;
  onImported: (result: PluginImportResult) => void;
}) {
  const [mode, setMode] = useState<ImportMode>("upload");
  const [name, setName] = useState("");
  // Default to the lab folder when one is open: it's the first entry on
  // netlab's search path and keeps the plugin with the lab it belongs to.
  const [destination, setDestination] = useState(hasOpenLab ? "topology" : "user");
  const [content, setContent] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [link, setLink] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName("");
    setContent(null);
    setSourcePath("");
    setLink(false);
    setOverwrite(false);
    setError(null);
  };

  const handleFile = async (file: File) => {
    setContent(await file.text());
    // Seed the name from the filename; the user can still override it.
    if (!name) setName(file.name.replace(/\.py$/, ""));
  };

  const handleModeChange = (next: ImportMode) => {
    setMode(next);
    setError(null);
    if (next === "template") {
      setLink(false);
    }
  };

  const canSubmit = canSubmitImport(mode, busy, name, content, sourcePath);

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: PluginImportRequest = {
        sessionId,
        name: name.trim(),
        destination,
        overwrite,
        link: mode === "path" && link,
      };
      if (mode === "upload") {
        body.content = content;
      } else if (mode === "path") {
        body.sourcePath = sourcePath.trim();
      } else {
        body.content = (await api.getPluginTemplate(name.trim())).content;
      }
      const result = await api.importPlugin(body);
      onImported(result);
      reset();
      onClose();
    } catch (err) {
      // The backend's messages are written for the user (syntax errors with a
      // line number, name collisions, missing files) — show them verbatim.
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Add a custom plugin</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          netlab plugins are Python files that transform the topology before it
          is deployed. Anything you add here lands on netlab&apos;s plugin search
          path and appears in this panel alongside the built-in ones.
        </Typography>

        <Tabs
          value={mode}
          onChange={(_, next) => handleModeChange(next as ImportMode)}
          variant="fullWidth"
          sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, fontSize: "0.78rem" } }}
        >
          <Tab value="upload" label="Upload a file" />
          <Tab value="path" label="From this machine" />
          <Tab value="template" label="Start from template" />
        </Tabs>

        {mode === "upload" && (
          <UploadModeFields fileInput={fileInput} content={content} onFile={(file) => void handleFile(file)} />
        )}

        {mode === "path" && (
          <PathModeFields sourcePath={sourcePath} setSourcePath={setSourcePath} link={link} setLink={setLink} name={name} setName={setName} />
        )}

        {mode === "template" && (
          <Typography variant="caption" color="text.secondary">
            Creates a documented starter plugin with a <code>post_transform</code>{" "}
            hook, then opens it in the file editor so you can fill it in.
          </Typography>
        )}

        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            label="Plugin name"
            size="small"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText="Used as the plugin: entry in your topology"
          />
          <TextField
            select
            label="Install to"
            size="small"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            sx={{ minWidth: 190 }}
            helperText={
              destination === "topology"
                ? "Ships with the lab folder"
                : "Available to every lab"
            }
          >
            <MenuItem value="topology" disabled={!hasOpenLab}>
              Lab folder
            </MenuItem>
            <MenuItem value="user">~/.netlab</MenuItem>
          </TextField>
        </Box>

        {error && <ImportErrorAlert error={error} overwrite={overwrite} setOverwrite={setOverwrite} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {busy ? "Adding…" : "Add plugin"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
