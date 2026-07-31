import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { App as ClabUiApp } from "@srl-labs/clab-ui";
import type { createClabUiRuntime, ClabUiRuntime } from "@srl-labs/clab-ui/host";
import { NodeEditorSessionProvider } from "../node-editor/NodeEditorSessionContext";
import { TransformIndicator } from "../TransformIndicator";
import { AttractorEmptyState } from "../AttractorEmptyState";
import { INITIAL_GRAPH_DATA } from "../../icons";
import type { LabFileEntry } from "../../api/client";
import type { TopologyRef } from "../../hooks/useTabManager";

interface AppCanvasAreaProps {
  runtime: ReturnType<typeof createClabUiRuntime> | null;
  appRuntime: ClabUiRuntime;
  sessionId: string | null;
  transformRunning: boolean;
  activeFileTab: unknown;
  portalContainer: Element | null;
  labFiles: LabFileEntry[];
  handleOpenLab: (topoRef: TopologyRef, opts?: { fitView?: boolean }) => Promise<void>;
  navbarPortalContainer: HTMLElement | null;
  toolbarActions: ReactNode;
}

export function AppCanvasArea({
  runtime,
  appRuntime,
  sessionId,
  transformRunning,
  activeFileTab,
  portalContainer,
  labFiles,
  handleOpenLab,
  navbarPortalContainer,
  toolbarActions
}: AppCanvasAreaProps) {
  return (
    <>
      {runtime && (
        <NodeEditorSessionProvider value={sessionId}>
          <ClabUiApp
            initialData={INITIAL_GRAPH_DATA}
            runtime={appRuntime}
          />
        </NodeEditorSessionProvider>
      )}

      {sessionId && <TransformIndicator active={transformRunning} />}

      {!sessionId && !activeFileTab && portalContainer && createPortal(
        <AttractorEmptyState
          labs={labFiles}
          onOpenLab={(topologyRef) => void handleOpenLab(topologyRef)}
        />,
        portalContainer
      )}

      {navbarPortalContainer && createPortal(toolbarActions, navbarPortalContainer)}
    </>
  );
}
