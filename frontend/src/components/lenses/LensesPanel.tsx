import { Box } from "@mui/material";
import { useEffect } from "react";

import type { ValidationIssue } from "../../hooks/useLabLifecycle";
import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import { LensBodyContainer } from "./LensBody";
import { LensErrorBanner, LensesPanelHeader, TourPanel } from "./lensViews";

interface LensesPanelProps {
  state: NetlabLensesState;
  validationIssues: ValidationIssue[];
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  onRerunDeployment: (action: string) => void;
}

async function runValidationAndReport(
  runValidation: NetlabLensesState["runValidation"],
  onToast: LensesPanelProps["onToast"]
) {
  try {
    const result = await runValidation();
    if (!result) return;
    const failures = result.issues.filter((issue) => issue.severity === "error").length;
    if (failures) {
      onToast(`Validation finished — ${failures} problem${failures === 1 ? "" : "s"} found`, "warning");
    } else if (result.code !== 0) {
      // netlab exited non-zero without a mappable issue — almost always
      // "no running lab" (validation needs a deployed topology).
      const hint = /snapshot|no lab|not.*start|running/i.test(result.stderr)
        ? "Deploy the lab first — validation runs against a running topology."
        : (result.stderr.split("\n").find(Boolean) ?? "Validation could not complete.");
      onToast(hint, "warning");
    } else {
      onToast("Validation passed", "success");
    }
  } catch (runError) {
    onToast(`Validation failed to run: ${runError instanceof Error ? runError.message : String(runError)}`, "error");
  }
}

export function LensesPanel({ state, validationIssues, onToast, onRerunDeployment }: LensesPanelProps) {
  const {
    sessionId, bundle, lens, setLens, error, loading, setReportOpen,
    teachingOpen, setTeachingOpen, teachingDoc, setTeachingDoc, setTeachingMode, teachingIndex, setTeachingIndex,
    captureView, applyView, runValidation, setConfigDiffOpen, setLensPanelActive,
    overlayPinned, toggleOverlayPinned, refresh, selectedRef,
  } = state;

  // Mount = the Lenses palette tab is active (clab-ui renders custom tabs
  // lazily), which tells the always-mounted canvas overlay to show/hide with
  // the tab — unless the user has pinned it on.
  useEffect(() => {
    setLensPanelActive(true);
    return () => setLensPanelActive(false);
  }, [setLensPanelActive]);

  // clab-ui automatically opens its Info tab whenever a canvas node/link is
  // selected. When the user is actively working in our Lenses tab, keep the
  // dock anchored here and let the lens panel consume the selection instead.
  useEffect(() => {
    if (!selectedRef) return;
    window.setTimeout(() => {
      const lensesTab = document.querySelector<HTMLElement>('[data-testid="panel-tab-netlab-lenses"]');
      if (lensesTab?.getAttribute("aria-selected") !== "true") lensesTab?.click();
    }, 0);
  }, [selectedRef]);

  const showErrorBanner = isErrorBannerVisible(error, teachingOpen, lens);

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.25, height: "100%", minHeight: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <LensesPanelHeader
        bundle={bundle}
        lens={lens}
        setLens={setLens}
        teachingOpen={teachingOpen}
        setTeachingOpen={setTeachingOpen}
        overlayPinned={overlayPinned}
        toggleOverlayPinned={toggleOverlayPinned}
        loading={loading}
        refresh={refresh}
        onOpenReport={() => setReportOpen(true)}
        onOpenConfigDiff={() => setConfigDiffOpen(true)}
      />

      {showErrorBanner && <LensErrorBanner error={error!} onOpenReadiness={() => setLens("readiness")} />}

      {teachingOpen ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <TourPanel
            sessionId={sessionId}
            document={teachingDoc}
            setDocument={setTeachingDoc}
            currentIndex={teachingIndex}
            setCurrentIndex={setTeachingIndex}
            setMode={setTeachingMode}
            captureView={captureView}
            applyView={applyView}
            onClose={() => setTeachingOpen(false)}
            onToast={onToast}
          />
        </Box>
      ) : (
        <LensBodyContainer
          lens={lens}
          bundle={bundle}
          error={error}
          loading={loading}
          validationIssues={validationIssues}
          onToast={onToast}
          onRerunDeployment={onRerunDeployment}
          onRunValidation={() => void runValidationAndReport(runValidation, onToast)}
          state={state}
        />
      )}
    </Box>
  );
}

function isErrorBannerVisible(error: string | null, teachingOpen: boolean, lens: NetlabLensesState["lens"]): boolean {
  if (!error || teachingOpen) return false;
  return lens !== "readiness" && lens !== "deployment";
}
