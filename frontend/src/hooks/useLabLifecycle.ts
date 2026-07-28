import { useCallback } from "react";
import { useTopoViewerActions } from "@srl-labs/clab-ui";
import type { ClabUiTopoViewerEvent } from "@srl-labs/clab-ui/host";
import { getApiBase } from "../api/endpoint";
import type { DeploymentProgress } from "../components/CanvasDeploymentProgress";

/** Only the slice of AppClabUiHost this hook needs — importing the full type
 * from ../host/createHost would create a circular import (createHost.ts
 * imports LifecycleCompletion from this file). */
interface LifecycleHost {
  emitTopoViewerEvent(event: ClabUiTopoViewerEvent): void;
  setLifecycleCancel?(cancel: (() => void) | null): void;
}

interface LabLifecycleOptions {
  host: LifecycleHost;
  fetchFiles: () => Promise<void>;
  /** One-shot running-labs status refresh, so deploy/destroy results appear
   * immediately instead of on the next SSE poll tick. */
  refreshStatus?: () => Promise<void>;
  refreshCanvas?: () => void;
  onValidationIssues?: (issues: ValidationIssue[]) => void;
  beforeDeploy?: () => Promise<boolean>;
  onDeploymentProgress?: (progress: DeploymentProgress) => void;
  onLifecycleFinished?: (result: LifecycleCompletion) => void;
}

export type LifecycleCompletion = {
  action: LifecycleAction;
  label: string;
  success: boolean;
  errorMessage?: string;
};

export type ValidationIssue = {
  severity: "error" | "warning";
  message: string;
  entityType: "node" | "link" | "topology";
  entityId?: string | null;
};

type LifecycleAction =
  | "up"
  | "down"
  | "initial"
  | "create-configs"
  | "restart"
  | "validate"
  | "collect";

/** POST /api/lab/lifecycle/stream and forward each output line to the
 * lifecycle log panel as it arrives. The final `done` frame carries the real
 * exit code; non-zero is surfaced as an error status. */
async function streamLifecycleCommand(
  action: LifecycleAction,
  sessionId: string,
  label: string,
  host: LifecycleHost,
  onProgress?: (progress: DeploymentProgress) => void,
  signal?: AbortSignal,
): Promise<{ issues: ValidationIssue[]; exitCode: number | null; errorMessage?: string }> {
  const res = await fetch(`${getApiBase()}/api/lab/lifecycle/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let validationIssues: ValidationIssue[] = [];
  let exitCode: number | null = null;
  let errorMessage: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const frame = JSON.parse(dataLine.slice(6));
      if (frame.progress) onProgress?.(frame.progress);
      if (frame.line !== undefined) {
        host.emitTopoViewerEvent({
          type: "lifecycleLog",
          line: frame.line,
          stream: frame.stream === "stderr" ? "stderr" : "stdout"
        });
      } else if (frame.done) {
        exitCode = typeof frame.code === "number" ? frame.code : 1;
        if (frame.code !== 0 && typeof frame.hint === "string") errorMessage = frame.hint;
        if (Array.isArray(frame.issues)) validationIssues = frame.issues;
        host.emitTopoViewerEvent(
          frame.code === 0
            ? { type: "lifecycleStatus", status: "success" }
            : { type: "lifecycleStatus", status: "error", errorMessage: errorMessage || `${label} exited with code ${frame.code}` }
        );
      } else if (frame.error) {
        errorMessage = frame.error;
        host.emitTopoViewerEvent({ type: "lifecycleStatus", status: "error", errorMessage: frame.error });
      }
    }
  }
  return { issues: validationIssues, exitCode, errorMessage };
}

export function useLabLifecycle({ host, fetchFiles, refreshStatus, refreshCanvas, onValidationIssues, beforeDeploy, onDeploymentProgress, onLifecycleFinished }: LabLifecycleOptions) {
  const { setProcessing } = useTopoViewerActions();

  const runLifecycle = useCallback(async (
    action: LifecycleAction,
    label: string,
    sid: string,
    processingKind: "deploy" | "destroy" = "deploy",
    refreshFiles = true
  ) => {
    if (action === "up" && beforeDeploy && !(await beforeDeploy())) return;
    setProcessing(true, processingKind);
    const controller = new AbortController();
    host.setLifecycleCancel?.(() => controller.abort());
    host.emitTopoViewerEvent({ type: "lifecycleLog", line: `Starting ${label}...`, stream: "stdout" });
    try {
      const result = await streamLifecycleCommand(action, sid, label, host, onDeploymentProgress, controller.signal);
      if (action === "validate") {
        onValidationIssues?.(result.issues);
        refreshCanvas?.();
      }
      const success = result.exitCode === 0 && !result.errorMessage;
      onLifecycleFinished?.({
        action,
        label,
        success,
        errorMessage: result.errorMessage || (!success ? `${label} exited with code ${result.exitCode ?? "unknown"}` : undefined),
      });
      if (refreshFiles) void fetchFiles();
      void refreshStatus?.();
    } catch (err) {
      const errorMessage = controller.signal.aborted
        ? `${label} cancelled by user`
        : err instanceof Error ? err.message : String(err);
      host.emitTopoViewerEvent({
        type: "lifecycleStatus",
        status: "error",
        errorMessage
      });
      onLifecycleFinished?.({ action, label, success: false, errorMessage });
    } finally {
      host.setLifecycleCancel?.(null);
    }
  }, [fetchFiles, refreshStatus, refreshCanvas, onValidationIssues, beforeDeploy, onDeploymentProgress, onLifecycleFinished, host, setProcessing]);

  const handleDeployLab = useCallback(
    (sid: string) => runLifecycle("up", "netlab up", sid, "deploy"),
    [runLifecycle]
  );
  const handleDestroyLab = useCallback(
    (sid: string) => runLifecycle("down", "netlab down", sid, "destroy"),
    [runLifecycle]
  );
  const handleNetlabInitial = useCallback(
    (sid: string) => runLifecycle("initial", "netlab initial", sid),
    [runLifecycle]
  );
  const handleNetlabCreateConfigs = useCallback(
    (sid: string) => runLifecycle("create-configs", "netlab create", sid),
    [runLifecycle]
  );
  const handleNetlabRestart = useCallback(
    (sid: string) => runLifecycle("restart", "netlab restart", sid),
    [runLifecycle]
  );
  const handleNetlabValidate = useCallback(
    (sid: string) => runLifecycle("validate", "netlab validate", sid, "deploy", false),
    [runLifecycle]
  );
  const handleNetlabCollect = useCallback(
    (sid: string) => runLifecycle("collect", "netlab collect", sid),
    [runLifecycle]
  );

  return {
    handleDeployLab,
    handleDestroyLab,
    handleNetlabInitial,
    handleNetlabCreateConfigs,
    handleNetlabRestart,
    handleNetlabValidate,
    handleNetlabCollect
  };
}
