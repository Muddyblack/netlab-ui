import { getApiBase } from "./endpoint";

/** POST a link fault command; resolves to an error message, or null on success. */
export async function postLinkCommand(path: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/lab/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as { detail?: unknown; code?: number; stderr?: string; stdout?: string };
    if (!res.ok) return typeof payload.detail === "string" ? payload.detail : `HTTP ${res.status}`;
    if (payload.code) return (payload.stderr || payload.stdout || `exit ${payload.code}`).replace(/\s+/g, " ").trim();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
