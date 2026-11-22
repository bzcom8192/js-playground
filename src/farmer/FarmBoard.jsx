// The 2D farm board (fallback without WebGL): a planter box tilted in
// perspective, with slightly oversized crops, one big pumpkin per k×k group
// and the field bots standing over their tiles.
// Original art: emoji + CSS + small inline SVGs.
import { memo, useEffect, useId, useRef, useState } from "react";
import { findGiantPumpkins } from "./boardModel.js";
import { DRONE_BAND_0, droneBand, statusLight } from "./droneBands.js";

// ---------- small inline SVG art ----------

export function PumpkinSvg({ dead = false, className = "", style }) {
  const id = useId().replace(/:/g, "");
  const [c0, c1, line, stem] = dead
    ? ["#b5adb8", "#776f7d", "#5a5260", "#4f4854"]
    : ["#f3b8a5", "#bf6470", "#8e4250", "#3f7a5c"];
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

function BotSvg({ band = DRONE_BAND_0, status = "idle" }) {
  return (
    <svg viewBox="0 0 120 110" className="w-full h-auto overflow-visible" aria-hidden="true">
      {/* far legs, then near legs on wheels */}
      <path d="M36 58 V88 M84 58 V88" stroke="#b9a996" strokeWidth="5" />
      <path d="M22 56 V96 M98 56 V96" stroke="#f6ead6" strokeWidth="7" />
      <path d="M16 56 H104" stroke="#3a2c44" strokeWidth="6" strokeLinecap="round" />
      {[22, 98].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="97" r="11" fill="#2a2130" />
          <circle cx={cx} cy="97" r="4" fill="#f0b03f" />
        </g>
      ))}
      {/* seed probe */}
      <path d="M56 58 H64 L62 72 L60 79 L58 72 Z" fill="#f0b03f" />
      {/* body + identity stripe */}
      <rect x="30" y="24" width="60" height="34" rx="4" fill="#f6ead6" stroke="#3a2c44" strokeWidth="2" />
      <rect x="28" y="30" width="64" height="8" rx="2" fill={band} />
      {/* lens + grille */}
      <rect x="38" y="41" width="26" height="14" rx="3" fill="#3a2c44" />
      <circle cx="51" cy="48" r="6" fill="#7fe3ea" />
      <circle cx="51" cy="48" r="2.6" fill="#16353d" />
      <path d="M72 45 H83 M72 49 H83 M72 53 H83" stroke="#3a2c44" strokeWidth="1.6" />
      {/* solar roof */}
      <path d="M24 24 L32 10 H88 L96 24 Z" fill="#2f69a8" stroke="#3a2c44" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M28 17 H92 M50 10 L47 24 M70 10 L73 24" stroke="#16304f" strokeWidth="1.6" />
      {/* status mast */}
      <path d="M90 12 V-6" stroke="#3a2c44" strokeWidth="2.5" />
      <circle cx="90" cy="-9" r="6" fill={statusLight(status)} stroke="#3a2c44" strokeWidth="1.5" />
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

/** One dinosaur segment (2D): the head is 🦖 facing its way, body/tail are violet blobs. */
function DinoSegment({ part, dir, t, z }) {
  if (part === "head") {
    // The emoji looks West; mirror it when heading East. North/South keep the side view.
    const flip = dir === "East" ? "scaleX(-1)" : "none";
    return (
      <Plant t={t} z={z + 1} bottom={0.04}>
        <span className="absolute rounded-full" style={{ ...at(t, 0.14, 0.02), width: t * 0.72, height: t * 0.2, background: "rgba(0,0,0,.18)", filter: "blur(2px)" }} />
        <E size={t * 0.8} style={at(t, 0.1, 0.04, { transform: flip })}>🦖</E>
      </Plant>
    );
  }
  const tail = part === "tail";
  const w = tail ? 0.46 : 0.66;
  return (
    <Plant t={t} z={z} bottom={0.06}>
      <span
        className="absolute rounded-[45%]"
        style={{
          ...at(t, (1 - w) / 2, 0.06),
          width: t * w,
          height: t * w * 0.72,
          background: "radial-gradient(circle at 40% 30%, #b29ce0 0%, #8b6fc0 55%, #5a4390 100%)",
          boxShadow: "inset 0 -3px 0 rgba(0,0,0,.2), 0 2px 3px rgba(0,0,0,.3)",
        }}
      />
      {!tail &&
        [0.38, 0.5, 0.62].map((x) => (
          <span
            key={x}
            className="absolute"
            style={{
              ...at(t, x - 0.05, 0.06 + w * 0.68),
              width: 0,
              height: 0,
              borderLeft: `${t * 0.05}px solid transparent`,
              borderRight: `${t * 0.05}px solid transparent`,
              borderBottom: `${t * 0.1}px solid #ff9d7a`,
            }}
          />
        ))}
    </Plant>
  );
}

function Crop({ type, p, t, z, dinoPart, dinoDir }) {
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
          <span className="absolute rounded-full bg-[#3a8a68]" style={{ ...at(t, 0.47, 0), width: t * 0.07, height: t * 0.72 }} />
          <span className="absolute rounded-[50%] bg-[#4fa07c] rotate-[-35deg]" style={{ ...at(t, 0.28, 0.22), width: t * 0.22, height: t * 0.1 }} />
          <span className="absolute rounded-[50%] bg-[#4fa07c] rotate-[35deg]" style={{ ...at(t, 0.52, 0.32), width: t * 0.22, height: t * 0.1 }} />
          <E size={t * 0.62} style={at(t, 0.19, 0.6)}>🌻</E>
        </Plant>
      );
    case "Rice":
    case "Dead_Rice": {
      // A paddy clump of 🌾: green-gold while growing, gold when ripe;
      // the withered variant is a grey-brown, slumped clump.
      const dead = type === "Dead_Rice";
      const tint = dead
        ? "grayscale(.75) sepia(.55) brightness(.8)"
        : p >= 1
          ? "hue-rotate(18deg) saturate(1.2)"
          : "hue-rotate(55deg) saturate(1.1)";
      return (
        <Plant t={t} scale={dead ? 1 : grow} z={z} bottom={0.1}>
          <div
            className={`absolute inset-0 ${dead ? "" : "farmer-sway"}`}
            style={{ filter: tint, ...(dead ? { transform: "rotate(14deg) scaleY(.7)", transformOrigin: "50% 100%" } : null) }}
            title={dead ? "Dead rice" : "Rice"}
          >
            <E size={t * 0.56} style={at(t, 0.08, 0.06, { transform: "rotate(-10deg)" })}>🌾</E>
            <E size={t * 0.62} style={at(t, 0.3, 0.02)}>🌾</E>
            <E size={t * 0.56} style={at(t, 0.5, 0.06, { transform: "rotate(10deg) scaleX(-1)" })}>🌾</E>
          </div>
        </Plant>
      );
    }
    case "Cactus":
      return (
        <Plant t={t} scale={grow} z={z}>
          <E size={t * 0.74} style={at(t, 0.13, 0)}>🌵</E>
          {p >= 1 && <span className="farmer-flower" style={{ ...at(t, 0.44, 0.7), width: t * 0.14, height: t * 0.14 }} />}
        </Plant>
      );
    case "Hedge":
      // Maze wall: a dark-green clipped hedge block filling the tile.
      return (
        <div
          className="absolute pointer-events-none rounded-[3px]"
          style={{
            inset: -1,
            bottom: t * 0.04,
            zIndex: z,
            background: "linear-gradient(180deg, #3c8078 0%, #2a5f5a 45%, #1d4743 100%)",
            boxShadow: "inset 0 2px 0 rgba(170,225,205,.35), inset 0 -3px 0 rgba(0,0,0,.25), 0 3px 4px rgba(0,0,0,.3)",
            transform: `translateY(${-t * 0.12}px)`,
          }}
          title="Hedge"
        />
      );
    case "Treasure":
      return (
        <Plant t={t} z={z} bottom={0.08}>
          <span className="absolute rounded-full" style={{ ...at(t, 0.12, 0.02), width: t * 0.76, height: t * 0.76, background: "radial-gradient(circle, rgba(255,215,90,.75), rgba(255,215,90,0) 70%)" }} />
          <E size={t * 0.62} style={at(t, 0.19, 0.06)}>💰</E>
        </Plant>
      );
    case "Dinosaur":
      return <DinoSegment part={dinoPart || "body"} dir={dinoDir} t={t} z={z} />;
    case "Apple":
      return (
        <Plant t={t} z={z} bottom={0.1}>
          <E size={t * 0.46} style={at(t, 0.27, 0.02)}>🍎</E>
        </Plant>
      );
    default:
      return null;
  }
}

const Tile = memo(function Tile({ ground, type, p, water, t, z, hideCrop, dinoPart, dinoDir }) {
  return (
    <div className={`relative farm-tile ${ground === "Soil" ? "farm-soil" : "farm-grass"}`}>
      {water > 0 && <div className="absolute inset-0 farm-water pointer-events-none" style={{ opacity: Math.min(0.9, 0.25 + water * 0.9) }} />}
      {type && !hideCrop && <Crop type={type} p={p} t={t} z={z} dinoPart={dinoPart} dinoDir={dinoDir} />}
    </div>
  );
});

// ---------- bots ----------

// One field bot standing over its tile. Megafarm helpers (index ≥ 1) wear
// their own stripe and idle out of phase.
function BotSprite({ drone, index, n, t, step, moveMs, paused, status }) {
  const { x, y, flips = 0, flipMs = 600 } = drone;
  // No slide across a wrap-around jump.
  const [prevPos, setPrevPos] = useState({ x, y });
  const [jump, setJump] = useState(false);
  if (prevPos.x !== x || prevPos.y !== y) {
    setJump(Math.abs(prevPos.x - x) > 1 || Math.abs(prevPos.y - y) > 1);
    setPrevPos({ x, y });
  }
  const slide = jump ? "none" : `left ${moveMs}ms linear, top ${moveMs}ms linear`;
  const botW = Math.max(38, Math.min(110, t * 1.05));
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: x * step,
        top: (n - 1 - y) * step,
        width: t,
        height: t,
        transition: slide,
        zIndex: 1000 + index,
      }}
      aria-label={index ? `Bot ${index} at ${x}, ${y}` : `Bot at ${x}, ${y}`}
    >
      <div className="farmer-bot-shadow" style={{ width: botW * 0.85, height: botW * 0.2 }} />
      <div className="absolute" style={{ left: t * 0.5 - botW / 2 + (index ? t * 0.06 : 0), bottom: t * 0.06, width: botW }}>
        <div className={`farmer-idle ${paused ? "is-paused" : ""}`} style={index ? { animationDelay: `${-index * 0.37}s` } : undefined}>
          <div key={flips} className={flips ? "farmer-spin" : ""} style={{ animationDuration: `${Math.max(80, flipMs)}ms` }}>
            <BotSvg band={droneBand(index)} status={paused ? "paused" : status} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- board ----------

const TILT_DEG = 13;

export default function FarmBoard({ game, moveMs, paused, status }) {
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
  // The board grows with the farm: a 1×1 farm is a small plot,
  // 6×6 and up use all the room there is.
  const boardPx = Math.min(areaPx, 170 + 95 * n);
  // Bot 0 is always game.drone (= drones[0]); Megafarm adds helpers.
  const drones = Array.isArray(game.drones) && game.drones.length ? game.drones : [game.drone];

  const pad = Math.max(6, Math.round(boardPx * 0.018));
  const gap = n > 8 ? 2 : 3;
  const inner = boardPx - pad * 2;
  const t = boardPx ? (inner - gap * (n - 1)) / n : 0;
  const step = t + gap;

  const giants = findGiantPumpkins(game);
  const hidden = new Set(giants.flatMap((g) => g.cells));
  // Dinosaur segments by tile: "head" | "body" | "tail".
  const dinoParts = new Map();
  const body = game.dino?.body ?? [];
  body.forEach((seg, i) => {
    dinoParts.set(seg.y * n + seg.x, i === 0 ? "head" : i === body.length - 1 ? "tail" : "body");
  });

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
          dinoPart={dinoParts.get(k)}
          dinoDir={dinoParts.get(k) === "head" ? game.dino.dir : undefined}
        />,
      );
    }
  }

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

                {/* Bots: the wheels stand on the tile, the body is above the crop. */}
                {drones.map((d, i) => (
                  <BotSprite key={i} drone={i === 0 ? game.drone : d} index={i} n={n} t={t} step={step} moveMs={moveMs} paused={paused} status={status} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
