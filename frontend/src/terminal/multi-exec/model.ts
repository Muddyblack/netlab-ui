import type { ExecMode, ExecResult, ExecScript } from "../../api/client";

/** One command sent to a node selection, with the results collected so far. */
export interface ExecRun {
  id: string;
  command: string;
  mode: ExecMode;
  /** What was asked for: node names, group names or "all". */
  selection: string[];
  /** Concrete nodes the backend resolved the selection to. */
  targets: string[];
  results: Record<string, ExecResult>;
  startedAt: number;
  error?: string;
  done: boolean;
}

export interface OutputGroup {
  nodes: string[];
  result: ExecResult;
}

export function resultText(result: ExecResult): string {
  const stderr = result.stderr.trim();
  if (result.timedOut) return `${result.output}${stderr ? `\n${stderr}` : ""}\n[timed out]`.trimStart();
  return stderr ? `${result.output}${result.output && !result.output.endsWith("\n") ? "\n" : ""}${stderr}` : result.output;
}

export function statusLabel(result: ExecResult): string {
  if (result.timedOut) return "timeout";
  if (result.exitCode !== null) return `exit ${result.exitCode}`;
  return resultFailed(result) ? "error" : "ok";
}

export function resultFailed(result: ExecResult): boolean {
  return Boolean(result.failed ?? (result.timedOut || (result.exitCode ?? 0) !== 0));
}

/** Nodes whose output (and outcome) is identical share one card — ten hosts
 * answering the same ping collapse to one, and the odd one out stands out. */
export function groupIdenticalResults(run: ExecRun): OutputGroup[] {
  const groups = new Map<string, OutputGroup>();
  for (const node of run.targets) {
    const result = run.results[node];
    if (!result) continue;
    const key = `${resultFailed(result)}\u0000${resultText(result)}`;
    const existing = groups.get(key);
    if (existing) existing.nodes.push(node);
    else groups.set(key, { nodes: [node], result });
  }
  return [...groups.values()];
}

/** Replayable steps from the commands in a session log, oldest first. */
export function scriptFromRuns(name: string, runs: ExecRun[]): ExecScript {
  return {
    name,
    steps: runs.map((run) => ({ command: run.command, mode: run.mode, nodes: run.selection })),
  };
}

/** The session as Markdown: every command, then each node's output. */
export function transcriptMarkdown(labName: string, runs: ExecRun[]): string {
  const lines = [`# ${labName} — command transcript`, ""];
  for (const run of runs) {
    lines.push(`## \`${run.command}\``, "", `${run.mode} · ${run.selection.join(", ")} · ${new Date(run.startedAt).toLocaleString()}`, "");
    if (run.error) lines.push(`> ${run.error}`, "");
    for (const node of run.targets) {
      const result = run.results[node];
      if (!result) continue;
      const status = statusLabel(result);
      lines.push(`### ${node} (${status})`, "", "```", resultText(result).replace(/\n$/, ""), "```", "");
    }
  }
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
