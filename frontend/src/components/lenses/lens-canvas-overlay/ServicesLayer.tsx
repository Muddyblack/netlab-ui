import type { LensBundleResult } from "../../../api/client";
import type { CanvasGeometry } from "../useCanvasGeometry";
import { center, colorFor, interpolate } from "./helpers";
import { SvgLabel } from "./SvgLabel";

interface ServicesLayerProps {
  bundle: LensBundleResult;
  geometry: CanvasGeometry;
  selectedRef: string | null;
  onSelectRef: (ref: string) => void;
}

export function ServicesLayer({ bundle, geometry, selectedRef, onSelectRef }: ServicesLayerProps) {
  const explorer = bundle.serviceExplorer;
  const selectedVlanName = selectedRef?.startsWith("vlan:") ? selectedRef.slice(5) : null;
  const selectedVrfName = selectedRef?.startsWith("vrf:") ? selectedRef.slice(4) : null;
  const selectedVlan = explorer.vlans.find((item) => item.name === selectedVlanName) ?? null;
  const selectedVrf = explorer.vrfs.find((item) => item.name === selectedVrfName) ?? null;

  // VRF-colored rings on member nodes: always for the selected VRF, or a
  // light ring for every VRF-attached node when nothing is followed.
  const vrfRings = (selectedVrf ? [selectedVrf] : explorer.vrfs).flatMap((vrf) =>
    vrf.nodeIds.map((nodeName) => ({ vrf, nodeName }))
  );

  // VLAN bands: draw the followed VLAN across the links that carry it;
  // otherwise no bands (avoids a rainbow of every VLAN at once).
  const bandVlans = selectedVlan ? [selectedVlan] : [];

  return (
    <>
      {vrfRings.map(({ vrf, nodeName }) => {
        const node = geometry.nodes[nodeName];
        if (!node) return null;
        const color = colorFor(vrf.colorKey);
        return (
          <rect
            key={`vrf:${vrf.name}:${nodeName}`}
            x={node.x - 5}
            y={node.y - 5}
            width={node.width + 10}
            height={node.height + 10}
            rx={10}
            fill="none"
            stroke={color}
            strokeWidth={selectedVrf ? 3 : 1.5}
            strokeOpacity={selectedVrf ? 0.95 : 0.5}
            strokeDasharray={selectedVrf ? undefined : "4 4"}
          />
        );
      })}

      {bandVlans.flatMap((vlan) => {
        const color = colorFor(vlan.colorKey);
        return vlan.edges.flatMap((edge, edgeIndex) => {
          const [a, b] = edge.nodes;
          const left = center(geometry.nodes[a]);
          const right = center(geometry.nodes[b]);
          if (!left || !right) return [];
          const mid = interpolate(left, right, 0.5);
          return [
            <line
              key={`vlanband:${vlan.name}:${edgeIndex}`}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              stroke={color}
              strokeWidth={6}
              strokeOpacity={0.7}
              strokeDasharray={edge.mode === "trunk" ? "10 6" : undefined}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onClick={() => onSelectRef(`vlan:${vlan.name}`)}
            />,
            <SvgLabel
              key={`vlanlabel:${vlan.name}:${edgeIndex}`}
              point={mid}
              value={vlan.vni ? `VNI ${vlan.vni}` : `VLAN ${vlan.id ?? vlan.name}`}
              color={color}
              selected
            />,
          ];
        });
      })}

      {/* VXLAN tunnels for the followed VLAN — dashed overlay between VTEPs. */}
      {selectedVlan && explorer.tunnels
        .filter((tunnel) => tunnel.vlans.includes(selectedVlan.name))
        .map((tunnel, index) => {
          const source = center(geometry.nodes[tunnel.source]);
          const target = center(geometry.nodes[tunnel.target]);
          if (!source || !target) return null;
          return (
            <line
              key={`tunnel:${selectedVlan.name}:${index}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="#26c6da"
              strokeWidth={2}
              strokeDasharray="2 6"
              strokeOpacity={0.85}
            />
          );
        })}

      {/* Node service labels for context. */}
      {bundle.services.map((service) => {
        const node = geometry.nodes[service.node];
        const labels = [...service.services, ...service.vrfs.map((name) => `VRF:${name}`), ...service.vlans.map((name) => `VLAN:${name}`)];
        if (!node || !labels.length) return null;
        return (
          <SvgLabel
            key={service.node}
            point={{ x: node.centerX, y: node.y + node.height + 15 }}
            value={labels.join(" · ")}
            color={colorFor(labels.join("|"))}
          />
        );
      })}
    </>
  );
}
