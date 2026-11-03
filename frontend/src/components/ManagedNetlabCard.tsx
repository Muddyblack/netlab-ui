import { useCallback, useEffect, useState } from "react";
import { Button, Card, Stack, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";

import { api, type ManagedNetlab } from "../api/client";
import { CommandStreamDialog, type CommandStreamRequest } from "./dialogs/CommandStreamDialog";

/**
 * "Install netlab for me": netlab-ui creates a virtual environment of its own, installs netlab and Ansible into
 * it and uses that. Nothing is installed system-wide and a netlab you already have is left alone; pointing the UI
 * at your own install stays one path in the box above.
 */
export function ManagedNetlabCard({ netlabFound, onChanged }: { netlabFound: boolean; onChanged: () => void }) {
  const [info, setInfo] = useState<ManagedNetlab | null>(null);
  const [run, setRun] = useState<CommandStreamRequest | null>(null);

  const load = useCallback(() => {
    void api.getManagedNetlab().then(setInfo, () => setInfo(null));
  }, []);
  useEffect(load, [load]);

  if (!info) return null;

  const start = () =>
    setRun({
      title: info.installed ? "Update netlab" : "Install netlab",
      description: (
        <>
          Creates a private Python environment in <code>{info.directory}</code> {info.where} and installs{" "}
          {info.packages.join(", ")} there, then uses it. Nothing is installed system-wide and any netlab you already
          have stays as it is. It takes a few minutes and needs internet access.
        </>
      ),
      command: `${info.python ?? "python3"} -m venv ${info.directory} && pip install ${info.packages.join(" ")}`,
      url: "/api/environment/netlab/install/stream",
      body: {},
      startLabel: info.installed ? "Update" : "Install",
    });

  return (
    <Card variant="outlined" sx={{ p: 1.5, borderColor: netlabFound ? undefined : "primary.main" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
        <DownloadIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2">{netlabFound ? "netlab managed by netlab-ui" : "No netlab yet?"}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {info.installed
          ? `Installed in ${info.directory}${info.active ? " and in use." : ". Not the one in use: save its path above to use it."}`
          : "netlab-ui can install netlab and Ansible for you in a private environment, so nothing else on this machine is touched."}
      </Typography>
      <Button size="small" variant={netlabFound ? "outlined" : "contained"} disabled={!info.canInstall} onClick={start}>
        {info.installed ? "Update netlab" : "Install netlab for me"}
      </Button>
      {!info.canInstall && (
        <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
          python3 was not found {info.where}: install Python 3.10 or newer first.
        </Typography>
      )}
      <CommandStreamDialog
        request={run}
        onClose={() => setRun(null)}
        onDone={(ok) => {
          load();
          if (ok) onChanged();
        }}
      />
    </Card>
  );
}
