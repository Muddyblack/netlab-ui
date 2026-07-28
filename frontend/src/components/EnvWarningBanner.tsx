import { useState } from "react";
import { Alert, Box, ClickAwayListener, IconButton, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { DocumentationActionButtons } from "./DocumentationActionButtons";
import { MarkdownDocumentDialog } from "./MarkdownDocumentDialog";
import { EmbeddedDocumentationDialog } from "./EmbeddedDocumentationDialog";
import type { HealthStatus } from "../api/client";

const ENV_WARNING_DISMISS_KEY = "netlab-gui:env-warning-dismissed";

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

export function EnvWarningBanner({ health }: { health: HealthStatus | null }) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(ENV_WARNING_DISMISS_KEY) === "1"
  );
  const [hidden, setHidden] = useState(false);
  const [installMarkdownOpen, setInstallMarkdownOpen] = useState(false);
  const [installEmbedOpen, setInstallEmbedOpen] = useState(false);

  const handleDismiss = () => {
    localStorage.setItem(ENV_WARNING_DISMISS_KEY, "1");
    setDismissed(true);
  };

  const handleClickAway = () => {
    // Keep the banner while a docs dialog it spawned is open — those render in a
    // portal, so a click inside them counts as "away" from the banner.
    if (installMarkdownOpen || installEmbedOpen) {
      return;
    }
    // Soft, session-only hide — don't permanently suppress on an accidental click-away.
    setHidden(true);
  };

  if (dismissed || hidden || !health) return null;
  const missing: string[] = [];
  if (!health.netlab) missing.push("netlab");
  if (health.containerlab === false) missing.push("containerlab");
  if (missing.length === 0) return null;

  const primaryInstallUrl = missing.includes("netlab")
    ? "https://netlab.tools/install/"
    : "https://containerlab.dev/install/";
  const installMarkdown = buildInstallMarkdown(missing);

  return (
    <>
      <ClickAwayListener onClickAway={handleClickAway}>
        <Box
          sx={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2000,
            maxWidth: 600,
            width: "calc(100% - 32px)"
          }}
        >
          <Alert
            severity="warning"
            variant="filled"
            sx={{ boxShadow: 4, alignItems: "center" }}
            action={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                <DocumentationActionButtons
                  docsUrl={primaryInstallUrl}
                  manualLabel="Installation guide"
                  externalLabel="Open install docs"
                  onOpenManual={() => setInstallMarkdownOpen(true)}
                  onOpenExternal={() => setInstallEmbedOpen(true)}
                />
                <Tooltip title="Dismiss">
                  <IconButton
                    size="small"
                    onClick={handleDismiss}
                    sx={{ color: "text.secondary" }}
                    aria-label="Dismiss warning"
                  >
                    <CloseIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            }
          >
            <strong>{missing.join(" and ")}</strong> not found on the backend PATH.{" "}
            Deploy and shell actions are unavailable until installed.
          </Alert>
        </Box>
      </ClickAwayListener>

      <MarkdownDocumentDialog
        open={installMarkdownOpen}
        title={`Install ${missing.join(" & ")}`}
        subtitle="Installation guide"
        markdown={installMarkdown}
        onClose={() => setInstallMarkdownOpen(false)}
      />

      <EmbeddedDocumentationDialog
        open={installEmbedOpen}
        title={missing.includes("netlab") ? "netlab Installation" : "containerlab Installation"}
        subtitle="Official install documentation"
        url={primaryInstallUrl}
        onClose={() => setInstallEmbedOpen(false)}
      />
    </>
  );
}
