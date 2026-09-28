/** Display names for the agent CLIs the backend can start (ids from
 * /api/assistant/capabilities `harnesses`). Kept apart from AgentTerminal so
 * tab labels don't pull xterm into the main bundle. */
const AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export const agentName = (id: string) => AGENT_NAMES[id] ?? id;
