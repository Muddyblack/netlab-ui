import { Box, Stack, Typography } from "@mui/material";

import type { ValidationIssue } from "../../hooks/useLabLifecycle";
import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import type { AddressFamily, LensId } from "./LensCanvasOverlay";
import {
  AddressingLensView,
  ChangesLensView,
  DeploymentPanel,
  PathExplorerPanel,
  PhysicalLensView,
  ReadinessPanel,
  RoutingLensView,
  SelectedSegmentSummary,
  ServiceExplorerPanel,
  ValidationDashboard,
} from "./lensViews";

type Bundle = NonNullable<NetlabLensesState["bundle"]>;

interface LensBundleContentProps {
  lens: LensId;
  bundle: Bundle;
  validationIssues: ValidationIssue[];
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  onRerunDeployment: (action: string) => void;
  onRunValidation: () => void;
  state: NetlabLensesState;
}

function LensBundleContent({ lens, bundle, validationIssues, onRunValidation, state }: LensBundleContentProps) {
  const {
    family, setFamily, search, setSearch, addressResults, hiddenAddressPools, toggleAddressPool,
    routingLayers, setRoutingLayers, selectedAdjacency, selectedRef, setSelectedRef,
    followedServiceRef, followService,
    pathSource, setPathSource, pathTarget, setPathTarget, pathFamily, setPathFamily, pathVrf, setPathVrf,
    pathResult, pathComputing, computePath,
    validationRunning, deployDiff, selectedSegment, selectedNode, selectRef,
  } = state;

  return (
    <Stack spacing={1.25}>
      {lens === "addressing" && (
        <AddressingLensView
          addressing={bundle.addressing}
          family={family as AddressFamily}
          setFamily={setFamily}
          search={search}
          setSearch={setSearch}
          addressResults={addressResults}
          hiddenAddressPools={hiddenAddressPools}
          toggleAddressPool={toggleAddressPool}
          onSelectRef={selectRef}
        />
      )}

      {lens === "routing" && (
        <RoutingLensView
          controlPlane={bundle.controlPlane}
          routingLayers={routingLayers}
          setRoutingLayers={setRoutingLayers}
          selectedAdjacency={selectedAdjacency}
          onSelectRef={selectRef}
        />
      )}

      {lens === "services" && (
        <ServiceExplorerPanel
          explorer={bundle.serviceExplorer}
          selectedRef={selectedRef}
          followedServiceRef={followedServiceRef}
          onFollow={followService}
          onSelectRef={selectRef}
        />
      )}

      {lens === "paths" && (
        <PathExplorerPanel
          reachability={bundle.reachability}
          source={pathSource}
          target={pathTarget}
          family={pathFamily}
          vrf={pathVrf}
          result={pathResult}
          computing={pathComputing}
          onSourceChange={setPathSource}
          onTargetChange={setPathTarget}
          onFamilyChange={setPathFamily}
          onVrfChange={setPathVrf}
          onCompute={() => void computePath()}
          onSwap={() => { setPathSource(pathTarget); setPathTarget(pathSource); }}
          onSelectRef={selectRef}
        />
      )}

      {lens === "validation" && (
        <ValidationDashboard
          validation={bundle.validation}
          validationIssues={validationIssues}
          selectedNode={selectedNode}
          running={validationRunning}
          onRun={onRunValidation}
          onSelectRef={selectRef}
        />
      )}

      {lens === "changes" && <ChangesLensView deployDiff={deployDiff} />}

      {selectedSegment && <SelectedSegmentSummary segment={selectedSegment} />}

      {lens === "physical" && (
        <PhysicalLensView
          selectedNode={selectedNode}
          selectedRef={selectedRef}
          setSelectedRef={setSelectedRef}
          derivationNodes={bundle.derivation.nodes}
        />
      )}
    </Stack>
  );
}

interface LensBodyProps {
  lens: LensId;
  bundle: Bundle | null;
  error: string | null;
  loading: boolean;
  validationIssues: ValidationIssue[];
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  onRerunDeployment: (action: string) => void;
  onRunValidation: () => void;
  state: NetlabLensesState;
}

export function LensBody({ lens, bundle, error, loading, validationIssues, onToast, onRerunDeployment, onRunValidation, state }: LensBodyProps) {
  const { deployment, deploymentNode, deploymentLoading, fetchDeployment, selectRef, readinessResult, readinessLoading, fetchReadiness, selectedNode, sessionId } = state;

  if (lens === "readiness") {
    return (
      <ReadinessPanel
        result={readinessResult}
        loading={readinessLoading}
        onRefresh={() => void fetchReadiness()}
        onSelectRef={selectRef}
      />
    );
  }

  if (lens === "deployment") {
    return (
      <DeploymentPanel
        sessionId={sessionId}
        deployment={deployment}
        selectedNode={selectedNode}
        selectedDetail={deploymentNode}
        loading={deploymentLoading}
        onRefresh={() => void fetchDeployment()}
        onRerun={() => deployment?.action && onRerunDeployment(deployment.action)}
        onSelectNode={(node) => selectRef(`node:${node}`)}
      />
    );
  }

  if (!bundle) {
    if (error || loading) return null;
    return <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No lens data yet.</Typography>;
  }

  return (
    <LensBundleContent
      lens={lens}
      bundle={bundle}
      validationIssues={validationIssues}
      onToast={onToast}
      onRerunDeployment={onRerunDeployment}
      onRunValidation={onRunValidation}
      state={state}
    />
  );
}

export function LensBodyContainer(props: LensBodyProps) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", pr: 0.25 }}>
      <LensBody {...props} />
    </Box>
  );
}
