// Pure layout / animation helpers for the 3D farm board (no three.js, no DOM;
// unit-tested in node).
//
// World space: 1 unit = 1 tile. The board is centred on the origin, tile tops
// sit at y = 0. x grows East, North is −z (away from the camera), so the
// camera looks at the board from the South like the TFWR reference.

/** Centre of tile (x, y) in world units for an n×n farm. */
export function tileToWorld(n, x, y) {
  return { x: x - (n - 1) / 2, z: (n - 1) / 2 - y };
}

/** Moving more than one tile in a single step means a wrap-around move. */
export function isWrapJump(ax, ay, bx, by) {
  return Math.abs(ax - bx) > 1.5 || Math.abs(ay - by) > 1.5;
}

/** Frame-rate independent exponential approach of `cur` toward `target`. */
export function smoothToward(cur, target, dt, rate) {
  return cur + (target - cur) * (1 - Math.exp(-dt * rate));
}

/** Shortest-path angle interpolation (radians). */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Growth → model scale [sx, sy, sz] for an entity type at displayed progress p.
 * Wheat shoots up (strong y scale); everything else grows uniformly from 30 %.
 */
export function growthScale(type, p) {
  const q = clamp01(p);
  if (type === "Grass") {
    const s = 0.55 + 0.45 * q;
    return [s, 0.18 + 0.82 * q, s];
  }
  if (type === "Dead_Pumpkin") return [1, 1, 1];
  const s = 0.3 + 0.7 * q;
  return [s, s, s];
}

/** Planting pop: 0.6 → slight overshoot → 1 over t ∈ [0, 1]. */
export function popScale(t) {
  if (t >= 1) return 1;
  const u = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const back = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); // easeOutBack
  return 0.6 + 0.4 * back;
}

/** Harvest pop: a small swell, then shrink to nothing over t ∈ [0, 1]. */
export function dieScale(t) {
  const u = clamp01(t);
  if (u < 0.3) return 1 + 0.12 * (u / 0.3);
  return 1.12 * (1 - (u - 0.3) / 0.7);
}

/**
 * Which model a tile's entity needs. Same key → the existing mesh is kept
 * (only its growth scale changes); a different key → the mesh is rebuilt.
 */
export function modelKey(e) {
  if (!e) return null;
  const grown = e.progress >= 1;
  switch (e.type) {
    case "Bush":
    case "Carrot":
      return `${e.type}:${grown ? 1 : 0}`;
    case "Cactus":
      return `Cactus:${e.size ?? 0}:${grown ? 1 : 0}`;
    default:
      return e.type;
  }
}

/** Water level → one of 10 shared water materials (0 = no water plane). */
export const waterLevel = (w) => Math.max(0, Math.min(10, Math.round((w || 0) * 10)));

/**
 * On-screen size the board should fill, in CSS px. Like the v2 board it grows
 * with the farm: a 1×1 farm is a small plot, 8×8 is close to the reference
 * (~720 px wide at 1080p) and big farms use the room there is.
 */
export function boardTargetPx(n, cw, ch) {
  const w = Math.max(80, Math.min(cw * 0.88, ch * 1.02, 250 + 60 * n));
  const h = Math.max(80, ch * 0.92);
  return { w, h };
}
