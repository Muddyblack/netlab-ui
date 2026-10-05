import { useId } from "react";

export type MascotState = "idle" | "thinking" | "sleeping" | "alarm" | "offline" | "giggle" | "idea" | "stressed" | "hustle";

interface MascotPalette {
  local: string;
  localDark: string;
  peer: string;
  peerDark: string;
  link: string;
  linkHot: string;
  eye: string;
  pupil: string;
  led: string;
}

const IDLE_PALETTE: MascotPalette = {
  local: "#ffba42", localDark: "#d26400", peer: "#e88e2a",
  peerDark: "#a04a00", link: "#e88e2a", linkHot: "#ff9f01",
  eye: "#fff8ec", pupil: "#5a2a00", led: "#4ade80",
};
const SLEEPING_PALETTE: MascotPalette = {
  local: "#8a7a60", localDark: "#5a4e3a", peer: "#6b5a42",
  peerDark: "#3a3020", link: "#5a4e3a", linkHot: "#5a4e3a",
  eye: "#c8bfa8", pupil: "#3a3020", led: "#5a4e3a",
};
const ALARM_PALETTE: MascotPalette = {
  local: "#e0453f", localDark: "#7a1414", peer: "#b21a1a",
  peerDark: "#5a0a0a", link: "#c73a3a", linkHot: "#ff5252",
  eye: "#fff0ee", pupil: "#4a1010", led: "#ff5252",
};

function getMascotVisuals(state: MascotState): {
  alarm: boolean;
  sleeping: boolean;
  thinking: boolean;
  giggle: boolean;
  stateClass: string;
  stateName: string;
  stateLabel: string;
  palette: MascotPalette;
} {
  const alarm = state === "alarm";
  const sleeping = state === "sleeping" || state === "offline";
  const thinking = state === "thinking";
  const giggle = state === "giggle";

  if (alarm) return { alarm, sleeping, thinking, giggle, stateClass: "bg-alarm", stateName: "Idle↔Idle", stateLabel: "session flapping", palette: ALARM_PALETTE };
  if (sleeping) return { alarm, sleeping, thinking, giggle, stateClass: "bg-sleep", stateName: "Idle*", stateLabel: "admin down", palette: SLEEPING_PALETTE };
  if (thinking) return { alarm, sleeping, thinking, giggle, stateClass: "bg-think", stateName: "OpenSent", stateLabel: "negotiating", palette: IDLE_PALETTE };
  if (giggle) return { alarm, sleeping, thinking, giggle, stateClass: "bg-giggle", stateName: "Established", stateLabel: "giggling", palette: IDLE_PALETTE };
  if (state === "idea") return { alarm, sleeping, thinking, giggle, stateClass: "bg-idea", stateName: "UPDATE", stateLabel: "had an idea", palette: IDLE_PALETTE };
  if (state === "stressed") return { alarm, sleeping, thinking, giggle, stateClass: "bg-stress", stateName: "Active", stateLabel: "stressed", palette: IDLE_PALETTE };
  if (state === "hustle") return { alarm, sleeping, thinking, giggle, stateClass: "bg-hustle", stateName: "Converging", stateLabel: "hard at work", palette: IDLE_PALETTE };
  return { alarm, sleeping, thinking, giggle, stateClass: "", stateName: "Established", stateLabel: "session established", palette: IDLE_PALETTE };
}

function MascotFace({ state, alarm, sleeping, giggle, palette }: { state: MascotState; alarm: boolean; sleeping: boolean; giggle: boolean; palette: MascotPalette }) {
  if (state === "idea") {
    return (
      <g>
        {/* eyes looking up at a light bulb that pops on */}
        <rect x="8.5" y="14.5" width="4.5" height="5.8" rx="2" fill={palette.eye} />
        <rect x="16" y="14.5" width="4.5" height="5.8" rx="2" fill={palette.eye} />
        <circle cx="10.75" cy="16" r="1.15" fill={palette.pupil} />
        <circle cx="18.25" cy="16" r="1.15" fill={palette.pupil} />
        <path d="M 12.5 22.4 Q 14.5 24.2 16.5 22.4" stroke={palette.eye} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.85" />
        <g className="bg-bulb">
          <g stroke="#ffe27a" strokeWidth="0.9" strokeLinecap="round" className="bg-bulb-rays">
            <line x1="14.5" y1="-6.6" x2="14.5" y2="-8.4" />
            <line x1="9.8" y1="-4.6" x2="8.5" y2="-5.9" />
            <line x1="19.2" y1="-4.6" x2="20.5" y2="-5.9" />
          </g>
          <circle cx="14.5" cy="-2.6" r="3" fill="#ffe27a" filter="url(#bg-bulb-glow)" />
          <rect x="12.9" y="0" width="3.2" height="1.8" rx="0.5" fill="#c9a23a" />
        </g>
      </g>
    );
  }
  if (state === "stressed") {
    return (
      <g>
        {/* wide worried eyes, tiny pupils, wobbly mouth and a falling sweat drop */}
        <g className="bg-brow" stroke={palette.pupil} strokeWidth="1.3" strokeLinecap="round">
          <path d="M 8 13.4 L 12.4 12" />
          <path d="M 21 13.4 L 16.6 12" />
        </g>
        <circle cx="10.75" cy="17.2" r="2.7" fill={palette.eye} />
        <circle cx="18.25" cy="17.2" r="2.7" fill={palette.eye} />
        <circle cx="10.75" cy="17.2" r="0.8" fill={palette.pupil} />
        <circle cx="18.25" cy="17.2" r="0.8" fill={palette.pupil} />
        <path d="M 10.8 23 Q 12.2 21.6 13.6 23 T 16.4 23 T 19 23" stroke={palette.eye} strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.9" />
        <path className="bg-sweat" d="M 23 8.5 Q 24.6 11.4 23 12.2 Q 21.4 11.4 23 8.5 Z" fill="#8ad4ff" />
      </g>
    );
  }
  if (state === "hustle") {
    return (
      <g>
        {/* focused narrow eyes scanning, determined brows, speed lines on the left */}
        <g stroke={palette.pupil} strokeWidth="1.3" strokeLinecap="round">
          <path d="M 8 13.6 L 13 14.6" />
          <path d="M 21 13.6 L 16 14.6" />
        </g>
        <rect x="8.5" y="15.4" width="4.5" height="3.6" rx="1.4" fill={palette.eye} />
        <rect x="16" y="15.4" width="4.5" height="3.6" rx="1.4" fill={palette.eye} />
        <g className="bg-pupil">
          <circle cx="10.75" cy="17.2" r="1.1" fill={palette.pupil} />
          <circle cx="18.25" cy="17.2" r="1.1" fill={palette.pupil} />
        </g>
        <path d="M 12 22.4 L 17 22.4" stroke={palette.eye} strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
        <g className="bg-speed" stroke={palette.eye} strokeWidth="0.9" strokeLinecap="round" opacity="0.7">
          <line x1="-3" y1="9" x2="0.5" y2="9" />
          <line x1="-4" y1="14" x2="0" y2="14" />
          <line x1="-3" y1="19" x2="0.5" y2="19" />
        </g>
      </g>
    );
  }
  if (giggle) {
    return (
      <g>
        {/* happy squinting eyes (^ ^), blushing cheeks and an open laughing mouth */}
        <g stroke={palette.eye} strokeWidth="1.8" strokeLinecap="round" fill="none">
          <path d="M 8.3 18 Q 10.75 13.8 13.2 18" />
          <path d="M 15.8 18 Q 18.25 13.8 20.7 18" />
        </g>
        <g fill="#ff7a59" opacity="0.45">
          <circle cx="7.6" cy="20.6" r="1.4" />
          <circle cx="21.4" cy="20.6" r="1.4" />
        </g>
        <path className="bg-laugh" d="M 11.6 20.4 Q 14.5 25 17.4 20.4 Z" fill={palette.pupil} />
      </g>
    );
  }
  if (alarm) {
    return (
      <g>
        <g className="bg-brow" stroke={palette.pupil} strokeWidth="1.4" strokeLinecap="round">
          <path d="M 8 13.8 L 12.2 15" />
          <path d="M 20 13.8 L 15.8 15" />
        </g>
        <rect className="bg-eye" x="8.5" y="15.5" width="4.5" height="5.2" rx="1.8" fill={palette.eye} />
        <rect className="bg-eye" x="16" y="15.5" width="4.5" height="5.2" rx="1.8" fill={palette.eye} />
        <g className="bg-pupil">
          <circle cx="10.75" cy="18.1" r="1.2" fill={palette.pupil} />
          <circle cx="18.25" cy="18.1" r="1.2" fill={palette.pupil} />
        </g>
      </g>
    );
  }
  if (sleeping) {
    return (
      <g>
        <g stroke={palette.eye} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.8">
          <path d="M 8.5 17 Q 11 19 13.5 17" />
          <path d="M 15.5 17 Q 18 19 20.5 17" />
        </g>
        <g fill={palette.eye} fontFamily="sans-serif" fontWeight="700" opacity="0.55">
          <text className="bg-zzz" x="22" y="5" fontSize="3.5">z</text>
          <text className="bg-zzz bg-zzz-b" x="25" y="2.2" fontSize="2.6">z</text>
        </g>
      </g>
    );
  }
  return (
    <g>
      <rect className="bg-eye" x="8.5" y="14.5" width="4.5" height="5.8" rx="2" fill={palette.eye} />
      <rect className="bg-eye" x="16" y="14.5" width="4.5" height="5.8" rx="2" fill={palette.eye} />
      <g className="bg-pupil">
        <circle cx="10.75" cy="17.4" r="1.15" fill={palette.pupil} />
        <circle cx="18.25" cy="17.4" r="1.15" fill={palette.pupil} />
      </g>
    </g>
  );
}

/**
 * Nettie v3.1 — Compact Square BGP Session Mascot (1:1 aspect ratio).
 *
 * Refactored to a 40x40 1:1 square viewBox so the main router character
 * is ~65% larger at small icon sizes (24px - 32px), eliminating horizontal
 * waste while preserving the complete BGP neighbor session model.
 */
export function NetlabMascot({
  size = 32,
  state = "idle",
  showCaption = true,
  title = "netlab assistant",
}: {
  size?: number;
  state?: MascotState;
  showCaption?: boolean;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const ids = {
    localGrad: `bg-lg-${uid}`,
    peerGrad: `bg-pg-${uid}`,
    glow: `bg-gl-${uid}`,
  };

  const { alarm, sleeping, giggle, stateClass, stateName, stateLabel, palette } = getMascotVisuals(state);
  const face = <MascotFace state={state} alarm={alarm} sleeping={sleeping} giggle={giggle} palette={palette} />;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${title} \u2014 ${stateLabel}`}
      className={`bg ${stateClass}`}
      style={{ display: "block", flexShrink: 0, overflow: "visible" }}
    >
      <defs>
        <linearGradient id={ids.localGrad} x1="3" y1="4" x2="25" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={palette.local} />
          <stop offset="1" stopColor={palette.localDark} />
        </linearGradient>

        <linearGradient id={ids.peerGrad} x1="28" y1="10" x2="38" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={palette.peer} />
          <stop offset="1" stopColor={palette.peerDark} />
        </linearGradient>

        <filter id="bg-bulb-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="0.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id={ids.glow} x="-160%" y="-160%" width="420%" height="420%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <style>{`
          .bg .bg-local  { transform-box: fill-box; transform-origin: center; }
          .bg .bg-eye    { transform-box: fill-box; transform-origin: center; }
          .bg .bg-pupil  { transform-box: fill-box; transform-origin: center; }
          .bg .bg-brow   { transform-box: fill-box; transform-origin: center; }
          .bg .bg-peer   { transform-box: fill-box; transform-origin: center; }

          @media (prefers-reduced-motion: no-preference) {
            /* ── idle: Established ── */
            .bg:not(.bg-think):not(.bg-sleep):not(.bg-alarm):not(.bg-giggle):not(.bg-stress):not(.bg-hustle) .bg-local {
              animation: bg-bob 4.2s ease-in-out infinite;
            }

            /* ── idea: the bulb pops on and flickers ── */
            .bg-idea .bg-bulb {
              transform-box: fill-box;
              transform-origin: center bottom;
              animation: bg-pop 1.6s ease-in-out infinite;
            }
            .bg-idea .bg-bulb-rays { animation: bg-led-fast 0.5s ease-in-out infinite; }
            .bg-idea .bg-local { animation: bg-bob 2.4s ease-in-out infinite; }

            /* ── stressed: trembling, sweat drop sliding down ── */
            .bg-stress .bg-local { animation: bg-shake 0.14s ease-in-out infinite; }
            .bg-stress .bg-brow { animation: bg-glare 0.7s ease-in-out infinite; }
            .bg-stress .bg-sweat { animation: bg-sweat 1.4s ease-in infinite; }
            .bg-stress .bg-packet {
              offset-path: path("M 25 16.5 L 28 16.5");
              animation: bg-reject 0.7s ease-in-out infinite;
            }

            /* ── hustle: heads down, packets sprinting, speed lines ── */
            .bg-hustle .bg-local { animation: bg-hustle 0.45s ease-in-out infinite; }
            .bg-hustle .bg-pupil { animation: bg-scan 0.5s ease-in-out infinite; }
            .bg-hustle .bg-speed { animation: bg-speed 0.45s linear infinite; }
            .bg-hustle .bg-packet {
              offset-path: path("M 25 16.5 L 28 16.5");
              animation: bg-sprint 0.3s linear infinite;
            }
            .bg-hustle .bg-peer-led { animation: bg-led-fast 0.25s ease-in-out infinite; }

            /* ── giggle: shaking with laughter ── */
            .bg-giggle .bg-local {
              animation: bg-giggle 0.36s ease-in-out infinite;
            }
            .bg-giggle .bg-laugh {
              transform-box: fill-box;
              transform-origin: top center;
              animation: bg-laugh 0.36s ease-in-out infinite;
            }
            .bg:not(.bg-sleep) .bg-eye {
              animation: bg-blink 4.8s ease-in-out infinite;
            }
            .bg:not(.bg-think):not(.bg-sleep):not(.bg-alarm) .bg-packet {
              offset-path: path("M 25 16.5 L 28 16.5");
              animation: bg-drift 2.2s ease-in-out infinite;
            }

            /* ── thinking: OpenSent ── */
            .bg-think .bg-local {
              animation: bg-alert 0.8s ease-in-out infinite;
            }
            .bg-think .bg-packet {
              offset-path: path("M 25 16.5 L 28 16.5");
              animation: bg-sprint 0.55s linear infinite;
            }
            .bg-think .bg-pupil {
              animation: bg-scan 1.2s ease-in-out infinite;
            }
            .bg-think .bg-peer-led {
              animation: bg-led-fast 0.4s ease-in-out infinite;
            }

            /* ── sleeping: Idle* (admin down) ── */
            .bg-sleep .bg-local {
              animation: bg-sway 6s ease-in-out infinite;
            }
            .bg-sleep .bg-zzz {
              animation: bg-zzz-float 3s ease-in-out infinite;
            }
            .bg-sleep .bg-zzz-b {
              animation-delay: 1s;
            }

            /* ── alarm: flapping to Idle ── */
            .bg-alarm .bg-local {
              animation: bg-shake 0.3s ease-in-out infinite;
            }
            .bg-alarm .bg-link {
              animation: bg-flap 0.55s steps(1) infinite;
            }
            .bg-alarm .bg-packet {
              offset-path: path("M 25 16.5 L 28 16.5");
              animation: bg-reject 1s ease-in-out infinite;
            }
            .bg-alarm .bg-brow {
              animation: bg-glare 1.3s ease-in-out infinite;
            }
            .bg-alarm .bg-peer-led {
              animation: bg-led-flap 0.55s steps(1) infinite;
            }
          }

          @keyframes bg-pop    { 0%,100% { transform: scale(1); opacity: 1; } 15% { transform: scale(1.25); } 30% { transform: scale(1); } 60% { opacity: 0.75; } 70% { opacity: 1; } }
          @keyframes bg-sweat  { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(7px); opacity: 0; } }
          @keyframes bg-hustle { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0.6px,-0.7px); } }
          @keyframes bg-speed  { 0% { transform: translateX(0); opacity: 0.9; } 100% { transform: translateX(-2.5px); opacity: 0; } }
          @keyframes bg-giggle { 0%,100% { transform: translateY(0) rotate(-1.2deg); } 50% { transform: translateY(-0.9px) rotate(1.2deg); } }
          @keyframes bg-laugh  { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.6); } }
          @keyframes bg-bob    { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-0.8px); } }
          @keyframes bg-blink  { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } 98% { transform: scaleY(1); } }
          @keyframes bg-drift  { 0%,100% { offset-distance: 10%; opacity: 0.85; } 50% { offset-distance: 90%; opacity: 1; } }
          @keyframes bg-alert  { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-0.6px); } }
          @keyframes bg-sprint { 0% { offset-distance: 5%; } 50% { offset-distance: 95%; } 100% { offset-distance: 5%; } }
          @keyframes bg-scan   { 0%,100% { transform: translateX(0); } 50% { transform: translateX(0.6px); } }
          @keyframes bg-led-fast { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
          @keyframes bg-sway   { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(1deg); } }
          @keyframes bg-zzz-float { 0% { opacity: 0; transform: translate(0,0) scale(0.6); } 20% { opacity: 0.6; } 100% { opacity: 0; transform: translate(3px,-6px) scale(1); } }
          @keyframes bg-shake  { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-0.5px); } 75% { transform: translateX(0.5px); } }
          @keyframes bg-flap   { 0%,100% { opacity: 0.85; } 50% { opacity: 0.2; } }
          @keyframes bg-reject { 0% { offset-distance: 10%; opacity: 1; } 38% { offset-distance: 55%; opacity: 1; } 48% { offset-distance: 40%; opacity: 0.4; } 55% { offset-distance: 10%; opacity: 1; } 100% { offset-distance: 10%; opacity: 1; } }
          @keyframes bg-glare  { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-2deg); } }
          @keyframes bg-led-flap { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        `}</style>
      </defs>

      {/* ── BGP Session Link ── */}
      <g>
        <line
          className="bg-link"
          x1="25"
          y1="16.5"
          x2="28"
          y2="16.5"
          stroke={alarm ? palette.linkHot : palette.link}
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity={sleeping ? 0.3 : 0.85}
        />
        {!sleeping && (
          <circle
            className="bg-packet"
            r="1.5"
            fill={alarm ? "#ffd8d0" : "#fff6dd"}
            filter={`url(#${ids.glow})`}
          />
        )}
      </g>

      {/* ── Remote Neighbor Peer ("them") ── */}
      <g className="bg-peer">
        <rect x="28" y="10" width="10" height="13" rx="2.5" fill={`url(#${ids.peerGrad})`} opacity={sleeping ? 0.55 : 1} />
        <g fill={sleeping ? "#2a2416" : "#000"} opacity="0.25">
          <rect x="30" y="13" width="2" height="2" rx="0.4" />
          <rect x="33" y="13" width="2" height="2" rx="0.4" />
        </g>
        <circle className="bg-peer-led" cx="33" cy="18.5" r="1.1" fill={palette.led} />
      </g>

      {/* ── Local Router ("us") — Takes up over 60% of canvas width ── */}
      <g className="bg-local">
        <rect x="3" y="4" width="22" height="22" rx="4" fill={`url(#${ids.localGrad})`} />

        {/* Front Panel Ports */}
        <g fill="#000" opacity="0.18">
          <rect x="6" y="8" width="3" height="3" rx="0.6" />
          <rect x="10.5" y="8" width="3" height="3" rx="0.6" />
          <rect x="15" y="8" width="3" height="3" rx="0.6" />
          <rect x="19.5" y="8" width="3" height="3" rx="0.6" />
        </g>

        {/* Face Expressions */}
        {face}
      </g>

      {/* ── BGP Protocol State Caption ── */}
      {showCaption && (
        <text
          x="20"
          y="34"
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="4.2"
          fontWeight="600"
          fill={palette.link}
          opacity="0.9"
        >
          {stateName}
        </text>
      )}
    </svg>
  );
}
