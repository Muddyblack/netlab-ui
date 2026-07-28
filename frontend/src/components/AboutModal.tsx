// About dialog.
import React from "react";
import {
    Avatar,
    Box,
    Card,
    CardActionArea,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    Link,
    Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import FavoriteIcon from "@mui/icons-material/Favorite";
import GitHubIcon from "@mui/icons-material/GitHub";
import GroupsIcon from "@mui/icons-material/Groups";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

export interface AuthorCardProps {
    avatarUrl?: string;
    name: string;
    title: string;
    profileUrl: string;
    iconText: string;
    iconColor: string;
}

export interface RepoCardProps {
    name: string;
    description: string;
    url: string;
    icon: React.ReactNode;
    iconColor?: string;
}

export interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    badgeText?: string;
    badgeIcon?: string;
    description?: React.ReactNode;
    runtimeInfo?: React.ReactNode;
    links?: RepoCardProps[];
    team?: AuthorCardProps[];
    acknowledgements?: React.ReactNode;
    sourceCodeLinks?: RepoCardProps[];
}

const TEXT_SECONDARY = "text.secondary";

function AboutSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <>
            <Divider />
            <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {icon}
                    {title}
                </Typography>
            </Box>
            <Divider />
            <Box sx={{ p: 2 }}>
                {children}
            </Box>
        </>
    );
}

function RepoCardList({ links }: { links: RepoCardProps[] }) {
    return (
        <>
            {links.map((link) => (
                <RepoCard
                    key={link.name}
                    name={link.name}
                    description={link.description}
                    url={link.url}
                    icon={link.icon}
                />
            ))}
        </>
    );
}

export const AuthorCard: React.FC<AuthorCardProps> = ({
    avatarUrl,
    name,
    title,
    profileUrl,
    iconText,
    iconColor
}) => (
    <Card variant="outlined" sx={{ mb: 1 }}>
        <CardActionArea
            component="a"
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}
        >
            <Avatar src={avatarUrl} sx={{ bgcolor: iconColor, width: 32, height: 32, fontSize: "0.875rem" }}>
                {iconText}
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body2" fontWeight={500}>
                    {name}
                </Typography>
                <Typography variant="caption" color={TEXT_SECONDARY}>
                    {title}
                </Typography>
            </Box>
            <OpenInNewIcon fontSize="small" sx={{ color: TEXT_SECONDARY }} />
        </CardActionArea>
    </Card>
);

export const RepoCard: React.FC<RepoCardProps> = ({ name, description, url, icon, iconColor = TEXT_SECONDARY }) => (
    <Card variant="outlined" sx={{ mb: 1 }}>
        <CardActionArea
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}
        >
            <Box sx={{ color: iconColor }}>{icon}</Box>
            <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body2" fontWeight={500}>
                    {name}
                </Typography>
                <Typography variant="caption" color={TEXT_SECONDARY}>
                    {description}
                </Typography>
            </Box>
            <OpenInNewIcon fontSize="small" sx={{ color: TEXT_SECONDARY }} />
        </CardActionArea>
    </Card>
);

const TopoViewerBadge: React.FC<{ text: string; icon?: string }> = ({ text, icon }) => {
    if (icon) {
        return (
            <Box
                component="img"
                src={icon}
                alt={text}
                sx={{
                    width: 48,
                    height: 48
                }}
            />
        );
    }

    return (
        <Avatar
            variant="rounded"
            sx={{
                width: 48,
                height: 48,
                bgcolor: "#1565C0",
                color: "common.white",
                fontWeight: 700,
                fontSize: "0.95rem"
            }}
        >
            {text}
        </Avatar>
    );
};

export const AboutModal: React.FC<AboutModalProps> = ({
    isOpen,
    onClose,
    title = "TopoViewer",
    badgeText = "CL",
    badgeIcon,
    description,
    runtimeInfo,
    links,
    team,
    acknowledgements,
    sourceCodeLinks
}) => {
    const defaultDescription = (
        <>
            Interactive topology visualization and editing for{" "}
            <Link href="https://containerlab.dev/" target="_blank" rel="noopener noreferrer">
                containerlab
            </Link>{" "}
            network topologies.
        </>
    );

    const defaultLinks: RepoCardProps[] = [
        {
            name: "Containerlab Docs",
            description: "Official platform documentation",
            url: "https://containerlab.dev/",
            icon: <MenuBookIcon fontSize="small" />
        }
    ];

    const defaultTeam: AuthorCardProps[] = [
        {
            avatarUrl: "https://github.com/srl-labs.png",
            name: "SRL Labs / Nokia",
            title: "Containerlab maintainers",
            profileUrl: "https://github.com/srl-labs",
            iconText: "SL",
            iconColor: "#1565C0"
        }
    ];

    const defaultSourceCodeLinks: RepoCardProps[] = [
        {
            name: "containerlab",
            description: "Source code",
            url: "https://github.com/srl-labs/containerlab",
            icon: <GitHubIcon fontSize="small" />
        },
        {
            name: "clab-ui",
            description: "Shared UI runtime code",
            url: "https://github.com/srl-labs/clab-ui",
            icon: <GitHubIcon fontSize="small" />
        }
    ];

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            data-testid="about-modal"
            slotProps={{
                paper: {
                    sx: {
                        maxHeight: "80vh"
                    }
                }
            }}
        >
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <TopoViewerBadge text={badgeText} icon={badgeIcon} />
                    <Typography variant="h5" fontWeight={600}>
                        {title}
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0 }}>
                {/* Description */}
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" color={TEXT_SECONDARY}>
                        {description || defaultDescription}
                    </Typography>
                </Box>

                {runtimeInfo && (
                    <>
                        <Divider />
                        <Box sx={{ p: 2 }}>
                            {runtimeInfo}
                        </Box>
                    </>
                )}

                <AboutSection icon={<MenuBookIcon fontSize="small" />} title="Documentation">
                    <RepoCardList links={links || defaultLinks} />
                </AboutSection>

                <AboutSection icon={<GroupsIcon fontSize="small" />} title="Team">
                    {(team || defaultTeam).map((member) => (
                        <AuthorCard
                            key={member.name}
                            avatarUrl={member.avatarUrl}
                            name={member.name}
                            title={member.title}
                            profileUrl={member.profileUrl}
                            iconText={member.iconText}
                            iconColor={member.iconColor}
                        />
                    ))}
                </AboutSection>

                {acknowledgements && (
                    <AboutSection icon={<FavoriteIcon fontSize="small" />} title="Acknowledgements">
                        {acknowledgements}
                    </AboutSection>
                )}

                <AboutSection icon={<GitHubIcon fontSize="small" />} title="Source Code">
                    <RepoCardList links={sourceCodeLinks || defaultSourceCodeLinks} />
                </AboutSection>

                {/* Footer */}
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 0.5,
                        py: 2,
                        color: TEXT_SECONDARY
                    }}
                >
                    <Typography variant="caption">Made with</Typography>
                    <FavoriteIcon sx={{ fontSize: 14, color: "error.main" }} />
                    <Typography variant="caption">for the network community</Typography>
                </Box>
            </DialogContent>
        </Dialog>
    );
};
