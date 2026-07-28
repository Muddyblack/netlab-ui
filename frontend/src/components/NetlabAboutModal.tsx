// netlab-ui's About dialog content, rendered via clab-ui's `renderAboutModal`
// extension prop (replacing the built-in Containerlab/TopoViewer dialog).
import React from "react";
import { Accordion, AccordionDetails, AccordionSummary, Avatar, Box, Card, Chip, Divider, Link, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { alpha } from "@mui/material/styles";
import GitHubIcon from "@mui/icons-material/GitHub";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import type { HealthStatus } from "../api/client";
import { AboutModal, AuthorCard, RepoCard } from "./AboutModal";

const TEXT_SECONDARY = "text.secondary";

type RuntimeHealth = HealthStatus & {
    appVersion?: string | null;
    libvirt?: boolean | null;
    containerlabVersion?: string | null;
    libvirtVersion?: string | null;
};

type NetlabComponent = NonNullable<HealthStatus["netlabComponents"]>[number];

function statusHex(color: "error" | "warning" | "success"): string {
    if (color === "success") return "#22c55e";
    if (color === "error") return "#ef4444";
    return "#f59e0b";
}

function componentChipColor(item: NetlabComponent): "success" | "error" | "warning" {
    if (item.installed) return "success";
    return item.category === "required" ? "error" : "warning";
}

function cleanVersion(value?: string | null): string {
    if (!value) return "not found";
    return value.replace(/^netlab version\s+/i, "").trim();
}

function appVersionLabel(value?: string | null): string {
    const version = value || __APP_VERSION__;
    return /^\d+\.\d+/.test(version) ? `v${version}` : version;
}

function VersionRow({
    label,
    value,
    ok,
    error,
}: {
    label: string;
    value?: string | null;
    ok?: boolean | null;
    error?: boolean;
}) {
    const unavailable = ok === false;
    const unknownVersion = ok === true && !value;
    let chipLabel = value;
    let chipColor: "error" | "warning" | "success" = "success";
    if (error) {
        chipColor = "error";
    } else if (unavailable) {
        chipLabel = "not installed";
        chipColor = "error";
    } else if (unknownVersion) {
        chipLabel = "version unknown";
        chipColor = "warning";
    }
    const statusColor = statusHex(chipColor);
    return (
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Typography variant="body2" color={TEXT_SECONDARY}>{label}</Typography>
            <Chip
                size="small"
                variant="outlined"
                color={chipColor}
                label={chipLabel}
                sx={{
                    maxWidth: "70%",
                    color: statusColor,
                    borderColor: alpha(statusColor, 0.65),
                    bgcolor: alpha(statusColor, 0.08),
                    "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" }
                }}
            />
        </Stack>
    );
}

export function RuntimeInfo({ health }: { health: HealthStatus | null }) {
    const components = health?.netlabComponents ?? [];
    const missingRequired = components.filter((item) => item.category === "required" && !item.installed);
    const missingAnsible = components.filter((item) => item.category === "ansible" && !item.installed);
    const hasProblem = health?.netlab === false || health?.netlabVersionSupported === false || missingRequired.length > 0;
    const categoryLabels: Record<NetlabComponent["category"], string> = {
        required: "Required packages",
        optional: "Optional packages",
        ansible: "Ansible components",
    };
    return (
        <Stack spacing={1}>
            <Typography variant="subtitle2">Environment</Typography>
            <Card variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                    <VersionRow label="netlab-ui" value={appVersionLabel(health?.appVersion)} ok />
                    <VersionRow label="netlab CLI" value={cleanVersion(health?.netlabVersion)} ok={health?.netlab} error={health?.netlabVersionSupported === false} />
                    <VersionRow label="containerlab" value={cleanVersion(health?.containerlabVersion)} ok={health?.containerlab} />
                    <VersionRow label="libvirt / virsh" value={cleanVersion(health?.libvirtVersion)} ok={health?.libvirt} />
                    {health?.netlabVersionSupported === false && (
                        <Typography variant="caption" color="warning.main">
                            netlab {health.minNetlabVersion}+ is recommended for this UI.
                        </Typography>
                    )}
                    {components.length > 0 && (
                        <>
                            <Divider />
                            <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&::before": { display: "none" } }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 34, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
                                    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                                        {hasProblem ? <ErrorOutlineIcon color="error" fontSize="small" /> : <CheckCircleIcon color="success" fontSize="small" />}
                                        <Typography variant="body2" fontWeight={600}>
                                            {hasProblem ? "Environment needs attention" : "Core dependencies healthy"}
                                        </Typography>
                                        {missingAnsible.length > 0 && <Chip size="small" color="warning" variant="outlined" label="Ansible missing" />}
                                    </Stack>
                                </AccordionSummary>
                                <AccordionDetails sx={{ px: 0, pt: 0.5, pb: 0 }}>
                                    {(["required", "optional", "ansible"] as const).map((category) => {
                                        const items = components.filter((item) => item.category === category);
                                        if (items.length === 0) return null;
                                        return (
                                            <Box key={category} sx={{ mb: 1 }}>
                                                <Typography variant="caption" color={TEXT_SECONDARY} fontWeight={600}>{categoryLabels[category]}</Typography>
                                                <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                                    {items.map((item) => (
                                                        <Chip
                                                            key={`${category}:${item.name}`}
                                                            size="small"
                                                            variant="outlined"
                                                            color={componentChipColor(item)}
                                                            label={`${item.name}: ${item.version ?? "not installed"}`}
                                                        />
                                                    ))}
                                                </Stack>
                                            </Box>
                                        );
                                    })}
                                </AccordionDetails>
                            </Accordion>
                        </>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}

export const NetlabAboutModal: React.FC<{ isOpen: boolean; onClose: () => void; health: HealthStatus | null }> = ({
    isOpen,
    onClose,
    health
}) => (
    <AboutModal
        isOpen={isOpen}
        onClose={onClose}
        title="netlab-ui"
        badgeText="NL"
        badgeIcon={`${import.meta.env.BASE_URL}favicon.svg`}
        description={
            <>
                Visual authoring and lifecycle management for{" "}
                <Link href="https://netlab.tools/" target="_blank" rel="noopener noreferrer">
                    netlab
                </Link>{" "}
                virtual network labs.
            </>
        }
        runtimeInfo={<RuntimeInfo health={health as RuntimeHealth | null} />}
        links={[
            {
                name: "Netlab Docs",
                description: "Official netlab documentation",
                url: "https://netlab.tools/",
                icon: <MenuBookIcon fontSize="small" />
            },
            {
                name: "Containerlab Docs",
                description: "Default container provider",
                url: "https://containerlab.dev/",
                icon: <MenuBookIcon fontSize="small" />
            }
        ]}
        team={[
            {
                avatarUrl: "https://github.com/ipspace.png",
                name: "ipSpace / Ivan Pepelnjak",
                title: "netlab maintainers",
                profileUrl: "https://github.com/ipspace/netlab",
                iconText: "IP",
                iconColor: "#E65100"
            },
            {
                avatarUrl: "https://github.com/Muddyblack.png",
                name: "Muddyblack",
                title: "netlab-ui maintainer",
                profileUrl: "https://github.com/Muddyblack",
                iconText: "MB",
                iconColor: "#2E7D32"
            }
        ]}
        acknowledgements={
            <>
                <RepoCard
                    name="SRL Labs / Nokia"
                    description="Open-source TopoViewer and clab-ui foundation"
                    url="https://github.com/srl-labs/clab-ui"
                    icon={<Avatar src="https://github.com/srl-labs.png" sx={{ width: 20, height: 20 }} />}
                />
                <Box sx={{ px: 0.5, pt: 0.5 }}>
                    <Typography variant="caption" color={TEXT_SECONDARY}>
                        This netlab UI builds on the open-source TopoViewer and clab-ui work published by SRL Labs.
                    </Typography>
                </Box>
            </>
        }
        sourceCodeLinks={[
            {
                name: "netlab",
                description: "Source code",
                url: "https://github.com/ipspace/netlab",
                icon: <GitHubIcon fontSize="small" />
            },
            {
                name: "netlab-ui",
                description: "Frontend integration",
                url: "https://github.com/Muddyblack/netlab-ui",
                icon: <GitHubIcon fontSize="small" />
            },
            {
                name: "clab-ui",
                description: "Shared topology UI runtime",
                url: "https://github.com/srl-labs/clab-ui",
                icon: <GitHubIcon fontSize="small" />
            }
        ]}
    />
);
export const NetlabAboutContent: React.FC = () => (
    <Stack spacing={2.5}>
        <Box>
            <Typography variant="subtitle2" fontWeight={650} gutterBottom>Documentation</Typography>
            <RepoCard
                name="Netlab Docs"
                description="Official netlab documentation"
                url="https://netlab.tools/"
                icon={<MenuBookIcon fontSize="small" />}
            />
            <RepoCard
                name="Containerlab Docs"
                description="Default container provider"
                url="https://containerlab.dev/"
                icon={<MenuBookIcon fontSize="small" />}
            />
        </Box>

        <Divider />

        <Box>
            <Typography variant="subtitle2" fontWeight={650} gutterBottom>Team</Typography>
            <AuthorCard
                avatarUrl="https://github.com/ipspace.png"
                name="ipSpace / Ivan Pepelnjak"
                title="netlab maintainers"
                profileUrl="https://github.com/ipspace/netlab"
                iconText="IP"
                iconColor="#E65100"
            />
            <AuthorCard
                avatarUrl="https://github.com/Muddyblack.png"
                name="Muddyblack"
                title="netlab-ui maintainer"
                profileUrl="https://github.com/Muddyblack"
                iconText="MB"
                iconColor="#2E7D32"
            />
        </Box>

        <Divider />

        <Box>
            <Typography variant="subtitle2" fontWeight={650} gutterBottom>Acknowledgements</Typography>
            <RepoCard
                name="SRL Labs / Nokia"
                description="Open-source TopoViewer and clab-ui foundation"
                url="https://github.com/srl-labs/clab-ui"
                icon={<Avatar src="https://github.com/srl-labs.png" sx={{ width: 20, height: 20 }} />}
            />
            <Box sx={{ px: 0.5, pt: 0.5 }}>
                <Typography variant="caption" color={TEXT_SECONDARY}>
                    This netlab UI builds on the open-source TopoViewer and clab-ui work published by SRL Labs.
                </Typography>
            </Box>
        </Box>

        <Divider />

        <Box>
            <Typography variant="subtitle2" fontWeight={650} gutterBottom>Source Code</Typography>
            <RepoCard
                name="netlab"
                description="Source code"
                url="https://github.com/ipspace/netlab"
                icon={<GitHubIcon fontSize="small" />}
            />
            <RepoCard
                name="netlab-ui"
                description="Frontend integration"
                url="https://github.com/Muddyblack/netlab-ui"
                icon={<GitHubIcon fontSize="small" />}
            />
            <RepoCard
                name="clab-ui"
                description="Shared topology UI runtime"
                url="https://github.com/srl-labs/clab-ui"
                icon={<GitHubIcon fontSize="small" />}
            />
        </Box>
    </Stack>
);
