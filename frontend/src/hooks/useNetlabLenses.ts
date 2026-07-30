import { useCallback, useEffect, useMemo, useState } from "react";
import { useTopoViewerActions, useTopoViewerStore } from "@srl-labs/clab-ui";

import {
  api,
  type DeploymentNodeDetail,
  type DeploymentOverview,
  type DeployDiffResult,
  type LensBundleResult,
  type PathResult,
  type ReadinessResult,
  type TeachingDocument,
  type TourView,
} from "../api/client";
import type { AddressFamily, LensId, RoutingLayer } from "../components/lenses/LensCanvasOverlay";
import { DEMO_MODE } from "../lifecycle/types";

export function useNetlabLenses(sessionId: string, refreshKey?: string) {
  const canvasSelectedNode = useTopoViewerStore((state) => state.selectedNode);
  const canvasSelectedEdge = useTopoViewerStore((state) => state.selectedEdge);
  const topoActions = useTopoViewerActions();
  const [bundle, setBundle] = useState<LensBundleResult | null>(null);
  const [lens, setLens] = useState<LensId>("physical");
  const [family, setFamily] = useState<AddressFamily>("ipv4");
  const [hiddenAddressPools, setHiddenAddressPools] = useState<string[]>([]);
  const [routingLayers, setRoutingLayers] = useState<RoutingLayer[]>(["bgp"]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [teachingOpen, setTeachingOpen] = useState(false);
  const [teachingDoc, setTeachingDoc] = useState<TeachingDocument | null>(null);
  const [teachingMode, setTeachingMode] = useState<"author" | "present">("author");
  const [teachingIndex, setTeachingIndex] = useState(0);
  const [presentationRefs, setPresentationRefs] = useState<string[]>([]);
  const [dimOthers, setDimOthers] = useState(false);
  const [deployDiff, setDeployDiff] = useState<DeployDiffResult | null>(null);
  const [deployment, setDeployment] = useState<DeploymentOverview | null>(null);
  const [deploymentNode, setDeploymentNode] = useState<DeploymentNodeDetail | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [validationRunning, setValidationRunning] = useState(false);
  const [followedServiceRef, setFollowedServiceRef] = useState<string | null>(null);
  const [pathSource, setPathSource] = useState("");
  const [pathTarget, setPathTarget] = useState("");
  const [pathFamily, setPathFamily] = useState<AddressFamily>("ipv4");
  const [pathVrf, setPathVrf] = useState("default");
  const [pathResult, setPathResult] = useState<PathResult | null>(null);
  const [pathComputing, setPathComputing] = useState(false);
  const [readinessResult, setReadinessResult] = useState<ReadinessResult | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [configDiffOpen, setConfigDiffOpen] = useState(false);
  const [lensPanelActive, setLensPanelActive] = useState(false);
  const [overlayPinned, setOverlayPinned] = useState(() => {
    try { return window.localStorage.getItem("netlab-lens-overlay-pinned") === "1"; } catch { return false; }
  });
  const toggleOverlayPinned = useCallback(() => {
    setOverlayPinned((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("netlab-lens-overlay-pinned", next ? "1" : "0"); } catch { /* ignore persistence */ }
      return next;
    });
  }, []);
  // During a tour the canvas decorations must show regardless of which dock tab
  // is open — the presenter drives the canvas, not the Lenses panel.
  const presenting = teachingOpen && teachingMode === "present";
  // The overlay follows the Lenses tab (LensesPanel mount = tab active, since
  // clab-ui renders custom palette tabs lazily) unless the user pins it on.
  const overlayVisible = lensPanelActive || overlayPinned || presenting;
  const toggleAddressPool = useCallback((poolId: string) => {
    setHiddenAddressPools((current) =>
      current.includes(poolId) ? current.filter((id) => id !== poolId) : [...current, poolId]
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    if (DEMO_MODE) {
      setBundle(null);
      setLoading(false);
      setError("Netlab Lenses require a running netlab-ui backend. The browser-only demo can render and inspect the topology canvas, but it cannot run netlab's analysis endpoints.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const value = await api.getLenses(sessionId);
      setBundle(value);
      setFamily((current) =>
        value.addressing.families.includes(current)
          ? current
          : ((value.addressing.families[0] as AddressFamily | undefined) ?? "ipv4")
      );
      setRoutingLayers((current) => {
        const available = current.filter((layer) => value.controlPlane.availableLayers.includes(layer));
        return available.length === current.length ? current : available;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  /** Mark every lens's data as out of date — the topology behind it changed. */
  const invalidate = useCallback(() => setStale(true), []);

  const fetchDeployment = useCallback(async () => {
    if (!sessionId) {
      setDeployment(null);
      return;
    }
    if (DEMO_MODE) {
      setDeployment(null);
      setDeploymentLoading(false);
      return;
    }
    setDeploymentLoading(true);
    try {
      setDeployment(await api.getDeployment(sessionId));
    } catch {
      setDeployment(null);
    } finally {
      setDeploymentLoading(false);
    }
  }, [sessionId]);

  const applyDeploymentProgress = useCallback((progress: DeploymentOverview) => {
    setDeployment((current) => {
      const sameRun = current?.available && current.startedAt === progress.startedAt && current.action === progress.action;
      return {
        ...progress,
        nodes: sameRun ? { ...current.nodes, ...progress.nodes } : progress.nodes,
      };
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  // Every lens is derived from netlab's *transformed* topology, so an edit
  // invalidates all of them — but nothing here watches the topology, and
  // `refreshKey` only changes on a lab-tab switch. That is why a newly added
  // link used to render with no addressing until the page was reloaded.
  // `invalidate()` is called when a background `netlab create` completes.
  //
  // Deferred until the lens is actually on screen: the bundle endpoint runs
  // netlab's full analysis, and re-running it for a panel nobody is looking at
  // is pure cost. Flipping `overlayVisible` re-runs this, so opening the panel
  // later still picks the fresh data up.
  useEffect(() => {
    if (!stale || !overlayVisible) return;
    setStale(false);
    void refresh();
  }, [stale, overlayVisible, refresh]);

  useEffect(() => {
    if (lens === "deployment") void fetchDeployment();
  }, [fetchDeployment, lens]);

  useEffect(() => {
    if (lens !== "changes" || !sessionId) return;
    api.getDeployDiff(sessionId).then(setDeployDiff).catch(() => setDeployDiff(null));
  }, [lens, sessionId]);

  useEffect(() => {
    if (canvasSelectedNode) setSelectedRef(`node:${canvasSelectedNode}`);
    else if (canvasSelectedEdge && bundle) {
      const segment = bundle.addressing.segments.find((item) => item.physicalEdgeIds.includes(canvasSelectedEdge));
      setSelectedRef(segment?.id ?? `edge:${canvasSelectedEdge}`);
    }
  }, [bundle, canvasSelectedEdge, canvasSelectedNode]);

  const selectRef = useCallback(
    (ref: string) => {
      setSelectedRef(ref);
      if (ref.startsWith("node:")) {
        topoActions.selectNode(ref.slice(5));
        return;
      }
      if (!bundle) return;
      const segment = bundle.addressing.segments.find((item) => item.id === ref);
      const adjacency = bundle.controlPlane.adjacencies.find((item) => item.id === ref);
      const node = (segment?.nodeIds ?? adjacency?.nodeIds)?.[0];
      const edge = (segment?.physicalEdgeIds ?? adjacency?.physicalEdgeIds)?.[0];
      if (edge) topoActions.selectEdge(edge);
      else if (node) topoActions.selectNode(node);
    },
    [bundle, topoActions]
  );

  // Teaching document is fetched once per open (owned by the hook, not the tab
  // component) so switching dock tabs or closing the palette never resets the
  // author/present position — and the canvas reveal below keeps running.
  useEffect(() => {
    if (!teachingOpen || !sessionId) return;
    let cancelled = false;
    api.getTeaching(sessionId)
      .then((doc) => { if (!cancelled) { setTeachingDoc(doc); setTeachingIndex(0); setTeachingMode("author"); } })
      .catch(() => { if (!cancelled) setTeachingDoc(null); });
    return () => { cancelled = true; };
  }, [teachingOpen, sessionId]);

  // Presentation reveal: restore the canvas to the step's captured view — lens,
  // family, routing layers, spotlight mask and focus. Lives in the always-
  // mounted hook so it persists regardless of whether the Lenses tab (which
  // renders the authoring UI) is currently open.
  useEffect(() => {
    if (!presenting || !teachingDoc) {
      setPresentationRefs([]);
      setDimOthers(false);
      return;
    }
    const step = teachingDoc.steps[teachingIndex];
    if (!step) {
      setPresentationRefs([]);
      setDimOthers(false);
      return;
    }
    const view = step.view;
    setLens(view.lens);
    setFamily(view.family);
    setRoutingLayers(view.routingLayers as RoutingLayer[]);
    setPresentationRefs(view.revealRefs);
    setDimOthers(view.dimOthers);
    if (view.focusRef) selectRef(view.focusRef);
    // selectRef intentionally omitted: it is stable-ish and re-running on every
    // selection change would fight manual canvas clicks during a presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting, teachingDoc, teachingIndex]);

  // Snapshot the current canvas as a tour view. Reuses whatever is already
  // spotlighted (a followed service, a traced path) if present, else the current
  // selection — so authoring a step is just "arrange the canvas, then capture".
  const captureView = useCallback((): TourView => {
    let refs = presentationRefs;
    if (refs.length === 0) refs = selectedRef ? [selectedRef] : [];
    return {
      lens,
      family,
      routingLayers,
      revealRefs: refs,
      dimOthers: refs.length > 0,
      focusRef: selectedRef ?? refs[0] ?? null,
    };
  }, [lens, family, routingLayers, presentationRefs, selectedRef]);

  // Restore a captured view to the canvas (used to preview a step while
  // authoring — the present-mode effect does the same thing during playback).
  const applyView = useCallback((view: TourView) => {
    setLens(view.lens);
    setFamily(view.family);
    setRoutingLayers(view.routingLayers as RoutingLayer[]);
    setPresentationRefs(view.revealRefs);
    setDimOthers(view.dimOthers);
    if (view.focusRef) selectRef(view.focusRef);
  }, [selectRef]);

  const selectObjects = useCallback(
    (refs: string[]) => {
      const preferred = refs.find((ref) => ref.startsWith("node:")) ?? refs[0];
      if (preferred) selectRef(preferred);
      setReportOpen(false);
    },
    [selectRef]
  );

  // "Follow" a VLAN/VRF: isolate every node+edge in the service by reusing the
  // teaching dim mechanism (presentationRefs + dimOthers). Passing null clears.
  const followService = useCallback((ref: string | null) => {
    setFollowedServiceRef(ref);
    setPresentationRefs(ref ? [ref] : []);
    setDimOthers(Boolean(ref));
    if (ref) setSelectedRef(ref);
  }, []);

  // Leaving the Services lens (or opening teaching) drops any active follow so
  // the dim overlay never lingers on an unrelated lens.
  useEffect(() => {
    if (lens !== "services" && followedServiceRef) followService(null);
  }, [lens, followedServiceRef, followService]);

  // Run `netlab validate`, then refresh the lens bundle so per-test PASS/FAIL
  // overlays update. Returns the raw result so callers can toast the outcome.
  const runValidation = useCallback(async () => {
    if (!sessionId) return null;
    if (DEMO_MODE) {
      throw new Error("Validation requires a running netlab-ui backend.");
    }
    setValidationRunning(true);
    try {
      const result = await api.labValidate(sessionId);
      await refresh();
      return result;
    } finally {
      setValidationRunning(false);
    }
  }, [sessionId, refresh]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const addressResults = useMemo(() => {
    if (!bundle || !normalizedSearch) return [];
    return bundle.addressing.assignments
      .filter((assignment) =>
        `${assignment.address} ${assignment.node} ${assignment.interface} ${assignment.pool ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      )
      .slice(0, 12);
  }, [bundle, normalizedSearch]);

  // Seed the path pickers from the bundle: family from what's configured, VRF
  // to a sensible default, endpoints to the first two nodes so a click on
  // "Trace" works without setup.
  useEffect(() => {
    if (!bundle) return;
    const { reachability } = bundle;
    setPathFamily((current) => (reachability.families.includes(current) ? current : ((reachability.families[0] as AddressFamily) ?? "ipv4")));
    setPathVrf((current) => (reachability.vrfs.includes(current) ? current : (reachability.vrfs[0] ?? "default")));
    setPathSource((current) => (reachability.nodes.includes(current) ? current : (reachability.nodes[0] ?? "")));
    setPathTarget((current) => (reachability.nodes.includes(current) ? current : (reachability.nodes[reachability.nodes.length - 1] ?? "")));
  }, [bundle]);

  const computePath = useCallback(async () => {
    if (!sessionId || !pathSource || !pathTarget) return;
    if (DEMO_MODE) {
      setPathResult(null);
      return;
    }
    setPathComputing(true);
    try {
      const result = await api.getPath(sessionId, pathSource, pathTarget, pathFamily, pathVrf);
      setPathResult(result);
      // Highlight the whole path on canvas by isolating its objects.
      setPresentationRefs(result.objectRefs);
      setDimOthers(result.reachable);
    } finally {
      setPathComputing(false);
    }
  }, [sessionId, pathSource, pathTarget, pathFamily, pathVrf]);

  // Leaving the Paths lens clears the path highlight.
  useEffect(() => {
    if (lens !== "paths" && pathResult) {
      setPathResult(null);
      setPresentationRefs([]);
      setDimOthers(false);
    }
  }, [lens, pathResult]);

  const fetchReadiness = useCallback(async () => {
    if (!sessionId) return;
    if (DEMO_MODE) {
      setReadinessResult(null);
      setReadinessLoading(false);
      return;
    }
    setReadinessLoading(true);
    try {
      setReadinessResult(await api.getReadiness(sessionId));
    } catch {
      setReadinessResult(null);
    } finally {
      setReadinessLoading(false);
    }
  }, [sessionId]);

  // Auto-run the readiness checklist when the lens opens (and on refresh).
  useEffect(() => {
    if (lens === "readiness") void fetchReadiness();
  }, [lens, fetchReadiness, refreshKey]);

  const selectedSegment = bundle?.addressing.segments.find((item) => item.id === selectedRef);
  const selectedAdjacency = bundle?.controlPlane.adjacencies.find((item) => item.id === selectedRef);
  const selectedNode = selectedRef?.startsWith("node:") ? selectedRef.slice(5) : null;

  useEffect(() => {
    if (lens !== "deployment" || !sessionId || !selectedNode || !deployment?.available) {
      setDeploymentNode(null);
      return;
    }
    let cancelled = false;
    api.getDeploymentNode(sessionId, selectedNode)
      .then((detail) => { if (!cancelled) setDeploymentNode(detail); })
      .catch(() => { if (!cancelled) setDeploymentNode(null); });
    return () => { cancelled = true; };
  }, [deployment?.available, deployment?.currentTask, deployment?.done, deployment?.nodes, lens, selectedNode, sessionId]);

  return {
    sessionId,
    bundle,
    lens,
    setLens,
    family,
    setFamily,
    hiddenAddressPools,
    toggleAddressPool,
    routingLayers,
    setRoutingLayers,
    selectedRef,
    setSelectedRef,
    search,
    setSearch,
    loading,
    error,
    setError,
    reportOpen,
    setReportOpen,
    teachingOpen,
    setTeachingOpen,
    teachingDoc,
    setTeachingDoc,
    teachingMode,
    setTeachingMode,
    teachingIndex,
    setTeachingIndex,
    presenting,
    captureView,
    applyView,
    presentationRefs,
    setPresentationRefs,
    dimOthers,
    setDimOthers,
    deployDiff,
    deployment,
    deploymentNode,
    deploymentLoading,
    fetchDeployment,
    applyDeploymentProgress,
    validationRunning,
    runValidation,
    followedServiceRef,
    followService,
    pathSource,
    setPathSource,
    pathTarget,
    setPathTarget,
    pathFamily,
    setPathFamily,
    pathVrf,
    setPathVrf,
    pathResult,
    pathComputing,
    computePath,
    readinessResult,
    readinessLoading,
    fetchReadiness,
    configDiffOpen,
    setConfigDiffOpen,
    setLensPanelActive,
    overlayPinned,
    toggleOverlayPinned,
    overlayVisible,
    refresh,
    invalidate,
    selectRef,
    selectObjects,
    addressResults,
    selectedSegment,
    selectedAdjacency,
    selectedNode,
  };
}

export type NetlabLensesState = ReturnType<typeof useNetlabLenses>;
