/** What the UI knows about the agent CLIs the backend can start. The backend's harness table is the one
 * list of agents; the UI learns it from /api/assistant/capabilities (`harnesses`) and falls back to the
 * id until then (a pop-out window, say). Kept apart from AgentTerminal so tab labels don't pull xterm
 * into the main bundle. */
type Known = { name: string; mcp: string };
let known: Record<string, Known> = {};

export function rememberAgents(harnesses: ReadonlyArray<{ id: string; name: string; mcp?: string }>): void {
  known = Object.fromEntries(harnesses.map((item) => [item.id, { name: item.name, mcp: item.mcp ?? "session" }]));
}

// The same agent can run more than once in a lab. A running instance is identified by its "node": the
// agent's id for the first one (claude), then claude~2, claude~3, ...
export const agentBase = (node: string) => node.split("~")[0];
const agentOrdinal = (node: string) => Number(node.split("~")[1] ?? 1);

/** Name of an agent, or of one of its running instances ("Claude Code", "Claude Code 2"). */
export function agentName(node: string): string {
  const base = agentBase(node);
  const ordinal = agentOrdinal(node);
  return `${known[base]?.name ?? base}${ordinal > 1 ? ` ${ordinal}` : ""}`;
}

/** True when starting this agent connects it to the lab by itself (false for "connect by hand" ones). */
export const agentConnectsItself = (node: string) => {
  const entry = known[agentBase(node)];
  return entry !== undefined && entry.mcp !== "manual";
};
