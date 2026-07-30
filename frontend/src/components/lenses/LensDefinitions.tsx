import AltRouteOutlinedIcon from "@mui/icons-material/AltRouteOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DifferenceOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import NumbersOutlinedIcon from "@mui/icons-material/NumbersOutlined";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import type { ReactNode } from "react";

import type { LensId } from "./LensCanvasOverlay";

export const LENSES: Array<{ id: LensId; label: string; icon: ReactNode }> = [
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
