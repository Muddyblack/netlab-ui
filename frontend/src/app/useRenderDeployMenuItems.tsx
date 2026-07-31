import { useCallback } from "react";
import { NetlabDeployMenuItems } from "../components/NetlabDeployMenuItems";
import { DEMO_MODE } from "../lifecycle/types";

interface UseRenderDeployMenuItemsOptions {
  sessionId: string | null;
  activeLabRunning: boolean;
  hasValidateTests: boolean | null;
  handleNetlabInitial: (sid: string) => Promise<void>;
  handleNetlabCreateConfigs: (sid: string) => Promise<void>;
  handleNetlabRestart: (sid: string) => Promise<void>;
  handleNetlabValidate: (sid: string) => Promise<void>;
  handleNetlabCollect: (sid: string) => Promise<void>;
}

export function useRenderDeployMenuItems({
  sessionId,
  activeLabRunning,
  hasValidateTests,
  handleNetlabInitial,
  handleNetlabCreateConfigs,
  handleNetlabRestart,
  handleNetlabValidate,
  handleNetlabCollect,
}: UseRenderDeployMenuItemsOptions) {
  return useCallback(
    ({ closeMenu }: { isViewerMode: boolean; closeMenu: () => void }) =>
      sessionId && !DEMO_MODE ? (
        <NetlabDeployMenuItems
          sessionId={sessionId}
          isRunning={activeLabRunning}
          hasTests={hasValidateTests}
          closeMenu={closeMenu}
          onInitial={() => void handleNetlabInitial(sessionId)}
          onCreate={() => void handleNetlabCreateConfigs(sessionId)}
          onRestart={() => void handleNetlabRestart(sessionId)}
          onValidate={() => void handleNetlabValidate(sessionId)}
          onCollect={() => void handleNetlabCollect(sessionId)}
        />
      ) : null,
    [sessionId, activeLabRunning, hasValidateTests, handleNetlabInitial, handleNetlabCreateConfigs, handleNetlabRestart, handleNetlabValidate, handleNetlabCollect]
  );
}
