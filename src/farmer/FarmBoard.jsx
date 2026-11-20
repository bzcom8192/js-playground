// The farm board: a thick earth slab tilted in perspective, with lush,
// slightly oversized crops, giant pumpkins for k×k groups and a hovering drone.
// Original art: emoji + CSS + small inline SVGs.
import { memo, useEffect, useId, useRef, useState } from "react";
import { findGiantPumpkins } from "./boardModel.js";

// ---------- small inline SVG art ----------

export function PumpkinSvg({ dead = false, className = "", style }) {
  const id = useId().replace(/:/g, "");
  const [c0, c1, line, stem] = dead
    ? ["#b9b4a8", "#7d776c", "#5e594f", "#5b5546"]
    : ["#ffc25a", "#e5791a", "#b4560d", "#5d7a22"];
  return (
    <svg viewBox="0 0 100 82" className={className} style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`pk${id}`} cx="42%" cy="34%" r="70%">
          <stop offset="0" stopColor={c0} />
          <stop offset="1" stopColor={c1} />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="76" rx="40" ry="5" fill="rgba(40,20,5,.28)" />
      {[
        [27, 22],
        [73, 22],
        [37, 24],
        [63, 24],
        [50, 25],
      ].map(([cx, rx]) => (
        <ellipse key={cx} cx={cx} cy="48" rx={rx} ry="28" fill={`url(#pk${id})`} stroke={line} strokeWidth="1.6" />
      ))}
      <ellipse cx="41" cy="36" rx="7" ry="10" fill="#fff" opacity=".14" />
      <path d="M49 22 C48 15 50 10 55 7 L58 10 C54 13 53 17 54 22 Z" fill={stem} />
    </svg>
  );
}

function DroneSvg() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 120 92" className="w-full h-auto overflow-visible" aria-hidden="true">
      <defs>
        <radialGradient id={`db${id}`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset=".55" stopColor="#f39a2b" />
          <stop offset="1" stopColor="#c8650f" />
        </radialGradient>
      </defs>
      {/* arms */}
      <path d="M16 44 L46 52 M104 44 L74 52" stroke="#4b4f55" strokeWidth="5" strokeLinecap="round" />
      {/* propellers (spin via CSS) */}
      {[16, 104].map((cx) => (
        <g key={cx}>
          <rect x={cx - 3} y="38" width="6" height="8" rx="2" fill="#3a3d42" />
          <g className="farmer-prop">
            <rect x={cx - 17} y="35" width="34" height="4" rx="2" fill="#2f3237" opacity=".85" />
          </g>
        </g>
      ))}
      {/* body */}
      <circle cx="60" cy="58" r="25" fill={`url(#db${id})`} stroke="#a85410" strokeWidth="1.5" />
      <path d="M48 36 C42 48 42 68 48 80 M72 36 C78 48 78 68 72 80 M60 33 L60 83" stroke="#c4640f" strokeWidth="1.4" fill="none" opacity=".7" />
      {/* eyes */}
      <circle cx="52" cy="58" r="3" fill="#3a2410" />
      <circle cx="68" cy="58" r="3" fill="#3a2410" />
      <circle cx="53" cy="57" r="1" fill="#fff" />
      <circle cx="69" cy="57" r="1" fill="#fff" />
      {/* straw hat */}
      <ellipse cx="60" cy="36" rx="30" ry="7" fill="#d9b25a" stroke="#a9842f" strokeWidth="1.2" />
      <path d="M45 35 C45 21 75 21 75 35 Z" fill="#ecc96f" stroke="#a9842f" strokeWidth="1.2" />
      <path d="M45.5 32 C52 34.5 68 34.5 74.5 32 L75 35 C68 37.5 52 37.5 45 35 Z" fill="#b5462b" />
    </svg>
  );
}

// ---------- crops ----------

const E = ({ children, size, style, className = "" }) => (
  <span
    className={`absolute block leading-none select-none ${className}`}
    style={{ fontSize: size, ...style }}
  >
    {children}
  </span>
);

/** Anchors a plant at the bottom-centre of its tile and scales it with growth. */
function Plant({ t, scale = 1, bottom = 0.14, z, children, className = "" }) {
  return (
    <div
      className={`absolute pointer-events-none ${className}`}
      style={{
        left: "50%",
        bottom: t * bottom,
        width: t,
        height: t,
        marginLeft: -t / 2,
        transform: `scale(${scale})`,
        transformOrigin: "50% 100%",
        transition: "transform 200ms linear",
        zIndex: z,
      }}
    >
      {children}
    </div>
  );
}

// Positions are relative to a t×t box whose bottom edge is the plant's base.
const at = (t, x, b, extra = {}) => ({ left: t * x, bottom: t * b, ...extra });

function Crop({ type, p, t, z }) {
  const grow = 0.3 + 0.7 * Math.min(1, p);
  switch (type) {
    case "Grass":
      if (p < 1) {
        return (
          <Plant t={t} scale={grow} z={z}>
            <E size={t * 0.42} style={at(t, 0.29, 0)}>🌱</E>
          </Plant>
        );
      }
      return (
        <Plant t={t} z={z} bottom={0.1}>
          <div className="absolute inset-0 farmer-sway">
            <E size={t * 0.62} style={at(t, 0.06, 0.18, { transform: "rotate(-12deg)" })}>🌾</E>
            <E size={t * 0.62} style={at(t, 0.36, 0.24, { transform: "rotate(4deg)" })}>🌾</E>
            <E size={t * 0.7} style={at(t, -0.04, 0, { transform: "rotate(-6deg)" })}>🌾</E>
            <E size={t * 0.74} style={at(t, 0.22, 0.02)}>🌾</E>
            <E size={t * 0.68} style={at(t, 0.44, -0.02, { transform: "rotate(10deg)" })}>🌾</E>
          </div>
        </Plant>
      );
    case "Bush":
      return (
        <Plant t={t} scale={grow} z={z}>
          <E size={t * 0.7} style={at(t, 0.02, 0.02)}>🌿</E>
          <E size={t * 0.7} style={at(t, 0.3, 0.06, { transform: "scaleX(-1)" })}>🌿</E>
          {p >= 1 &&
            [
              [0.3, 0.3],
              [0.55, 0.22],
              [0.45, 0.46],
              [0.68, 0.4],
            ].map(([x, b]) => <span key={x} className="farmer-berry" style={{ ...at(t, x, b), width: t * 0.13, height: t * 0.13 }} />)}
        </Plant>
      );
    case "Tree":
      return (
        <Plant t={t} scale={grow} z={z} bottom={0.06}>
          <E size={t * 1.3} style={at(t, -0.15, 0)}>🌳</E>
        </Plant>
      );
    case "Carrot":
      if (p < 1) {
        return (
          <Plant t={t} scale={grow} z={z}>
            <E size={t * 0.38} style={at(t, 0.16, 0.02)}>🌱</E>
            <E size={t * 0.38} style={at(t, 0.44, 0.06, { transform: "scaleX(-1)" })}>🌱</E>
          </Plant>
        );
      }
      return (
        <Plant t={t} z={z}>
          {/* orange shoulder, partially tucked into the soil */}
          <div className="absolute overflow-hidden" style={{ ...at(t, 0.18, 0.02), width: t * 0.64, height: t * 0.5 }}>
            <E size={t * 0.62} style={{ left: t * 0.02, top: t * 0.02, transform: "rotate(-45deg)" }}>🥕</E>
          </div>
          <E size={t * 0.34} style={at(t, 0.12, 0.3, { transform: "rotate(-14deg)" })}>🌿</E>
          <E size={t * 0.34} style={at(t, 0.48, 0.32, { transform: "scaleX(-1) rotate(-14deg)" })}>🌿</E>
        </Plant>
      );
    case "Pumpkin":
      return (
        <Plant t={t} scale={grow} z={z} bottom={0.1}>
          <PumpkinSvg className="absolute" style={{ ...at(t, 0.08, 0), width: t * 0.84 }} />
        </Plant>
      );
    case "Dead_Pumpkin":
      return (
        <Plant t={t} z={z} bottom={0.1}>
          <PumpkinSvg
            dead
            className="absolute"
            style={{ ...at(t, 0.14, 0), width: t * 0.72, transform: "rotate(16deg) scaleY(.72)", transformOrigin: "50% 100%", opacity: 0.85 }}
          />
        </Plant>
      );
    case "Sunflower":
      return (
        <Plant t={t} scale={grow} z={z} bottom={0.1}>
          <span className="absolute rounded-full bg-[#4f8a24]" style={{ ...at(t, 0.47, 0), width: t * 0.07, height: t * 0.72 }} />
          <span className="absolute rounded-[50%] bg-[#5f9e2c] rotate-[-35deg]" style={{ ...at(t, 0.28, 0.22), width: t * 0.22, height: t * 0.1 }} />
          <span className="absolute rounded-[50%] bg-[#5f9e2c] rotate-[35deg]" style={{ ...at(t, 0.52, 0.32), width: t * 0.22, height: t * 0.1 }} />
          <E size={t * 0.62} style={at(t, 0.19, 0.6)}>🌻</E>
        </Plant>
      );
    case "Cactus":
      return (
        <Plant t={t} scale={grow} z={z}>
          <E size={t * 0.74} style={at(t, 0.13, 0)}>🌵</E>
          {p >= 1 && <span className="farmer-flower" style={{ ...at(t, 0.44, 0.7), width: t * 0.14, height: t * 0.14 }} />}
        </Plant>
      );
    default:
      return null;
  }
}

const Tile = memo(function Tile({ ground, type, p, water, t, z, hideCrop }) {
  return (
    <div className={`relative farm-tile ${ground === "Soil" ? "farm-soil" : "farm-grass"}`}>
      {water > 0 && <div className="absolute inset-0 farm-water pointer-events-none" style={{ opacity: Math.min(0.9, 0.25 + water * 0.9) }} />}
      {type && !hideCrop && <Crop type={type} p={p} t={t} z={z} />}
    </div>
  );
});

// ---------- board ----------

const TILT_DEG = 13;

export default function FarmBoard({ game, moveMs, paused }) {
  const wrapRef = useRef(null);
  const [areaPx, setAreaPx] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setAreaPx(Math.max(0, Math.floor(Math.min(width * 0.84, height * 0.8, 780))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = game.size;
  // The board grows with the farm (like TFWR): a 1×1 farm is a small plot,
  // 6×6 and up use all the room there is.
  const boardPx = Math.min(areaPx, 170 + 95 * n);
  const { x, y, flips = 0, flipMs = 600 } = game.drone;

  // No slide across a wrap-around jump.
  const [prevPos, setPrevPos] = useState({ x, y });
  const [jump, setJump] = useState(false);
  if (prevPos.x !== x || prevPos.y !== y) {
    setJump(Math.abs(prevPos.x - x) > 1 || Math.abs(prevPos.y - y) > 1);
    setPrevPos({ x, y });
  }

  const pad = Math.max(6, Math.round(boardPx * 0.018));
  const gap = n > 8 ? 2 : 3;
  const inner = boardPx - pad * 2;
  const t = boardPx ? (inner - gap * (n - 1)) / n : 0;
  const step = t + gap;

  const giants = findGiantPumpkins(game);
  const hidden = new Set(giants.flatMap((g) => g.cells));

  const tiles = [];
  for (let row = n - 1; row >= 0; row--) {
    const fromTop = n - 1 - row;
    for (let col = 0; col < n; col++) {
      const k = row * n + col;
      const tile = game.tiles[k];
      const e = tile.entity;
      tiles.push(
        <Tile
          key={k}
          ground={tile.ground}
          type={e ? e.type : null}
          p={e ? Math.round(Math.min(1, e.progress) * 50) / 50 : 0}
          water={Math.round(tile.water * 20) / 20}
          t={t}
          z={fromTop * 2 + 1}
          hideCrop={hidden.has(k)}
        />,
      );
    }
  }

  const slide = jump ? "none" : `left ${moveMs}ms linear, top ${moveMs}ms linear`;
  const droneW = Math.max(40, Math.min(110, t * 1.35));

  return (
    <div ref={wrapRef} className="w-full h-full flex items-center justify-center min-h-0">
      {boardPx > 0 && (
        <div style={{ perspective: 1200, width: boardPx, height: boardPx }}>
          <div
            className="relative w-full h-full"
            style={{ transform: `rotateX(${TILT_DEG}deg)`, transformOrigin: "50% 0" }}
          >
            <div className="farm-slab absolute inset-0" style={{ padding: pad, borderRadius: pad }}>
              <div className="relative w-full h-full">
                <div
                  className="grid w-full h-full"
                  style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${n}, 1fr)`, gap }}
                >
                  {tiles}
                </div>

                {giants.map((g) => {
                  const size = g.k * t + (g.k - 1) * gap;
                  const top = (n - 1 - (g.y0 + g.k - 1)) * step;
                  return (
                    <div
                      key={`${g.x0},${g.y0}`}
                      className="absolute pointer-events-none flex items-end justify-center"
                      style={{
                        left: g.x0 * step,
                        top,
                        width: size,
                        height: size,
                        zIndex: (n - 1 - g.y0) * 2 + 2,
                      }}
                      title={`Giant pumpkin ${g.k}×${g.k}`}
                    >
                      <PumpkinSvg style={{ width: size * 0.98, marginBottom: size * 0.02 }} />
                    </div>
                  );
                })}

                {/* Drone: shadow marks its tile; the body hovers above and to the right. */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: x * step,
                    top: (n - 1 - y) * step,
                    width: t,
                    height: t,
                    transition: slide,
                    zIndex: 1000,
                  }}
                  aria-label={`Drone at ${x}, ${y}`}
                >
                  <div className={`farmer-drone-shadow ${paused ? "is-paused" : ""}`} style={{ width: Math.min(t * 0.6, droneW * 0.8), height: Math.min(t * 0.22, droneW * 0.3) }} />
                  <div
                    className="absolute"
                    style={{ left: t * 0.5 + Math.min(t * 0.14, droneW * 0.2), top: t * 0.5 - Math.min(t * 0.55, droneW * 0.8), width: droneW, marginLeft: -droneW / 2, marginTop: -droneW / 2 }}
                  >
                    <div className={`farmer-bob ${paused ? "is-paused" : ""}`}>
                      <div key={flips} className={flips ? "farmer-flip" : ""} style={{ animationDuration: `${Math.max(80, flipMs)}ms` }}>
                        <DroneSvg />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
