import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DifferenceOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import SlideshowOutlinedIcon from "@mui/icons-material/SlideshowOutlined";
import SearchIcon from "@mui/icons-material/Search";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import NumbersOutlinedIcon from "@mui/icons-material/NumbersOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import AltRouteOutlinedIcon from "@mui/icons-material/AltRouteOutlined";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useState, type ReactNode } from "react";

import type { LensWarning } from "../../api/client";
import type { ValidationIssue } from "../../hooks/useLabLifecycle";
import type { NetlabLensesState } from "../../hooks/useNetlabLenses";
import type { LensId, RoutingLayer } from "./LensCanvasOverlay";
import { DiffView } from "../DiffView";
import { DerivationInspector } from "./DerivationInspector";
import { DeploymentPanel } from "./DeploymentPanel";
import { PathExplorerPanel } from "./PathExplorerPanel";
import { ReadinessPanel } from "./ReadinessPanel";
import { ServiceExplorerPanel } from "./ServiceExplorerPanel";
import { TourPanel } from "./TourPanel";
import { ValidationDashboard } from "./ValidationDashboard";

const LENSES: Array<{ id: LensId; label: string; icon: ReactNode }> = [
  { id: "physical", label: "Physical", icon: <HubOutlinedIcon /> },
  { id: "addressing", label: "Addressing", icon: <NumbersOutlinedIcon /> },
  { id: "routing", label: "Routing", icon: <RouteOutlinedIcon /> },
  { id: "services", label: "Services", icon: <LayersOutlinedIcon /> },
  { id: "paths", label: "Paths", icon: <AltRouteOutlinedIcon /> },
  { id: "deployment", label: "Deployment", icon: <CloudUploadOutlinedIcon /> },
  { id: "validation", label: "Validation", icon: <FactCheckOutlinedIcon /> },
  { id: "readiness", label: "Readiness", icon: <RocketLaunchOutlinedIcon /> },
  { id: "changes", label: "Changes", icon: <DifferenceOutlinedIcon /> },
];

const ROUTING_LAYERS: RoutingLayer[] = ["bgp", "ospf", "isis", "bfd", "evpn"];

function shortRef(ref: string): string {
  const [kind, value] = ref.split(":", 2);
  return value ? `${kind} · ${value}` : ref;
}

// Utilisation stays calm (accent fill, neutral %) until a pool is actually
// filling up — so a page of 0%-used pools doesn't read as a wall of warnings.
function poolTier(utilization: number, exhausted: boolean): { bar: string; emphasize: boolean } {
  if (exhausted || utilization >= 90) return { bar: "#ef4444", emphasize: true };
  if (utilization >= 70) return { bar: "#f59e0b", emphasize: true };
  return { bar: "#3b82f6", emphasize: false };
}

// Lens warnings used to sit at the bottom of the panel, below the fold once a
// few pool cards rendered — exactly the wrong place for the most urgent info.
// This banner sits at the top of a lens: a one-line success note when clean, a
// severity-tinted expandable summary when not.
function LensWarnings({ warnings, noun, emptyText, onSelectRef }: {
  warnings: LensWarning[];
  noun: string;
  emptyText: string;
  onSelectRef: (ref: string) => void;
}) {
  const [open, setOpen] = useState(warnings.length <= 4);
  if (!warnings.length) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <CheckCircleOutlinedIcon sx={{ fontSize: 15 }} color="success" />
        <Typography variant="caption" color="success.main">{emptyText}</Typography>
      </Stack>
    );
  }
  const severity = warnings.some((warning) => warning.severity === "error") ? "error" : "warning";
  const HeaderIcon = severity === "error" ? ErrorOutlineIcon : WarningAmberIcon;
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        borderColor: `${severity}.main`,
        bgcolor: (theme) => alpha(theme.palette[severity].main, 0.08),
      }}
    >
      <ButtonBase
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        sx={{ width: "100%", justifyContent: "flex-start", gap: 0.75, px: 1, py: 0.6 }}
      >
        <HeaderIcon fontSize="small" color={severity} />
        <Typography variant="body2" sx={{ fontWeight: 600, color: `${severity}.main`, flex: 1, textAlign: "left" }}>
          {warnings.length} {noun}{warnings.length === 1 ? "" : "s"}
        </Typography>
        <ExpandMoreIcon
          fontSize="small"
          sx={{ color: `${severity}.main`, transition: "transform 160ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </ButtonBase>
      <Collapse in={open}>
        <Stack sx={{ px: 0.5, pb: 0.5 }}>
          {warnings.map((warning) => (
            <Button
              key={warning.id}
              color={warning.severity === "error" ? "error" : "warning"}
              size="small"
              disabled={!warning.objectRefs.length}
              onClick={() => warning.objectRefs[0] && onSelectRef(warning.objectRefs[0])}
              sx={{ justifyContent: "flex-start", textAlign: "left", textTransform: "none", "&.Mui-disabled": { color: "text.primary" } }}
            >
              {warning.message}
            </Button>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}

// The netlab CLI can emit long multi-paragraph stderr (module warnings +
// a fatal error). Surface one line inline and let the rest stay collapsed
// so it never dominates a 330px-wide panel.
function LensError({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = message.split("\n").filter(Boolean);
  const headline = lines[0] ?? message;
  const rest = lines.slice(1).join("\n");

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Alert
      severity="error"
      icon={<ErrorOutlineIcon fontSize="small" />}
      action={
        <Tooltip title={copied ? "Copied" : "Copy error"}>
          <IconButton
            aria-label="Copy lens error"
            color="inherit"
            size="small"
            onClick={() => void copyMessage()}
            sx={{
              color: copied ? "success.main" : "inherit",
              mt: -0.25,
              transform: copied ? "scale(1.12)" : "scale(1)",
              transition: "color 160ms ease, transform 160ms ease",
            }}
          >
            <ContentCopyIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      }
      sx={{ alignItems: "flex-start" }}
    >
      <Typography variant="body2" sx={{ pr: 0.5, wordBreak: "break-word" }}>{headline}</Typography>
      {rest && (
        <>
          <Link component="button" variant="caption" onClick={() => setExpanded((value) => !value)} sx={{ mt: 0.5, display: "block" }}>
            {expanded ? "Hide details" : "Show details"}
          </Link>
          <Collapse in={expanded}>
            <Box
              component="pre"
              sx={{
                m: 0,
                mt: 0.75,
                p: 1,
                borderRadius: 1,
                bgcolor: "action.hover",
                maxHeight: 220,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {rest}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}

interface LensesPanelProps {
  state: NetlabLensesState;
  validationIssues: ValidationIssue[];
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  onRerunDeployment: (action: string) => void;
}

export function LensesPanel({ state, validationIssues, onToast, onRerunDeployment }: LensesPanelProps) {
  const {
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
    setReportOpen,
    teachingOpen,
    setTeachingOpen,
    teachingDoc,
    setTeachingDoc,
    setTeachingMode,
    teachingIndex,
    setTeachingIndex,
    captureView,
    applyView,
    deployDiff,
    deployment,
    deploymentNode,
    deploymentLoading,
    fetchDeployment,
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
    setConfigDiffOpen,
    setLensPanelActive,
    overlayPinned,
    toggleOverlayPinned,
    refresh,
    selectRef,
    addressResults,
    selectedSegment,
    selectedAdjacency,
    selectedNode,
  } = state;

  const [poolsOpen, setPoolsOpen] = useState(true);
  const poolsForFamily = bundle ? bundle.addressing.pools.filter((pool) => pool.family === family) : [];

  // Warning counts surface on the lens tabs themselves, so a conflict is
  // visible before the lens is even opened — no scroll position can hide it.
  const badgeFor = (warnings: LensWarning[]) => (warnings.length
    ? { count: warnings.length, severity: warnings.some((warning) => warning.severity === "error") ? "error" as const : "warning" as const }
    : undefined);
  const lensBadges: Partial<Record<LensId, { count: number; severity: "error" | "warning" }>> = bundle
    ? { addressing: badgeFor(bundle.addressing.warnings), routing: badgeFor(bundle.controlPlane.warnings) }
    : {};

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

  const handleRunValidation = async () => {
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
  };

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.25, height: "100%", minHeight: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <Box sx={{ flexShrink: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Netlab Lenses</Typography>
            {bundle && (
              <Typography variant="caption" color="text.secondary">
                Revision {bundle.revision} · Netlab {bundle.netlabVersion ?? "unknown"}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
            <Tooltip title="Interactive reports"><IconButton size="small" onClick={() => setReportOpen(true)}><ArticleOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Compare node configs"><IconButton size="small" onClick={() => setConfigDiffOpen(true)}><DifferenceOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title={overlayPinned ? "Overlay pinned — stays on other tabs" : "Pin overlay to keep it when you leave Lenses"}><IconButton size="small" color={overlayPinned ? "warning" : "default"} onClick={toggleOverlayPinned}><PushPinOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Guided tour"><IconButton size="small" color={teachingOpen ? "warning" : "default"} onClick={() => setTeachingOpen((open) => !open)}><SlideshowOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Refresh lens data"><span><IconButton size="small" disabled={loading} onClick={() => void refresh()}>{loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}</IconButton></span></Tooltip>
          </Stack>
        </Stack>
        {!teachingOpen && (
          <Box
            role="tablist"
            aria-label="Netlab lens"
            sx={{ mt: 1, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 0.5 }}
          >
            {LENSES.map((item) => {
              const active = lens === item.id;
              const badge = lensBadges[item.id];
              return (
                <ButtonBase
                  key={item.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setLens(item.id)}
                  sx={{
                    justifyContent: "flex-start",
                    gap: 0.75,
                    px: 1,
                    py: 0.55,
                    borderRadius: 1.5,
                    border: "1px solid",
                    borderColor: active ? "primary.main" : "divider",
                    bgcolor: active ? "action.selected" : "transparent",
                    color: active ? "primary.main" : "text.secondary",
                    transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
                    "& .MuiSvgIcon-root": { fontSize: 18, flexShrink: 0 },
                    "&:hover": {
                      bgcolor: "action.hover",
                      borderColor: active ? "primary.main" : "text.disabled",
                      color: active ? "primary.main" : "text.primary",
                    },
                  }}
                >
                  {item.icon}
                  <Box
                    component="span"
                    sx={{ fontSize: "0.78rem", fontWeight: active ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {item.label}
                  </Box>
                  {badge && (
                    <Box
                      component="span"
                      aria-label={`${badge.count} warning${badge.count === 1 ? "" : "s"}`}
                      sx={{
                        ml: "auto",
                        flexShrink: 0,
                        minWidth: 16,
                        height: 16,
                        px: 0.4,
                        borderRadius: 999,
                        bgcolor: `${badge.severity}.main`,
                        color: `${badge.severity}.contrastText`,
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        lineHeight: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {badge.count}
                    </Box>
                  )}
                </ButtonBase>
              );
            })}
          </Box>
        )}
      </Box>

      {error && !teachingOpen && lens !== "readiness" && lens !== "deployment" && (
        <Box sx={{ flexShrink: 0 }}>
          <LensError message={error} />
          <Button size="small" startIcon={<FactCheckOutlinedIcon />} onClick={() => setLens("readiness")} sx={{ mt: 0.5, textTransform: "none" }}>
            Why won&apos;t it build? Open Readiness
          </Button>
        </Box>
      )}

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
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", pr: 0.25 }}>
        {/* Readiness has its own endpoint that explains transform failures, so
            it must render even when the lens bundle itself failed to build. */}
        {lens === "readiness" && (
          <ReadinessPanel
            result={readinessResult}
            loading={readinessLoading}
            onRefresh={() => void fetchReadiness()}
            onSelectRef={selectRef}
          />
        )}

        {lens === "deployment" && (
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
        )}

        {lens !== "readiness" && lens !== "deployment" && !bundle && !error && !loading && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No lens data yet.</Typography>
        )}

        {lens !== "readiness" && lens !== "deployment" && bundle && (
          <Stack spacing={1.25}>
            {lens === "addressing" && (
              <Stack spacing={1.25}>
                <LensWarnings
                  warnings={bundle.addressing.warnings}
                  noun="addressing conflict"
                  emptyText="No addressing conflicts found."
                  onSelectRef={selectRef}
                />
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={family}
                  onChange={(_event, value) => value && setFamily(value)}
                  aria-label="Address family"
                  sx={{ alignSelf: "flex-start", "& .MuiToggleButton-root": { px: 1.25, py: 0.4, textTransform: "none", fontWeight: 600 } }}
                >
                  {bundle.addressing.families.map((value) => <ToggleButton key={value} value={value}>{value.toUpperCase()}</ToggleButton>)}
                </ToggleButtonGroup>
                <TextField
                  size="small"
                  placeholder="Find IP, prefix, node, pool…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
                />
                {addressResults.map((assignment) => (
                  <Button key={assignment.id} size="small" variant="text" onClick={() => selectRef(`node:${assignment.node}`)} sx={{ justifyContent: "flex-start", textTransform: "none" }}>
                    {assignment.address} · {assignment.node} {assignment.interface}
                  </Button>
                ))}
                <Box>
                  <ButtonBase
                    onClick={() => setPoolsOpen((open) => !open)}
                    aria-expanded={poolsOpen}
                    sx={{ width: "100%", justifyContent: "space-between", borderRadius: 1, px: 0.5, py: 0.25, color: "text.secondary", "&:hover": { bgcolor: "action.hover", color: "text.primary" } }}
                  >
                    <Typography variant="overline" sx={{ letterSpacing: 0.4 }}>Address pools · {poolsForFamily.length}</Typography>
                    <ExpandMoreIcon fontSize="small" sx={{ transition: "transform 160ms ease", transform: poolsOpen ? "rotate(0deg)" : "rotate(-90deg)" }} />
                  </ButtonBase>
                  <Collapse in={poolsOpen}>
                    <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                      {poolsForFamily.map((pool) => {
                        const tier = poolTier(pool.utilization, pool.exhausted);
                        const hidden = hiddenAddressPools.includes(pool.id);
                        return (
                          <Paper key={pool.id} variant="outlined" sx={{ p: 1, borderRadius: 2, opacity: hidden ? 0.55 : 1 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Typography variant="body2" fontWeight={600} sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pool.name}</Typography>
                              <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexShrink: 0 }}>
                                <Typography variant="caption" sx={{ fontWeight: tier.emphasize ? 700 : 600, color: tier.emphasize ? tier.bar : "text.secondary" }}>{pool.utilization}%</Typography>
                                <Tooltip title={hidden ? `Show ${pool.name} on canvas` : `Hide ${pool.name} from canvas`}>
                                  <IconButton size="small" aria-label={hidden ? `Show ${pool.name}` : `Hide ${pool.name}`} onClick={() => toggleAddressPool(pool.id)} sx={{ p: 0.35 }}>
                                    {hidden ? <VisibilityOffIcon sx={{ fontSize: 17 }} /> : <VisibilityIcon sx={{ fontSize: 17 }} />}
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">{pool.network} · {pool.usedSubnets}/{pool.subnetCapacity} prefixes</Typography>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(100, pool.utilization)}
                              sx={{ mt: 0.75, height: 6, borderRadius: 3, bgcolor: "action.hover", "& .MuiLinearProgress-bar": { borderRadius: 3, backgroundColor: tier.bar } }}
                            />
                          </Paper>
                        );
                      })}
                      {poolsForFamily.length === 0 && <Typography variant="caption" color="text.secondary">No pools for this family.</Typography>}
                    </Stack>
                  </Collapse>
                </Box>
              </Stack>
            )}

            {lens === "routing" && (
              <Stack spacing={1.25}>
                <LensWarnings
                  warnings={bundle.controlPlane.warnings}
                  noun="control-plane warning"
                  emptyText="No control-plane warnings."
                  onSelectRef={selectRef}
                />
                <Typography variant="overline" color="text.secondary">Control-plane overlays</Typography>
                <Stack direction="row" gap={0.75} flexWrap="wrap">
                  {ROUTING_LAYERS.map((layer) => {
                    const available = bundle.controlPlane.availableLayers.includes(layer);
                    const active = routingLayers.includes(layer);
                    return <Chip key={layer} size="small" label={layer.toUpperCase()} disabled={!available} color={active ? "warning" : "default"} variant={active ? "filled" : "outlined"} onClick={() => available && setRoutingLayers((layers) => active ? layers.filter((item) => item !== layer) : [...layers, layer])} />;
                  })}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  iBGP uses dashed paths; eBGP uses solid paths. Each AS, OSPF area, and IS-IS area gets a shaded domain bubble. RR, ABR, and passive state appear as badges.
                </Typography>
                {selectedAdjacency ? (
                  <Paper variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="subtitle2">{selectedAdjacency.protocol.toUpperCase()} · {selectedAdjacency.sessionType}</Typography>
                    <Typography variant="caption" color="text.secondary">{selectedAdjacency.nodeIds.join(" ↔ ")}</Typography>
                    {selectedAdjacency.explanation.map((line) => <Typography key={line} variant="body2" sx={{ mt: 1 }}>{line}</Typography>)}
                    <Typography variant="overline" display="block" color="text.secondary" sx={{ mt: 1 }}>Resolved settings</Typography>
                    <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "action.hover", overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>{selectedAdjacency.resolvedYaml}</Box>
                    <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 1 }}>{selectedAdjacency.yamlPaths.map((path) => <Chip key={path} size="small" variant="outlined" label={path} />)}</Stack>
                  </Paper>
                ) : <Typography variant="body2" color="text.secondary">Select an overlay path for derived settings and relevant YAML paths.</Typography>}
              </Stack>
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
                onRun={() => void handleRunValidation()}
                onSelectRef={selectRef}
              />
            )}

            {lens === "changes" && (
              <Stack spacing={1.25}>
                <Typography variant="body2" color="text.secondary">Changes since the last successful deploy baseline.</Typography>
                {deployDiff?.baselineExists ? (
                  <>
                    <Chip label={deployDiff.changed ? "Deployment changes pending" : "Matches deployed baseline"} color={deployDiff.changed ? "warning" : "success"} />
                    <DiffView diff={deployDiff.diff || "No changes"} maxHeight={320} fontSize={11} />
                  </>
                ) : <Alert severity="info">Deploy once to establish a comparison baseline.</Alert>}
              </Stack>
            )}

            {selectedSegment && (
              <Stack spacing={0.75}>
                <Divider />
                <Typography variant="overline" color="text.secondary">Selected segment</Typography>
                <Typography variant="body2">{selectedSegment.nodeIds.join(" ↔ ")}</Typography>
                <Stack direction="row" gap={0.5} flexWrap="wrap">{Object.entries(selectedSegment.prefixes).map(([key, value]) => <Chip key={key} size="small" label={`${key} ${value}`} />)}</Stack>
                <Chip size="small" variant="outlined" label={`${selectedSegment.assignmentOrigin} assignment`} />
              </Stack>
            )}
            {lens === "physical" && (
              selectedNode ? (
                <Stack spacing={1}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="body2">Selected {shortRef(selectedRef!)}</Typography>
                    <Button size="small" onClick={() => setSelectedRef(null)}>Clear</Button>
                  </Stack>
                  <Divider />
                  <DerivationInspector node={bundle.derivation.nodes.find((item) => item.node === selectedNode)} />
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Select a node to inspect how netlab derived its settings — authored vs inherited vs computed.
                </Typography>
              )
            )}
          </Stack>
        )}
      </Box>
      )}
    </Box>
  );
}
