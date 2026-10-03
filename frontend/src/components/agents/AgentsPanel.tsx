import { useCallback, useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Box, ButtonBase, Chip, Divider, FormControlLabel, IconButton, Link, Menu, MenuItem, Select, Stack, Switch,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { type AssistantCapabilities } from "../../api/client";
import { AgentIcon } from "./AgentIcon";
import { agentBase, agentName } from "./agentNames";
import { TerminalSlot, focusAgent, setAgentPlacement, useAgentSurface } from "./AgentSurface";
import { persistAgentConnect, persistAgentSkipPermissions, readAgentConnect, readAgentSkipPermissions, type AgentPlacement } from "./preferences";
import { terminalShortcutLabel, useTerminalShortcut } from "../../app/terminalShortcut";
import { ProposalBar } from "./ProposalBar";
import { ProposalCard } from "./ProposalCard";
import { pendingProposals, refreshProposals, useProposals } from "./proposalsStore";

type McpInfo = NonNullable<AssistantCapabilities["mcp"]>;
type Harness = NonNullable<AssistantCapabilities["harnesses"]>[number];

/** Ways to point a tool at netlab-ui's MCP server by hand. Agents netlab-ui starts itself are wired up
 * by the backend (services/assistant/harness.py); the ones it can't wire add their own recipe from there. */
function clientSnippets({ url, authHeader }: McpInfo, harnesses: Harness[]): Array<{ id: string; label: string; where: string; text: string }> {
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
    ...harnesses
      .filter((item) => item.connect)
      .map((item) => ({ id: item.id, label: item.name, where: item.connect!.where, text: item.connect!.text })),
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

/** What starting this agent does about the lab connection, in a word or two (it has to fit under the name). */
function connectNote(item: Harness, connect: boolean): string {
  if (!connect) return "plain terminal";
  if (item.mcp === "register") return "adds config";
  if (item.mcp === "manual") return "connect by hand";
  return "connected";
}

/** Sort key within the installed agents: connected first, then the ones that need setup. */
function connectRank(item: Harness): number {
  if (item.mcp === "register") return 1;
  if (item.mcp === "manual") return 2;
  return 0;
}

const cardSx = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 1,
  width: "100%",
  minWidth: 0,
  height: 52,
  p: 1,
  border: 1,
  borderColor: "divider",
  borderRadius: 1.5,
  textAlign: "left",
  bgcolor: "background.paper",
  "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
} as const;

/** The agent's logo on a fixed dark tile, so light and dark logos read the same in either theme. */
function Logo({ id }: { id: string }) {
  return (
    <Box sx={{ display: "grid", placeItems: "center", width: 32, height: 32, flex: "none", borderRadius: 1, bgcolor: "#1c1f24" }}>
      <AgentIcon id={id} size={20} />
    </Box>
  );
}

/** Where the agents are looked for, when that is not simply "this machine". */
function RunsOn({ capabilities }: { capabilities: AssistantCapabilities }) {
  if (capabilities.agentsRunOn === "host") {
    return <Typography variant="caption" color="text.secondary">Agents are started on your host machine, as your user, with your own logins.</Typography>;
  }
  if (capabilities.agentsRunOn === "container") {
    return (
      <Typography variant="caption" color="warning.main">
        netlab-ui runs in a container and can only see agents installed inside it.
        {capabilities.agentsNote ? ` To use the ones on your host: ${capabilities.agentsNote}.` : ""}
      </Typography>
    );
  }
  return null;
}

function AgentCard({ item, connect, running, onStart }: {
  item: Harness;
  connect: boolean;
  /** How many instances of this agent are running in the lab. */
  running: number;
  onStart: (agentId: string, another?: boolean) => void;
}) {
  let note = "not installed";
  if (item.available) {
    if (running > 1) note = `${running} running`;
    else note = running ? "running · click to show" : connectNote(item, connect);
  }
  const body = (
    <>
      <Logo id={item.id} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.25 }}>{item.name}</Typography>
        <Typography variant="caption" color={running ? "success.main" : "text.secondary"} noWrap sx={{ display: "block", lineHeight: 1.2 }}>
          {note}
        </Typography>
      </Box>
      {running > 0 && <Box aria-label="running" sx={{ ml: "auto", mr: 3.5, width: 8, height: 8, flex: "none", borderRadius: "50%", bgcolor: "success.main" }} />}
    </>
  );
  if (!item.available) {
    return (
      <Tooltip title={`Not installed on this host. Open ${item.name}'s page`}>
        <ButtonBase component="a" href={item.homepage} target="_blank" rel="noreferrer" sx={{ ...cardSx, opacity: 0.55 }}>{body}</ButtonBase>
      </Tooltip>
    );
  }
  return (
    <Box sx={{ position: "relative" }}>
      <ButtonBase onClick={() => onStart(item.id)} aria-label={running ? `Show ${item.name}` : `Start ${item.name}`} sx={cardSx}>
        {body}
      </ButtonBase>
      {running > 0 && (
        <Tooltip title={`Start another ${item.name}`}>
          <IconButton
            size="small"
            aria-label={`Start another ${item.name}`}
            onClick={() => onStart(item.id, true)}
            sx={{ position: "absolute", top: "50%", right: 4, transform: "translateY(-50%)", width: 24, height: 24 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

/** One card per agent CLI: installed ones start in the terminal panel below, the rest link to their page. */
function StartAgent({ capabilities, onStartAgent }: {
  capabilities: AssistantCapabilities;
  onStartAgent: (agentId: string, another?: boolean) => void;
}) {
  const [connect, setConnect] = useState(readAgentConnect);
  const [skipPermissions, setSkipPermissions] = useState(readAgentSkipPermissions);
  const { placement, running } = useAgentSurface();
  const terminalShortcut = useTerminalShortcut();
  if (!capabilities.harnessesAllowed) {
    return (
      <Typography variant="body2" color="text.secondary">
        Starting an agent here only works on the netlab-ui host itself, or with a login configured. Connect one below instead.
      </Typography>
    );
  }
  const harnesses = capabilities.harnesses ?? [];
  // Installed first; the backend's order within each group.
  const ordered = [...harnesses].sort((a, b) =>
    Number(b.available) - Number(a.available) || connectRank(a) - connectRank(b) || a.name.localeCompare(b.name));
  return (
    <Stack spacing={1.25}>
      <Tooltip
        placement="top-start"
        title="On: the agent starts already connected to this lab, so it can read it, run show commands and propose changes. Off: it starts as a plain terminal in the lab's folder."
      >
        <FormControlLabel
          sx={{ ml: 0, mr: 0, alignSelf: "flex-start" }}
          control={
            <Switch
              size="small"
              checked={connect}
              onChange={(event) => { setConnect(event.target.checked); persistAgentConnect(event.target.checked); }}
            />
          }
          label={<Typography variant="body2">Connect the agent to this lab (MCP)</Typography>}
        />
      </Tooltip>
      <Tooltip
        placement="top-start"
        title="Starts agents with their own skip-permissions flag (for example claude --dangerously-skip-permissions), so they edit files and run commands without asking. Off by default. Applies to agents started from now on; agents without a known flag start normally."
      >
        <FormControlLabel
          sx={{ ml: 0, mr: 0, alignSelf: "flex-start" }}
          control={
            <Switch
              size="small"
              color="warning"
              checked={skipPermissions}
              onChange={(event) => { setSkipPermissions(event.target.checked); persistAgentSkipPermissions(event.target.checked); }}
            />
          }
          label={<Typography variant="body2">Start without permission prompts</Typography>}
        />
      </Tooltip>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2">Show the terminal</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={placement}
          onChange={(_event, value: AgentPlacement | null) => { if (value) setAgentPlacement(value); }}
        >
          <ToggleButton value="below" sx={{ textTransform: "none", py: 0.25 }}>Below</ToggleButton>
          <ToggleButton value="here" sx={{ textTransform: "none", py: 0.25 }}>In this panel</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", alignItems: "stretch" }}>
        {ordered.map((item) => (
          <AgentCard key={item.id} item={item} connect={connect} running={running.filter((node) => agentBase(node) === item.id).length} onStart={onStartAgent} />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {placement === "here"
          ? "Opens in this panel, so keep this tab selected while you talk to the agent. It keeps running when you switch tabs."
          : `Opens in the terminal panel below. ${terminalShortcutLabel(terminalShortcut)} shows or hides it (change it in Settings).`}
      </Typography>
      <RunsOn capabilities={capabilities} />
    </Stack>
  );
}

/** Pending proposals from the agent; nothing at all when there are none. `compact` is one line each, for
 * above a terminal: the change itself is drawn on the canvas. */
function Proposals({ sessionId, onApplied, compact }: { sessionId: string; onApplied: () => void; compact?: boolean }) {
  const { proposals } = useProposals();
  const load = useCallback(() => { void refreshProposals(sessionId); }, [sessionId]);
  const pending = pendingProposals(proposals);
  if (pending.length === 0) return null;
  if (compact) {
    return (
      <Stack spacing={0.5} sx={{ py: 0.5 }}>
        {pending.map((proposal) => <ProposalBar key={proposal.id} proposal={proposal} onApplied={onApplied} />)}
      </Stack>
    );
  }
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

/** Setup for any MCP tool, for agents run outside netlab-ui (an IDE, another terminal). */
function ConnectTool({ mcp, harnesses }: { mcp: McpInfo; harnesses: Harness[] }) {
  const [client, setClient] = useState("claude");
  const snippets = clientSnippets(mcp, harnesses);
  const snippet = snippets.find((item) => item.id === client) ?? snippets[0];
  return (
    <Accordion disableGutters elevation={0} square sx={{ border: 1, borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 0.75 } }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>Connect a tool by hand</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            For an agent you run yourself, in another terminal or your editor.
          </Typography>
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
      </AccordionDetails>
    </Accordion>
  );
}

/** An agent's terminal inside the tab (placement "here"): a strip to switch between running agents or go
 * back to the cards, any pending proposals, then the terminal filling the rest. */
function AgentInPanel({ agentId, sessionId, harnesses, onApplied, onStartAgent, onCloseAgent }: {
  agentId: string;
  sessionId: string;
  harnesses: Harness[];
  onApplied: () => void;
  onStartAgent: (agentId: string, another?: boolean) => void;
  onCloseAgent: (agentId: string) => void;
}) {
  const { running, placement } = useAgentSurface();
  const [connect, setConnect] = useState(readAgentConnect);
  const [skipPermissions, setSkipPermissions] = useState(readAgentSkipPermissions);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const installed = harnesses.filter((item) => item.available);
  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ p: 0.75, flexShrink: 0, overflowX: "auto", borderBottom: 1, borderColor: "divider" }}>
        <Tooltip title="All agents">
          <IconButton size="small" aria-label="Back to all agents" onClick={() => focusAgent(null)}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {running.map((id) => (
          <Chip
            key={id}
            size="small"
            clickable
            icon={<AgentIcon id={agentBase(id)} size={14} />}
            label={agentName(id)}
            color={id === agentId ? "primary" : "default"}
            variant={id === agentId ? "filled" : "outlined"}
            onClick={() => focusAgent(id)}
            onDelete={() => {
              // Closing the shown tab moves to a neighbour; only the last one falls back to the cards.
              if (id === agentId) focusAgent(running.find((other) => other !== id) ?? null);
              onCloseAgent(id);
            }}
          />
        ))}
        {installed.length > 0 && (
          <>
            <Tooltip title="New session">
              <IconButton size="small" aria-label="New agent session" onClick={(event) => setMenuAnchor(event.currentTarget)}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              {installed.map((item) => (
                <MenuItem
                  key={item.id}
                  onClick={() => {
                    setMenuAnchor(null);
                    onStartAgent(item.id, running.some((id) => agentBase(id) === item.id));
                  }}
                >
                  <Box sx={{ mr: 1, display: "flex" }}><AgentIcon id={item.id} size={16} /></Box>
                  {item.name}
                </MenuItem>
              ))}
              <Divider />
              <MenuItem onClick={() => { setConnect(!connect); persistAgentConnect(!connect); }}>
                <Switch size="small" checked={connect} sx={{ mr: 1 }} />
                <Typography variant="body2">Connect to this lab (MCP)</Typography>
              </MenuItem>
              <MenuItem onClick={() => { setSkipPermissions(!skipPermissions); persistAgentSkipPermissions(!skipPermissions); }}>
                <Switch size="small" color="warning" checked={skipPermissions} sx={{ mr: 1 }} />
                <Typography variant="body2">Start without permission prompts</Typography>
              </MenuItem>
              <MenuItem onClick={() => { setMenuAnchor(null); setAgentPlacement(placement === "here" ? "below" : "here"); }}>
                <Switch size="small" checked={placement === "here"} sx={{ mr: 1 }} />
                <Typography variant="body2">Show the terminal in this panel</Typography>
              </MenuItem>
            </Menu>
          </>
        )}
      </Stack>
      <Box sx={{ flexShrink: 0, maxHeight: "35%", overflow: "auto", px: 1 }}>
        <Proposals sessionId={sessionId} onApplied={onApplied} compact />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <TerminalSlot holderKey={`${sessionId}:agent:${agentId}`} />
      </Box>
    </Stack>
  );
}

/**
 * netlab-ui has no chat of its own: people use the agent they already have
 * (Claude Code, Codex, Copilot, Cursor, …), connected to this lab over MCP
 * — started here in the terminal panel, or set up by hand. Its proposed
 * changes are reviewed here too.
 */
export function AgentsPanel({ capabilities, sessionId, onApplied, onStartAgent: openAgent, onCloseAgent }: {
  capabilities: AssistantCapabilities;
  sessionId: string;
  onApplied: () => void;
  onStartAgent: (agentId: string, another?: boolean) => string;
  onCloseAgent: (agentId: string) => void;
}) {
  const { placement, focused, running } = useAgentSurface();
  // Starting (or showing) an agent also makes it the one this tab shows, when the terminal lives here.
  const onStartAgent = useCallback((agentId: string, another?: boolean) => { focusAgent(openAgent(agentId, another)); }, [openAgent]);
  if (placement === "here" && focused && running.includes(focused)) {
    return <AgentInPanel agentId={focused} sessionId={sessionId} harnesses={capabilities.harnesses ?? []} onApplied={onApplied} onStartAgent={onStartAgent} onCloseAgent={onCloseAgent} />;
  }
  return (
    <Stack spacing={2} sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1.5 }}>
      <Box>
        <Typography variant="body2" sx={{ mb: 1.25 }}>
          Your own AI agent, connected to this lab. It reads the lab, runs show commands and proposes changes for you to
          review. <Link href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">What is MCP?</Link>
        </Typography>
        <StartAgent capabilities={capabilities} onStartAgent={onStartAgent} />
      </Box>
      <Proposals sessionId={sessionId} onApplied={onApplied} />
      {capabilities.mcp && <ConnectTool mcp={capabilities.mcp} harnesses={capabilities.harnesses ?? []} />}
    </Stack>
  );
}
