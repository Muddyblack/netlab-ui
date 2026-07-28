/**
 * Reconstructs the before/after text a unified diff's hunks cover, so it can
 * be handed to a proper diff editor instead of rendered as raw +/- lines.
 * Only the hunk context is recovered (not the whole file) — that's all a
 * unified diff carries — but that's exactly the region a proposal changes.
 */
export function parseUnifiedDiff(diff: string): { original: string; modified: string; path: string } {
  const original: string[] = [];
  const modified: string[] = [];
  let path = "";
  let sawHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const header = line.slice(4).trim();
      if (!path && header !== "/dev/null") {
        const match = header.match(/^[ab]\/(.+)$/);
        path = match ? match[1] : header;
      }
      continue;
    }
    if (line.startsWith("@@")) {
      if (sawHunk) {
        original.push("");
        modified.push("");
      }
      sawHunk = true;
      continue;
    }
    if (!sawHunk) continue;
    if (line.startsWith("+")) {
      modified.push(line.slice(1));
    } else if (line.startsWith("-")) {
      original.push(line.slice(1));
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      original.push(text);
      modified.push(text);
    }
  }

  return { original: original.join("\n"), modified: modified.join("\n"), path };
}
