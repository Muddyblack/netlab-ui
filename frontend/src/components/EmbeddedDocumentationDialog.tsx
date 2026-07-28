import { useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from "@mui/material";

export interface EmbeddedDocumentationDialogProps {
    open: boolean;
    title: string;
    subtitle?: string;
    url?: string | null;
    onClose: () => void;
}

export function EmbeddedDocumentationDialog({
    open,
    title,
    subtitle,
    url,
    onClose
}: EmbeddedDocumentationDialogProps) {
    const [docsFrameKey, setDocsFrameKey] = useState(0);
    const docsIframeRef = useRef<HTMLIFrameElement | null>(null);

    const embeddedDocsDialogWidth = "min(1240px, calc(100vw - 48px))";

    const handleReload = () => {
        const frameWindow = docsIframeRef.current?.contentWindow;
        if (!frameWindow) {
            return;
        }

        try {
            frameWindow.location.reload();
        } catch (error) {
            console.warn("Unable to reload iframe:", error);
            setDocsFrameKey((current) => current + 1);
        }
    };

    const handleOpenInNewTab = () => {
        if (!url) {
            return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={false}
            fullWidth
            slotProps={{
                backdrop: {
                    sx: {
                        backdropFilter: "blur(8px)",
                        backgroundColor: "rgba(8, 10, 14, 0.72)"
                    }
                },
                paper: {
                    sx: {
                        width: embeddedDocsDialogWidth,
                        height: "min(920px, calc(100vh - 48px))",
                        maxWidth: "none",
                        maxHeight: "none",
                        overflow: "hidden",
                        borderRadius: 3,
                        border: 1,
                        borderColor: "divider",
                        backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0))",
                        boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)"
                    }
                }
            }}
        >
            <DialogTitle
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 1.5,
                    px: 2.5,
                    py: 1.75,
                    bgcolor: "background.paper",
                    borderBottom: 1,
                    borderColor: "divider"
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography
                        variant="h6"
                        sx={{
                            fontWeight: 700,
                            lineHeight: 1.1,
                            color: "#ff9800"
                        }}
                    >
                        {title}
                    </Typography>
                    {subtitle ? (
                        <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                            {subtitle}
                        </Typography>
                    ) : null}
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: "auto" }}>
                    <Tooltip title="Reload">
                        <IconButton
                            size="small"
                            onClick={handleReload}
                            sx={{ color: "text.secondary" }}
                            aria-label="Reload documentation"
                        >
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Open in new tab">
                        <IconButton
                            size="small"
                            onClick={handleOpenInNewTab}
                            sx={{ color: "text.secondary" }}
                            aria-label="Open documentation in new tab"
                        >
                            <OpenInNewIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <IconButton
                        size="small"
                        onClick={onClose}
                        sx={{ color: "text.secondary" }}
                        aria-label="Close documentation"
                    >
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent
                sx={{
                    bgcolor: "background.default",
                    p: 0,
                    backgroundImage: "radial-gradient(circle at top left, rgba(255,255,255,0.04), transparent 28%)"
                }}
            >
                {url ? (
                    <Box
                        sx={{
                            position: "relative",
                            width: "100%",
                            height: "100%",
                            overflow: "hidden",
                            bgcolor: "background.default"
                        }}
                    >
                        <Box
                            component="iframe"
                            key={`${url}-${docsFrameKey}`}
                            ref={docsIframeRef}
                            src={url}
                            sx={{
                                width: "100%",
                                height: "100%",
                                border: "none",
                                display: "block",
                                bgcolor: "background.default"
                            }}
                            title={`${title} documentation`}
                        />
                    </Box>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
