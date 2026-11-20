import { useState } from "react";
import { Box, Button, IconButton, Paper, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { HealthStatus } from "../api/client";
import { useContainerDiagnostics } from "./ContainerSetup";
import { useHostDiagnostics } from "./HostSetup";
import { MarkdownDocumentDialog } from "./LazyMarkdownDocumentDialog";

const DISMISS_KEY = "netlab-ui:setup-notice-dismissed";
const MAX_SHOWN = 3;

function buildInstallMarkdown(missing: string[]): string {
  const sections: string[] = [];

  if (missing.includes("netlab")) {
    sections.push(`## Installing netlab

netlab is a Python-based network automation framework that manages the lab lifecycle,
generates device configurations, and deploys them via Ansible.

### Quick install

\`\`\`bash
pip install networklab
\`\`\`

To include all optional provider extras:

\`\`\`bash
pip install networklab[all]
\`\`\`

### Requirements

- Python 3.9 or later
- Ansible (required for device configuration deployment)
- A supported emulation platform — containerlab, Vagrant, or a cloud provider

### Verify

\`\`\`bash
netlab --version
\`\`\`

Refer to the [full installation guide](https://netlab.tools/install/) for platform setup,
virtual environment recommendations, and optional dependency details.`);
  }

  if (missing.includes("containerlab")) {
    sections.push(`## Installing containerlab

containerlab is a container-native network lab platform used by netlab to spin up
topology nodes as Docker containers.

### Quick install

\`\`\`bash
bash -c "$(curl -sL https://get.containerlab.dev)"
\`\`\`

### Requirements

- Linux host (kernel ≥ 4.10 recommended)
- Docker Engine installed and running
- \`sudo\` or root access for the installer

### Verify

\`\`\`bash
containerlab version
\`\`\`

See the [containerlab install docs](https://containerlab.dev/install/) for package-manager
install methods, SELinux notes, and Air-gap environments.`);
  }

  return sections.join("\n\n---\n\n");
}

interface Problem {
  key: string;
  title: string;
}

type Checks = { inContainer: boolean; checks: { id: string; ok: boolean; severity: string; title: string }[] } | null;

/** Every reason labs cannot deploy, once each: the failing setup checks, plus tools /api/health found missing that
 * no check names (or that were not checked yet). */
function collectProblems(health: HealthStatus, container: Checks, host: Checks) {
  const inContainer = container?.inContainer ?? false;
  const checks = (inContainer ? container?.checks : host?.checks) ?? [];
  const problems: Problem[] = checks
    .filter((check) => !check.ok && check.severity === "error")
    .map((check) => ({ key: check.id, title: check.title }));
  const missing: string[] = [];
  if (!health.netlab) missing.push("netlab");
  if (health.containerlab === false && !health.libvirt) missing.push("containerlab");
  for (const tool of missing) {
    if (!problems.some((p) => p.key === tool || p.key === `host-${tool}`)) {
      problems.unshift({ key: tool, title: `${tool} not found` });
    }
  }
  return { problems, missing, inContainer };
}

/**
 * The one "labs cannot be deployed yet" notice. It replaces three banners that used to say the same thing at once:
 * a missing netlab/containerlab on the PATH (from /api/health), the host's setup checks and, in a container, the
 * container's own checks. Each problem is listed once; "Set up" opens Settings → Environment with the details.
 * Closing it hides it for this browser session only: a host that cannot deploy labs should say so again next time.
 */
export function SetupNotice({ health, onOpenSettings }: { health: HealthStatus | null; onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [guideOpen, setGuideOpen] = useState(false);
  const enabled = !dismissed && health !== null;
  const container = useContainerDiagnostics(enabled).data;
  const hostChecks = useHostDiagnostics(enabled && container !== null && !container.inContainer).data;

  if (dismissed || !health) return null;

  const { problems, missing, inContainer } = collectProblems(health, container, hostChecks);
  if (problems.length === 0) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private window: it shows again on reload */
    }
    setDismissed(true);
  };
  const containerProblem = inContainer && problems.some((p) => p.key !== "netlab" && p.key !== "containerlab");
  const accent = containerProblem ? "error" : "warning";
  const Icon = containerProblem ? ErrorOutlineIcon : WarningAmberIcon;
  const shown = problems.slice(0, MAX_SHOWN);

  return (
    <>
      {/* Top centre, under the app bar; on a phone at the bottom, where it does not cover the explorer's filter
          and connection status (the update notice sits higher there). */}
      <Box
        sx={{
          position: "fixed",
          top: { xs: "auto", sm: 60 },
          bottom: { xs: 16, sm: "auto" },
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: (theme) => theme.zIndex.modal - 1, // under dialogs: "Set up" opens one, and this covered its tabs
          width: { xs: "calc(100% - 32px)", sm: 480 }
        }}
      >
        <Paper
          elevation={6}
          role="alert"
          sx={{ p: 1.5, pl: 2, borderRadius: 2, borderLeft: 3, borderLeftColor: `${accent}.main` }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Icon fontSize="small" color={accent} />
            <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>
              {inContainer && containerProblem ? "This container can't deploy labs yet" : "Labs can't be deployed yet"}
            </Typography>
            <IconButton aria-label="Dismiss setup notice" size="small" onClick={dismiss} sx={{ mr: -0.5 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box component="ul" sx={{ m: 0, mt: 0.5, ml: 3.5, pl: 2, color: "text.secondary" }}>
            {shown.map((problem) => (
              <Typography component="li" variant="body2" key={problem.key}>
                {problem.title}
              </Typography>
            ))}
            {problems.length > MAX_SHOWN && (
              <Typography component="li" variant="body2" sx={{ listStyle: "none", ml: -2 }}>
                and {problems.length - MAX_SHOWN} more
              </Typography>
            )}
          </Box>
          <Stack direction="row" justifyContent="flex-end" spacing={0.5} sx={{ mt: 1, mb: -0.5 }}>
            {missing.length > 0 && (
              <Button size="small" variant="text" color="inherit" onClick={() => setGuideOpen(true)}>
                Install guide
              </Button>
            )}
            <Button size="small" variant="text" color={accent} onClick={() => { onOpenSettings(); dismiss(); }}>
              Set up
            </Button>
          </Stack>
        </Paper>
      </Box>

      <MarkdownDocumentDialog
        open={guideOpen}
        title={`Install ${missing.join(" & ")}`}
        subtitle="Installation guide"
        markdown={buildInstallMarkdown(missing)}
        onClose={() => setGuideOpen(false)}
      />
    </>
  );
}
