import { useEffect, useState } from "react";
import {
  Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography
} from "@mui/material";
import BuildIcon from "@mui/icons-material/Build";
import DownloadIcon from "@mui/icons-material/Download";
import FactCheckIcon from "@mui/icons-material/FactCheck";

import { api, type SetupCatalog } from "../api/client";
import { CommandStreamDialog, type CommandStreamRequest } from "./dialogs/CommandStreamDialog";

const TEST_HINTS: Record<string, string> = {
  clab: "containerlab with Docker",
  libvirt: "libvirt VMs (needs KVM and a Vagrant box)",
  podman: "containerlab with Podman",
  grpc: "gRPC libraries and the Nokia collection",
};

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
        {icon}
        <Typography variant="subtitle2">{title}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>{hint}</Typography>
      {children}
    </Card>
  );
}

/** netlab's own setup commands: self-test a provider, run an installation
 * script, build a routing-daemon container, read a Vagrant box recipe. */
export function NetlabSetupHelpers() {
  const [catalog, setCatalog] = useState<SetupCatalog | null>(null);
  const [run, setRun] = useState<CommandStreamRequest | null>(null);
  const [box, setBox] = useState("");
  const [recipe, setRecipe] = useState<{ device: string; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void api.getSetupCatalog().then((data) => { if (alive) setCatalog(data); }, () => undefined);
    return () => { alive = false; };
  }, []);

  if (!catalog || (!catalog.tests.length && !catalog.install.length)) return null;

  const selfTest = (provider: string) => setRun({
    title: `Check my setup · ${provider}`,
    description: (
      <>
        Deploys netlab&apos;s small test lab with {TEST_HINTS[provider] ?? provider}, checks it and removes it again —
        a few minutes. Stop your other labs first: they share netlab&apos;s default management network.
      </>
    ),
    command: `netlab test ${provider}`,
    url: "/api/environment/setup/stream",
    body: { action: "test", target: provider },
    startLabel: "Run test",
  });

  const install = (script: string, description: string) => setRun({
    title: `Install ${script}`,
    description: (
      <>
        {description}. Runs netlab&apos;s installation script on the backend host: it installs packages with apt and
        needs root or password-less sudo. Meant for Ubuntu/Debian hosts.
      </>
    ),
    command: `netlab install -y ${script}`,
    url: "/api/environment/setup/stream",
    body: { action: "install", target: script },
    startLabel: "Install",
    severity: "warning",
  });

  const build = (daemon: string, description: string) => setRun({
    title: `Build ${daemon} container`,
    description: <>{description || daemon}: builds the netlab/{daemon} image with Docker on the backend host.</>,
    command: `netlab clab build ${daemon}`,
    url: "/api/environment/setup/stream",
    body: { action: "build", target: daemon },
    startLabel: "Build",
  });

  const showRecipe = async () => {
    if (!box) return;
    try {
      setRecipe(await api.getBoxRecipe(box));
    } catch (err) {
      setRecipe({ device: box, text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Stack spacing={1.25}>
      <Typography variant="subtitle2">netlab setup helpers</Typography>

      {catalog.tests.length > 0 && (
        <Section icon={<FactCheckIcon fontSize="small" color="primary" />} title="Check my setup"
          hint="Runs netlab test: a real deploy of a tiny lab, the fastest proof a provider works on this host.">
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {catalog.tests.map((provider) => (
              <Button key={provider} size="small" variant={provider === "clab" ? "contained" : "outlined"}
                title={TEST_HINTS[provider]} onClick={() => selfTest(provider)}>
                Test {provider}
              </Button>
            ))}
          </Stack>
        </Section>
      )}

      {catalog.install.length > 0 && (
        <Section icon={<DownloadIcon fontSize="small" color="primary" />} title="Install software"
          hint="netlab install: missing Ansible, containerlab, libvirt or GraphViz, installed the way netlab expects.">
          <Stack spacing={0.5}>
            {catalog.install.map((item) => (
              <Stack key={item.id} direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={item.id} sx={{ minWidth: 92, fontFamily: "monospace" }} />
                <Typography variant="body2" sx={{ flex: 1 }}>{item.description}</Typography>
                <Button size="small" variant="text" onClick={() => install(item.id, item.description)}>Install…</Button>
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      {catalog.builds.length > 0 && (
        <Section icon={<BuildIcon fontSize="small" color="primary" />} title="Build routing-daemon containers"
          hint="netlab clab build: images for devices netlab builds itself (BIRD, dnsmasq, …).">
          <Stack spacing={0.5}>
            {catalog.builds.map((item) => (
              <Stack key={item.id} direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={item.id} sx={{ minWidth: 92, fontFamily: "monospace" }} />
                <Typography variant="body2" sx={{ flex: 1 }}>{item.description}</Typography>
                <Button size="small" variant="text" onClick={() => build(item.id, item.description)}>Build…</Button>
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      {catalog.boxes.length > 0 && (
        <Section icon={<BuildIcon fontSize="small" color="primary" />} title="Vagrant boxes for libvirt"
          hint="netlab libvirt config: the step-by-step recipe for turning a vendor disk image into a Vagrant box.">
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField select size="small" label="Device" value={box} onChange={(event) => setBox(event.target.value)} sx={{ minWidth: 180 }}>
              {catalog.boxes.map((device) => <MenuItem key={device} value={device}>{device}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" disabled={!box} onClick={() => void showRecipe()}>Show recipe</Button>
          </Stack>
        </Section>
      )}

      <CommandStreamDialog request={run} onClose={() => setRun(null)} />
      <Dialog open={recipe !== null} onClose={() => setRecipe(null)} maxWidth="md" fullWidth>
        <DialogTitle>Vagrant box recipe · {recipe?.device}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Then package it on the lab host with <code>netlab libvirt package {recipe?.device} &lt;disk image&gt;</code> (needs KVM).
          </Typography>
          <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{recipe?.text}</Box>
        </DialogContent>
        <DialogActions><Button onClick={() => setRecipe(null)}>Close</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}
