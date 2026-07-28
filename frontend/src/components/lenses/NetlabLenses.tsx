import { Box } from "@mui/material";

import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import { ConfigDiffDialog } from "./ConfigDiffDialog";
import { DeploymentCanvasOverlay } from "./DeploymentCanvasOverlay";
import { LensCanvasOverlay } from "./LensCanvasOverlay";
import { ReportGallery } from "./ReportGallery";
import { TourPresenter } from "./TourPresenter";

interface NetlabLensesProps {
  sessionId: string;
  container: HTMLElement;
  state: NetlabLensesState;
  themeMode: "light" | "dark";
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

// Renders only the canvas-space decorations (colored links, badges, path flow)
// plus the two dialogs (report gallery, config compare). The lens picker,
// inspector and the teaching/presentation editor all live in the "Lenses" tab
// of the right-hand palette dock (see LensesPanel.tsx) — nothing sits on top of
// the canvas until a lens actually draws something on it.
export function NetlabLenses({ sessionId, container, state, themeMode, onToast }: NetlabLensesProps) {
  const { bundle, deployment, lens, family, hiddenAddressPools, routingLayers, selectedRef, selectRef, presentationRefs, dimOthers, pathResult, reportOpen, setReportOpen, selectObjects, configDiffOpen, setConfigDiffOpen, overlayVisible, presenting, teachingDoc, teachingIndex, setTeachingIndex, setTeachingMode } = state;

  return (
    <Box sx={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none", overflow: "hidden" }}>
      {bundle && lens !== "deployment" && overlayVisible && (
        <LensCanvasOverlay
          container={container}
          bundle={bundle}
          lens={lens}
          family={family}
          hiddenAddressPools={hiddenAddressPools}
          routingLayers={routingLayers}
          selectedRef={selectedRef}
          onSelectRef={selectRef}
          presentationRefs={presentationRefs}
          dimOthers={dimOthers}
          pathResult={pathResult}
        />
      )}

      {lens === "deployment" && deployment?.available && overlayVisible && (
        <DeploymentCanvasOverlay container={container} nodeStates={deployment.nodes} />
      )}

      <ReportGallery
        open={reportOpen}
        sessionId={sessionId}
        onClose={() => setReportOpen(false)}
        onSelectObjects={selectObjects}
        onToast={onToast}
      />

      <ConfigDiffDialog
        open={configDiffOpen}
        sessionId={sessionId}
        nodes={bundle?.reachability.nodes ?? []}
        themeMode={themeMode}
        onClose={() => setConfigDiffOpen(false)}
      />

      {presenting && teachingDoc && (
        <TourPresenter
          document={teachingDoc}
          index={teachingIndex}
          setIndex={setTeachingIndex}
          onExit={() => setTeachingMode("author")}
        />
      )}
    </Box>
  );
}
