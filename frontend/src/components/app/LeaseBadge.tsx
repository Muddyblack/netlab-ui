import { useCallback, useEffect, useState } from "react";
import { Button, Paper, Tooltip, Typography } from "@mui/material";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";

import { api } from "../../api/client";

const WARN_MS = 10 * 60 * 1000;

function remaining(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** Shows when the open lab will be shut down (NETLAB_UI_LAB_HOURS) and lets
 * anyone give it another full lease. Invisible for labs without a lease. */
export function LeaseBadge({ sessionId, onToast }: {
  sessionId: string;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}) {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    void api.getLease(sessionId).then((lease) => setExpiresAt(lease.expiresAt ?? null)).catch(() => setExpiresAt(null));
  }, [sessionId]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  const urgent = left < WARN_MS;
  const extend = () => {
    void api.extendLease(sessionId)
      .then((lease) => {
        setExpiresAt(lease.expiresAt ?? null);
        onToast(`Lab extended until ${new Date(lease.expiresAt ?? "").toLocaleTimeString()}`, "success");
      })
      .catch((err: unknown) => onToast(`Could not extend the lab: ${err instanceof Error ? err.message : String(err)}`, "error"));
  };

  return (
    <Paper
      elevation={urgent ? 6 : 2}
      sx={{ position: "absolute", left: 12, top: 56, zIndex: 7, pointerEvents: "auto", display: "flex", alignItems: "center", gap: 0.75,
        px: 1, py: 0.25, bgcolor: urgent ? "error.main" : "background.paper", color: urgent ? "#fff" : "text.primary" }}
    >
      <TimerOutlinedIcon sx={{ fontSize: 16 }} />
      <Tooltip title={`This server shuts labs down after a fixed time. Shutdown at ${new Date(expiresAt).toLocaleString()}.`}>
        <Typography variant="caption" sx={{ fontWeight: urgent ? 700 : 500 }}>
          {urgent ? `Shuts down in ${remaining(left)}` : `Running until ${new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </Typography>
      </Tooltip>
      <Button size="small" onClick={extend}
        sx={{ minWidth: 0, py: 0, px: 0.75, textTransform: "none", fontSize: "0.72rem", bgcolor: "transparent !important",
          color: urgent ? "#fff !important" : "primary.main", border: "1px solid currentColor" }}>
        Extend
      </Button>
    </Paper>
  );
}
