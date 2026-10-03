import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useMonitoringChanges } from "../host/monitoringDialogStore";

/** Is monitoring switched on for the lab behind this session (drives the Monitoring side-panel tab). */
export function useMonitoringEnabled(sessionId: string | null): boolean {
  const [enabled, setEnabled] = useState(false);
  const changes = useMonitoringChanges();
  useEffect(() => {
    setEnabled(false);
    if (!sessionId) return undefined;
    let live = true;
    api.getMonitoring(sessionId).then(
      (state) => live && setEnabled(Boolean(state.enabled)),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [sessionId, changes]);
  return enabled;
}
