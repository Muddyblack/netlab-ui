import { useCallback, useEffect, useState } from "react";
import { Box, Button, Collapse, IconButton, Link, MenuItem, Select, Stack, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";

import { api, type AssistantCapabilities, type AssistantProposal } from "../../api/client";
import { ProposalCard } from "./ProposalCard";

type McpInfo = NonNullable<AssistantCapabilities["mcp"]>;

/** How each agent is pointed at netlab-ui's MCP server, in its own config format. */
function clientSnippets({ url, authHeader }: McpInfo): Array<{ id: string; label: string; where: string; text: string }> {
  const headers = { Authorization: authHeader };
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return [
    {
      id: "claude",
      label: "Claude Code",
      where: "Run once in a terminal",
      text: `claude mcp add --transport http netlab ${url} --header "Authorization: ${authHeader}"`,
    },
    {
      id: "codex",
      label: "Codex",
      where: "Run once; start Codex with the token in NETLAB_MCP_TOKEN",
      text: `codex mcp add netlab --url ${url} --bearer-token-env-var NETLAB_MCP_TOKEN\nexport NETLAB_MCP_TOKEN=${authHeader.replace(/^Bearer /, "")}`,
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      where: "~/.gemini/settings.json",
      text: json({ mcpServers: { netlab: { httpUrl: url, headers } } }),
    },
    {
      id: "cursor",
      label: "Cursor",
      where: "~/.cursor/mcp.json",
      text: json({ mcpServers: { netlab: { url, headers } } }),
    },
    {
      id: "vscode",
      label: "VS Code",
      where: ".vscode/mcp.json",
      text: json({ servers: { netlab: { type: "http", url, headers } } }),
    },
  ];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" sx={{ display: "block", mb: 0.75, color: "text.secondary", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
      {children}
    </Typography>
  );
}

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Box sx={{ position: "relative", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
      <Box component="pre" sx={{ m: 0, p: 1, pr: 4.5, fontFamily: "monospace", fontSize: "0.72rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {text}
      </Box>
      <Tooltip title={copied ? "Copied" : "Copy"}>
        <IconButton
          size="small"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}
          sx={{ position: "absolute", top: 4, right: 4, width: 26, height: 26 }}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** One button per agent CLI installed on the backend host; a muted line otherwise. */
function StartAgent({ capabilities, onStartAgent }: {
  capabilities: AssistantCapabilities;
  onStartAgent: (agentId: string) => void;
}) {
  const harnesses = capabilities.harnesses ?? [];
  const installed = harnesses.filter((item) => item.available);
  if (!capabilities.harnessesAllowed) {
    return (
      <Typography variant="body2" color="text.secondary">
        Starting an agent here only works on the netlab-ui host itself, or with a login configured. Connect one below instead.
      </Typography>
    );
  }
  if (installed.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No agent CLI on this host. Install{" "}
        {harnesses.map((item, index) => (
          <span key={item.id}>
            {index > 0 && (index === harnesses.length - 1 ? " or " : ", ")}
            <Link href={item.homepage} target="_blank" rel="noreferrer">{item.name}</Link>
          </span>
        ))}
        , or connect a tool below.
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
      {installed.map((item) => (
        <Button key={item.id} variant="contained" size="small" startIcon={<SmartToyOutlinedIcon />} onClick={() => onStartAgent(item.id)}>
          {item.name}
        </Button>
      ))}
    </Stack>
  );
}

/** Pending proposals from the agent; nothing at all when there are none. */
function Proposals({ sessionId, onApplied }: { sessionId: string; onApplied: () => void }) {
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const load = useCallback(() => {
    void api.listAssistantProposals(sessionId).then((result) => setProposals(result.proposals ?? []), () => undefined);
  }, [sessionId]);

  useEffect(() => {
    load();
    return api.subscribeEvents((event) => {
      if (event.type === "proposals" && (!event.sessionId || event.sessionId === sessionId)) load();
    });
  }, [load, sessionId]);

  const pending = proposals.filter((proposal) => proposal.status === "pending");
  if (pending.length === 0) return null;
  return (
    <Box>
      <SectionLabel>Review · {pending.length}</SectionLabel>
      <Stack spacing={1}>
        {pending.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onResolved={load} onApplied={onApplied} />
        ))}
      </Stack>
    </Box>
  );
}

/** Setup for any MCP tool, folded away until asked for. */
function ConnectTool({ mcp }: { mcp: McpInfo }) {
  const [open, setOpen] = useState(true);
  const [client, setClient] = useState("claude");
  const snippets = clientSnippets(mcp);
  const snippet = snippets.find((item) => item.id === client) ?? snippets[0];
  return (
    <Box>
      <Button
        variant="text"
        size="small"
        onClick={() => setOpen((value) => !value)}
        endIcon={<ExpandMoreIcon sx={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />}
        sx={{ px: 0, color: "text.secondary", textTransform: "none", fontWeight: 600 }}
      >
        Connect another tool
      </Button>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Select size="small" value={snippet.id} onChange={(event) => setClient(event.target.value)} sx={{ minWidth: 150, fontSize: "0.85rem" }}>
              {snippets.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: snippet.where.includes("/") ? "monospace" : undefined }}>
              {snippet.where}
            </Typography>
          </Stack>
          <CopyBlock text={snippet.text} label={`${snippet.label} setup`} />
          <Typography variant="caption" color="text.secondary">
            {mcp.tools?.length ?? 0} tools · the token changes on restart unless <code>NETLAB_APP_ASSISTANT_TOKEN</code> is set
          </Typography>
        </Stack>
      </Collapse>
    </Box>
  );
}

/**
 * netlab-ui has no chat of its own: people use the agent they already have
 * (Claude Code, Codex, Gemini CLI, Cursor, …), connected to this lab over MCP
 * — started here in a terminal tab, or set up by hand. Its proposed changes
 * are reviewed here too.
 */
export function AgentsPanel({ capabilities, sessionId, onApplied, onStartAgent }: {
  capabilities: AssistantCapabilities;
  sessionId: string;
  onApplied: () => void;
  onStartAgent: (agentId: string) => void;
}) {
  return (
    <Stack spacing={2.5} sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1.5 }}>
      <Box>
        <Typography variant="body2" sx={{ mb: 1.25 }}>
          Your own AI agent, connected to this lab. It reads the lab, runs show commands and proposes changes for you to
          review.
        </Typography>
        <StartAgent capabilities={capabilities} onStartAgent={onStartAgent} />
      </Box>
      <Proposals sessionId={sessionId} onApplied={onApplied} />
      {capabilities.mcp && <ConnectTool mcp={capabilities.mcp} />}
    </Stack>
  );
}
