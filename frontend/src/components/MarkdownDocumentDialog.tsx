import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import remarkSmartypants from "remark-smartypants";
import { rehypeMarkdownHighlight } from "../utils/markdownHighlight";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";

type DocumentView = "markdown" | "web";

export interface MarkdownDocumentDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  markdown: string;
  resolveImageFallback?: (src: string) => string | undefined;
  webUrl?: string | null;
  initialView?: DocumentView;
  fillViewport?: boolean;
  onClose: () => void;
}

export function MarkdownDocumentDialog({
  open,
  title,
  subtitle,
  markdown,
  resolveImageFallback,
  webUrl,
  initialView = "markdown",
  fillViewport = false,
  onClose
}: MarkdownDocumentDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [view, setView] = useState<DocumentView>("markdown");
  const [frameKey, setFrameKey] = useState(0);
  const hasWebView = Boolean(webUrl);

  const markdownComponents = useMemo<Components>(
    () => ({
      img: ({ node: _node, onError, ...props }) => (
        <img
          {...props}
          onError={(event) => {
            onError?.(event);
            const image = event.currentTarget;
            if (image.dataset.fallbackTried) return;
            const fallback = image.src && resolveImageFallback?.(image.src);
            if (!fallback) return;
            image.dataset.fallbackTried = "1";
            image.src = fallback;
          }}
        />
      )
    }),
    [resolveImageFallback]
  );

  // Restore the preferred initial view each time the dialog opens.
  useEffect(() => {
    if (open) {
      setView(initialView === "web" && hasWebView ? "web" : "markdown");
    } else {
      setView("markdown");
    }
  }, [hasWebView, initialView, open]);

  const handleReloadWebView = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) {
      return;
    }

    try {
      frameWindow.location.reload();
    } catch (error) {
      console.warn("Unable to reload iframe:", error);
      setFrameKey((current) => current + 1);
    }
  };

  const handleOpenWebView = () => {
    if (!webUrl) {
      return;
    }
    window.open(webUrl, "_blank", "noopener,noreferrer");
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
            width: fillViewport
              ? { xs: "calc(100vw - 16px)", sm: "calc(100vw - 32px)", md: "calc(100vw - 64px)" }
              : "min(1180px, calc(100vw - 64px))",
            height: fillViewport
              ? { xs: "calc(100vh - 16px)", sm: "calc(100vh - 32px)", md: "calc(100vh - 64px)" }
              : "min(860px, calc(100vh - 64px))",
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
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {hasWebView ? (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_, nextView: DocumentView | null) => {
                if (nextView) setView(nextView);
              }}
              aria-label="Documentation view"
              sx={{
                mr: 0.5,
                "& .MuiToggleButton-root": {
                  px: 1.25,
                  py: 0.35,
                  fontSize: "0.72rem",
                  textTransform: "none"
                }
              }}
            >
              <ToggleButton value="markdown" aria-label="Show rendered markdown">Markdown</ToggleButton>
              <ToggleButton value="web" aria-label="Show web documentation">Web</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          {view === "web" ? (
            <>
              <Tooltip title="Reload">
                <IconButton
                  size="small"
                  onClick={handleReloadWebView}
                  sx={{ color: "text.secondary" }}
                  aria-label="Reload documentation"
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Open in new tab">
                <IconButton
                  size="small"
                  onClick={handleOpenWebView}
                  sx={{ color: "text.secondary" }}
                  aria-label="Open documentation in new tab"
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          ) : null}
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ color: "text.secondary" }}
            aria-label="Close document"
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
        {view === "web" && webUrl ? (
          <Box
            component="iframe"
            key={`${webUrl}-${frameKey}`}
            ref={iframeRef}
            src={webUrl}
            title={`${title} documentation`}
            sx={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
              bgcolor: "background.default"
            }}
          />
        ) : (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              overflow: "auto",
              px: { xs: 2.5, md: 4 },
              py: { xs: 2.5, md: 3.5 },
              color: "text.secondary",
              fontSize: "0.92rem",
              lineHeight: 1.7,
              userSelect: "text",
              WebkitUserSelect: "text",
              "& > :first-of-type": { mt: 0 },
              "& > :last-child": { mb: 0 },
              "& > h1:first-of-type": { display: "none" },
              "& h1, & h2, & h3, & h4": {
                color: "text.primary",
                fontWeight: 700,
                lineHeight: 1.2,
                mt: 2.5,
                mb: 1
              },
              "& h1": { fontSize: "1.5rem" },
              "& h2": { fontSize: "1.2rem" },
              "& h3": { fontSize: "1.02rem" },
              "& p": { my: 1.1 },
              "& a": { color: "primary.main", textDecorationColor: "currentColor" },
              "& ul, & ol": { pl: 3, my: 1.2 },
              "& li": { mb: 0.5 },
              "& hr": {
                border: 0,
                borderTop: "1px solid",
                borderColor: "divider",
                my: 2.5
              },
              "& code": {
                fontFamily: "monospace",
                fontSize: "0.86em",
                bgcolor: "var(--vscode-textCodeBlock-background, #2d2d2d)",
                color: "var(--vscode-input-foreground, #cccccc)",
                px: 0.5,
                py: 0.15,
                borderRadius: 0.5
              },
              "& pre": {
                bgcolor: "var(--vscode-input-background, #2d2d2d)",
                color: "var(--vscode-input-foreground, #cccccc)",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                overflowX: "auto",
                p: 1.75,
                my: 1.75
              },
              "& pre code": {
                bgcolor: "transparent",
                p: 0,
                borderRadius: 0
              },
              "& table": {
                width: "100%",
                borderCollapse: "collapse",
                my: 1.75
              },
              "& th, & td": {
                border: "1px solid",
                borderColor: "divider",
                px: 1.2,
                py: 0.8,
                textAlign: "left",
                verticalAlign: "top"
              },
              "& th": {
                color: "text.primary",
                bgcolor: "action.hover",
                fontWeight: 600
              },
              "& img": {
                maxWidth: "100%",
                height: "auto",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                display: "block",
                mx: "auto"
              },
              "& blockquote": {
                borderLeft: "3px solid",
                borderColor: "primary.main",
                m: 0,
                pl: 2,
                color: "text.secondary"
              }
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkEmoji, remarkSmartypants]}
              rehypePlugins={[rehypeMarkdownHighlight]}
              components={markdownComponents}
              skipHtml
            >
              {markdown}
            </ReactMarkdown>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
