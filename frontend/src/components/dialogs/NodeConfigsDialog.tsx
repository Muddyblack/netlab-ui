import { useEffect, useState } from "react";
import {
  Alert, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, List, ListItemButton, ListItemText, ListSubheader, Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import { api, type NodeConfigFiles } from "../../api/client";
import { openLabFile } from "../../host/fileOpenStore";
import { openNodeConfigsDialog, useNodeConfigsTarget } from "../../host/nodeConfigsStore";

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

/** The files netlab generated for one node (right-click a node → Config Files):
 * the rendered configuration per module (ospf, bgp, daemons, initial…) and the
 * node's resolved data. A click opens the file in an editor tab. */
export function NodeConfigsDialog() {
  const target = useNodeConfigsTarget();
  const [result, setResult] = useState<NodeConfigFiles | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null); setError(null);
    if (!target) return;
    let cancelled = false;
    api.listNodeConfigs(target.sessionId, target.node)
      .then((files) => { if (!cancelled) setResult(files); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [target]);

  if (!target) return null;
  const close = () => openNodeConfigsDialog(null);
  const groups = [...new Set((result?.files ?? []).map((file) => file.group))];

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Config files · <span style={{ fontFamily: "monospace" }}>{target.node}</span>
        <IconButton aria-label="Close" onClick={close} sx={{ position: "absolute", right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ minHeight: 120 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {!result && !error && <CircularProgress size={20} />}
        {result && result.files.length === 0 && (
          <Alert severity="info">
            netlab has not generated files for this node yet. Run <b>Netlab Create (Generate configs)</b> on the lab, then try again.
          </Alert>
        )}
        {groups.map((group) => (
          <List key={group} dense subheader={<ListSubheader disableSticky sx={{ lineHeight: "28px" }}>{group}</ListSubheader>}>
            {result?.files.filter((file) => file.group === group).map((file) => (
              <ListItemButton key={file.path} onClick={() => { if (openLabFile(file.path)) close(); }}>
                <ListItemText primary={file.name} primaryTypographyProps={{ fontFamily: "monospace" }} />
                <Typography variant="caption" color="text.secondary">{sizeLabel(file.size)}</Typography>
              </ListItemButton>
            ))}
          </List>
        ))}
      </DialogContent>
    </Dialog>
  );
}
