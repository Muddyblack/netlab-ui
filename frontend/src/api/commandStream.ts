/** Reader for the backend's command-output SSE streams (lifecycle, force
 * cleanup, setup helpers): `{stream, line}` frames, then `{done, code}` or
 * `{error}`. */

export interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
}

interface CommandFrame {
  line?: string;
  stream?: string;
  done?: boolean;
  code?: number;
  error?: string;
}

function applyFrame(frame: CommandFrame, addLine: (line: LogLine) => void): number | null {
  if (frame.line !== undefined) {
    addLine({ stream: frame.stream === "stderr" ? "stderr" : "stdout", line: frame.line });
    return null;
  }
  if (frame.done) {
    return typeof frame.code === "number" ? frame.code : 1;
  }
  if (frame.error) {
    addLine({ stream: "stderr", line: frame.error });
    return 1;
  }
  return null;
}

/** Feed every line to `addLine`; resolves with the exit code (null when the
 * stream ended without one). */
export async function readCommandStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  addLine: (line: LogLine) => void,
): Promise<number | null> {
  const decoder = new TextDecoder();
  let buf = "";
  let code: number | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const frameCode = applyFrame(JSON.parse(dataLine.slice(6)) as CommandFrame, addLine);
      if (frameCode !== null) code = frameCode;
    }
  }
  return code;
}
