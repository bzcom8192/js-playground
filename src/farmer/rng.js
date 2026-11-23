// Semicolon Acres — seeds and the seeded PRNG (pure, no DOM). The weather,
// the arena worlds, the daily contracts and the arena's seed box use it.
// (Until BRIEF22 this lived in maze.js, next to the maze generator.)

export const SEED_MAX = 0xffffffff;

/** mulberry32: tiny, fast 32-bit PRNG → () => float in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random unsigned 32-bit seed from `rng` (ambient by default). */
export const randomSeed = (rng = Math.random) => Math.floor(rng() * 4294967296) >>> 0;

/** A valid seed (integer 0 … 2³²−1) or null. Accepts numbers and digit strings. */
export function parseSeed(v) {
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^\d{1,10}$/.test(t)) return null;
    v = Number(t);
  }
  return Number.isInteger(v) && v >= 0 && v <= SEED_MAX ? v : null;
}
