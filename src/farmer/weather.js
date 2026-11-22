// Semicolon Acres — weather (v3 phase 4). Pure, no DOM, no ambient randomness.
//
// Weather is a world-level system: one state for the whole farm, changing
// over time, read by the world tick (see world.js `tick`). Every bit of it is
// a pure function of (weather seed, world tick), so the same seed + the same
// tick gives the same weather on any machine and after any reload.
//
// ---------- time ----------
// The weather clock counts WORLD ticks: one world tick = 0.1 s of farm time,
// i.e. one step of the page's 100 ms simulation loop (TICK_MS in
// useFarmEngine.js). It only advances while the world advances (not while
// paused) and is saved with the farm:
//   state.weather = { seed, time }   seed: uint32, time: world ticks (float ≥ 0)
// A weather tick is ⌊time⌋. (This is not the 1 ms run tick of
// get_tick_count(); see RESULT12.md for why.)
//
// ---------- derivation (exact) ----------
//   segment i      = ⌊tick / SEGMENT_TICKS⌋                 (1,200 ticks = 2 min)
//   segSeed(i)     = hash32(seed, i)                         (see hash32 below)
//   stream_i       = mulberry32(segSeed(i))                  (maze.js)
//   weather(i)     = pick(stream_i draw #1) over WEATHER_WEIGHTS, cumulative in
//                    WEATHER_STATES order: Sunny 40 %, Rain 30 %, Storm 15 %,
//                    Drought 15 %.
//   Storm only — strike moments: stream_i draws #2…#(1+STORM_STRIKES):
//                    i·1200 + 1 + ⌊r × 1199⌋, sorted (ticks inside segment i).
//   Strike k's targets: mulberry32(hash32(segSeed(i), k)): one draw for the
//                    count 1 + ⌊r × STORM_MAX_TILES⌋, then one draw per pick
//                    from the remaining crop tiles (tile-index order).
//   Forecast at tick t (segment i): next = weather(i + 1);
//                    true = (i + 1)·1200 − t  (1 … 1200);
//                    stream = mulberry32(hash32(segSeed(i), t, FORECAST_SALT)):
//                    u = draw #1, sign = draw #2 < 0.5 ? −1 : +1;
//                    err = max(1, ⌊u × 0.2 × true⌋);
//                    inTicks = true + sign × err (sign forced + if that is < 1).
//                    So inTicks is never the true value and is within ±20 %
//                    (below 5 ticks, where ±20 % holds no other whole number,
//                    the error is exactly 1 tick).

import { mulberry32, randomSeed } from "./maze.js";

export const WEATHER_STATES = ["Sunny", "Rain", "Storm", "Drought"];
export const WEATHER_WEIGHTS = { Sunny: 0.4, Rain: 0.3, Storm: 0.15, Drought: 0.15 };
export const WEATHER_ICONS = { Sunny: "☀️", Rain: "🌧", Storm: "⛈", Drought: "🏜" };

export const SEGMENT_TICKS = 1200;
export const WEATHER_TICKS_PER_SEC = 10; // world ticks per second of farm time
export const FORECAST_OPS = 25; // get_forecast() counts as 25 ops (1 + 24 extra)
export const FORECAST_ERROR = 0.2; // inTicks is within ±20 % of the truth
const FORECAST_SALT = 0x46c3a5f1;

// ---------- effect numbers ----------
export const RAIN_WATER_PER_SEC = 0.03; // Soil tiles gain this (net +0.01/s against evaporation)
export const DROUGHT_EVAPORATION = 3; // water evaporates 3× faster
export const DROUGHT_DRY_GROWTH = 0.5; // half growth speed…
export const DROUGHT_WET_WATER = 0.5; // …unless the tile's water is ≥ 0.5
export const STORM_GROWTH = 1.5;
export const STORM_STRIKES = 3; // lightning moments per storm segment
export const STORM_MAX_TILES = 3; // each strikes 1…3 crop tiles
/** Entities lightning can destroy (planted crops incl. Rice; grass, dead crops, maze, dinosaur are spared). */
export const STRIKABLE = new Set(["Bush", "Tree", "Carrot", "Pumpkin", "Sunflower", "Cactus", "Rice"]);

// Demo farm: a fixed seed (the demo is never saved). Segment 0 of it is Rain.
export const DEMO_WEATHER_SEED = 12;

/** Per-state multipliers the world tick applies (Sunny = all neutral). */
export const WEATHER_EFFECTS = {
  Sunny: { growth: 1, dryGrowth: 1, evaporation: 1, rain: 0 },
  Rain: { growth: 1, dryGrowth: 1, evaporation: 1, rain: RAIN_WATER_PER_SEC },
  Storm: { growth: STORM_GROWTH, dryGrowth: 1, evaporation: 1, rain: 0 },
  Drought: { growth: 1, dryGrowth: DROUGHT_DRY_GROWTH, evaporation: DROUGHT_EVAPORATION, rain: 0 },
};
export const NO_WEATHER = WEATHER_EFFECTS.Sunny;

// ---------- seeds ----------

/**
 * hash32(a, b, …): a 32-bit mix of unsigned integers (murmur3-style
 * finalizer per part). h = 0x9e3779b9; for each part p:
 *   h = imul(h ^ (p >>> 0), 0x85ebca6b); h ^= h >>> 13;
 *   h = imul(h, 0xc2b2ae35); h ^= h >>> 16
 * → h >>> 0.
 */
export function hash32(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export const segmentOf = (tick) => Math.floor(Math.max(0, tick) / SEGMENT_TICKS);
export const segmentSeed = (seed, i) => hash32(seed, i);

function pickWeather(r) {
  let acc = 0;
  for (const w of WEATHER_STATES) {
    acc += WEATHER_WEIGHTS[w];
    if (r < acc) return w;
  }
  return WEATHER_STATES[WEATHER_STATES.length - 1];
}

/** Weather of segment i. */
export function segmentWeather(seed, i) {
  return pickWeather(mulberry32(segmentSeed(seed, i))());
}

/** Weather at a world tick. */
export const weatherAt = (seed, tick) => segmentWeather(seed, segmentOf(Math.floor(tick)));

/** Storm segment i: its strike ticks (absolute, sorted, inside the segment); [] otherwise. */
export function strikeMoments(seed, i) {
  const r = mulberry32(segmentSeed(seed, i));
  if (pickWeather(r()) !== "Storm") return [];
  const out = [];
  for (let k = 0; k < STORM_STRIKES; k++) out.push(i * SEGMENT_TICKS + 1 + Math.floor(r() * (SEGMENT_TICKS - 1)));
  return out.sort((a, b) => a - b);
}

/** Strike k of segment i: which of `candidates` (tile indices) are hit. */
export function strikeTargets(seed, i, k, candidates) {
  const r = mulberry32(hash32(segmentSeed(seed, i), k));
  const pool = candidates.slice();
  const count = Math.min(pool.length, 1 + Math.floor(r() * STORM_MAX_TILES));
  const hit = [];
  for (let n = 0; n < count; n++) hit.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return hit;
}

/** get_forecast() at world tick `tick` → { next, inTicks } (see the header). */
export function forecast(seed, tick) {
  const t = Math.max(0, Math.floor(tick));
  const i = segmentOf(t);
  const trueTicks = (i + 1) * SEGMENT_TICKS - t;
  const r = mulberry32(hash32(segmentSeed(seed, i), t, FORECAST_SALT));
  const u = r();
  let sign = r() < 0.5 ? -1 : 1;
  const err = Math.max(1, Math.floor(u * FORECAST_ERROR * trueTicks));
  if (trueTicks - err < 1) sign = 1;
  return { next: segmentWeather(seed, i + 1), inTicks: trueTicks + sign * err };
}

/** Ticks until the current segment ends (the true value the forecast blurs). */
export const ticksToChange = (tick) => (segmentOf(Math.floor(tick)) + 1) * SEGMENT_TICKS - Math.floor(Math.max(0, tick));

// ---------- state ----------

/** A new weather section: a fresh seed (drawn once per save), clock at 0. */
export const newWeather = (rng = Math.random) => ({ seed: randomSeed(rng), time: 0 });

/** A valid { seed, time } or null. */
export function sanitizeWeather(w) {
  if (!w || typeof w !== "object") return null;
  const seed = Number(w.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  const time = Number(w.time);
  return { seed, time: Number.isFinite(time) && time >= 0 ? time : 0 };
}

export const weatherLabel = (w) => (w ? `${WEATHER_ICONS[w]} ${w}` : "");

/** Log lines [kind, text] for the world events of a tick (weather changes, lightning). */
export function tickEventLines(events) {
  const out = [];
  for (const ev of events) {
    if (ev.type === "weather") out.push(["info", `Weather: ${weatherLabel(ev.to)} (was ${weatherLabel(ev.from)})`]);
    if (ev.type === "strike") {
      const what = ev.hits.map((h) => `${h.type} (${h.x}, ${h.y})`).join(", ");
      out.push(["warn", `⚡ Lightning struck ${ev.hits.length === 1 ? "a crop" : `${ev.hits.length} crops`}: ${what}`]);
    }
  }
  return out;
}
