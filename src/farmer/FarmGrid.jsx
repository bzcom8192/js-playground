import { useEffect, useRef, useState } from "react";
import { ENTITY_INFO } from "./constants.js";

const GROUND_BG = { Grassland: "#2f4a1f", Soil: "#5b3b22" };

function Tile({ tile, fontPx }) {
  const e = tile.entity;
  const p = e ? Math.min(1, e.progress) : 0;
  const dead = e?.type === "Dead_Pumpkin";
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-[3px]"
      style={{ background: GROUND_BG[tile.ground] }}
    >
      {tile.water > 0 && (
        <div
          className="absolute inset-0 bg-sky-500 pointer-events-none"
          style={{ opacity: tile.water * 0.45 }}
        />
      )}
      {e && (
        <span
          className="relative select-none leading-none transition-transform duration-200"
          style={{
            fontSize: fontPx,
            transform: dead ? "rotate(18deg) scale(0.9)" : `scale(${0.35 + 0.65 * p})`,
            opacity: dead ? 0.75 : 0.55 + 0.45 * p,
            filter: dead ? "grayscale(1) brightness(0.55)" : undefined,
          }}
        >
          {ENTITY_INFO[e.type]?.icon ?? "?"}
        </span>
      )}
    </div>
  );
}

/** Square farm grid. North is at the top (rows rendered y = size-1 … 0). */
export default function FarmGrid({ game, moveMs }) {
  const wrapRef = useRef(null);
  const [boardPx, setBoardPx] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBoardPx(Math.max(0, Math.floor(Math.min(width, height, 720))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = game.size;
  const { x, y, flips = 0, flipMs = 600 } = game.drone;

  // Disable the slide transition when the drone wraps around an edge.
  const [prevPos, setPrevPos] = useState({ x, y });
  const [jump, setJump] = useState(false);
  if (prevPos.x !== x || prevPos.y !== y) {
    setJump(Math.abs(prevPos.x - x) > 1 || Math.abs(prevPos.y - y) > 1);
    setPrevPos({ x, y });
  }

  const gap = n > 8 ? 2 : 3;
  const tilePx = boardPx ? (boardPx - gap * (n - 1) - 12) / n : 0;
  const fontPx = Math.max(8, tilePx * 0.62);

  const rows = [];
  for (let row = n - 1; row >= 0; row--) {
    for (let col = 0; col < n; col++) {
      rows.push(<Tile key={`${col},${row}`} tile={game.tiles[row * n + col]} fontPx={fontPx} />);
    }
  }

  const slide = jump ? "none" : `left ${moveMs}ms linear, top ${moveMs}ms linear`;

  return (
    <div ref={wrapRef} className="w-full h-full flex items-center justify-center min-h-0">
      {boardPx > 0 && (
        <div
          className="relative p-1.5 rounded-lg bg-[#1a2614] ring-1 ring-gray-800"
          style={{ width: boardPx, height: boardPx }}
        >
          <div
            className="grid w-full h-full"
            style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${n}, 1fr)`, gap }}
          >
            {rows}
          </div>
          {/* Drone overlay */}
          <div
            className="absolute pointer-events-none flex items-start justify-end"
            style={{
              left: `calc(6px + ${x} * (${tilePx}px + ${gap}px))`,
              top: `calc(6px + ${n - 1 - y} * (${tilePx}px + ${gap}px))`,
              width: tilePx,
              height: tilePx,
              transition: slide,
            }}
            aria-label={`Drone at ${x}, ${y}`}
          >
            <span
              key={flips}
              className={`select-none leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)] ${flips ? "farmer-flip" : ""}`}
              style={{
                fontSize: Math.max(10, tilePx * 0.42),
                animationDuration: `${Math.max(80, flipMs)}ms`,
                margin: tilePx * 0.04,
              }}
            >
              🚁
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
