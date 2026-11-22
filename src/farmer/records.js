// Semicolon Acres — personal records (pure, no DOM). v3 phase 1.
//
// There is no server, so "leaderboard" means your own records: the best maze
// run per Mazes level, the full attempt history behind it (for histograms) and
// the best single dinosaur harvest. Records live in the world save
// (`state.records`, serialized by world.js) and so travel with Save Data
// export / import. A demo farm (`state.demo`) never writes records.
//
// Shapes:
//   records = { mazes: { [level]: { best: MazeAttempt, attempts: MazeAttempt[] } },
//               dino: DinoRecord | null }
//   MazeAttempt = { level, seed, size, sx, sy, ticks, ops, lines, chars, at }
//     ticks / ops: run counters at the treasure harvest minus at the maze spawn.
//     size, sx, sy: farm size and start tile (the layout depends on them too).
//     lines / chars: program size of the main file (non-empty lines, characters).
//     at: Date.now() of the solve.
//   DinoRecord = { bone, level, cut, at, seed, size, sx, sy } — one harvest's
//     Bone, the Dinosaurs level and how many segments that cut removed.
//     seed, size, sx, sy (v5): the dinosaur's seed, the farm size and its
//     hatching tile (sx, sy null: it hatched before seeds existed). Records
//     from older saves have none of the four.
//   contracts = { completed, bonus: { Gold, Bone } } — v3 phase 2: daily
//     contracts delivered in total and the reward earned per reward item
//     (see contracts.js). Older saves have none and load with zeros.

import { parseSeed } from "./maze.js";

/** Attempts kept per Mazes level (the oldest are dropped; `best` is kept apart). */
export const MAX_ATTEMPTS = 100;
export const HISTOGRAM_BUCKETS = 10;

export const CONTRACT_BONUS_ITEMS = ["Gold", "Bone"];
const emptyContractStats = () => ({ completed: 0, bonus: Object.fromEntries(CONTRACT_BONUS_ITEMS.map((k) => [k, 0])) });

export const emptyRecords = () => ({ mazes: {}, dino: null, contracts: emptyContractStats() });

/** Records are written only to a real (non-demo) farm. */
export const canRecord = (state) => !!state && !state.demo;

/** Is maze attempt `a` better than `b`? Fewest ticks, then fewest ops. */
export function betterMaze(a, b) {
  if (!b) return true;
  if (a.ticks !== b.ticks) return a.ticks < b.ticks;
  return a.ops < b.ops;
}

function ensure(state) {
  if (!state.records || typeof state.records !== "object") state.records = emptyRecords();
  if (!state.records.mazes || typeof state.records.mazes !== "object") state.records.mazes = {};
  return state.records;
}

/**
 * Append a solved-maze attempt; keeps the last MAX_ATTEMPTS per level and the
 * best one. → { recorded, best, previous } (best: the attempt is the new best).
 */
export function addMazeAttempt(state, attempt) {
  if (!canRecord(state)) return { recorded: false, best: false, previous: null };
  const recs = ensure(state);
  const key = String(attempt.level);
  const entry = (recs.mazes[key] ||= { best: null, attempts: [] });
  entry.attempts.push(attempt);
  if (entry.attempts.length > MAX_ATTEMPTS) entry.attempts.splice(0, entry.attempts.length - MAX_ATTEMPTS);
  const previous = entry.best;
  const best = betterMaze(attempt, previous);
  if (best) entry.best = attempt;
  return { recorded: true, best, previous };
}

/** A dinosaur harvest; only the biggest single Bone haul is kept. → { recorded, best } */
export function addDinoHarvest(state, rec) {
  if (!canRecord(state)) return { recorded: false, best: false };
  const recs = ensure(state);
  const best = !recs.dino || rec.bone > recs.dino.bone;
  if (best) recs.dino = rec;
  return { recorded: true, best };
}

/** A delivered contract: +1 completed, + its reward to the bonus total. */
export function addContractDone(state, contract) {
  if (!canRecord(state)) return { recorded: false };
  const recs = ensure(state);
  if (!recs.contracts || typeof recs.contracts !== "object") recs.contracts = emptyContractStats();
  const st = recs.contracts;
  st.bonus ||= {};
  st.completed = (st.completed || 0) + 1;
  st.bonus[contract.rewardItem] = (st.bonus[contract.rewardItem] || 0) + contract.reward;
  return { recorded: true };
}

// ---------- persistence ----------

const nonNeg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

function cleanAttempt(a, level) {
  if (!a || typeof a !== "object") return null;
  const seed = parseSeed(a.seed);
  const ticks = nonNeg(a.ticks);
  const ops = nonNeg(a.ops);
  if (seed === null || ticks === null || ops === null) return null;
  return {
    level,
    seed,
    size: nonNeg(a.size) ?? 0,
    sx: nonNeg(a.sx) ?? 0,
    sy: nonNeg(a.sy) ?? 0,
    ticks,
    ops,
    lines: nonNeg(a.lines) ?? 0,
    chars: nonNeg(a.chars) ?? 0,
    at: nonNeg(a.at) ?? 0,
  };
}

/** Clean records from a save; anything missing or damaged → empty. */
export function sanitizeRecords(raw) {
  const out = emptyRecords();
  if (!raw || typeof raw !== "object") return out;
  if (raw.mazes && typeof raw.mazes === "object") {
    for (const [key, e] of Object.entries(raw.mazes)) {
      const level = Number(key);
      if (!Number.isInteger(level) || level < 1 || level > 99 || !e || typeof e !== "object") continue;
      const attempts = (Array.isArray(e.attempts) ? e.attempts : [])
        .map((a) => cleanAttempt(a, level))
        .filter(Boolean)
        .slice(-MAX_ATTEMPTS);
      let best = cleanAttempt(e.best, level);
      for (const a of attempts) if (betterMaze(a, best)) best = a;
      if (best || attempts.length) out.mazes[String(level)] = { best, attempts };
    }
  }
  const d = raw.dino;
  if (d && typeof d === "object") {
    const bone = nonNeg(d.bone);
    if (bone !== null && bone > 0) {
      out.dino = { bone, level: nonNeg(d.level) ?? 1, cut: nonNeg(d.cut) ?? 1, at: nonNeg(d.at) ?? 0 };
      const seed = parseSeed(d.seed);
      if (seed !== null) {
        const tile = (v) => (v === null || v === undefined ? null : nonNeg(v));
        const sx = tile(d.sx);
        const sy = tile(d.sy);
        const known = sx !== null && sy !== null;
        Object.assign(out.dino, { seed, size: nonNeg(d.size) ?? 0, sx: known ? sx : null, sy: known ? sy : null });
      }
    }
  }
  const c = raw.contracts;
  if (c && typeof c === "object") {
    out.contracts.completed = nonNeg(c.completed) ?? 0;
    for (const k of CONTRACT_BONUS_ITEMS) out.contracts.bonus[k] = nonNeg(c.bonus?.[k]) ?? 0;
  }
  return out;
}

/** Deep copy for serialization. */
export const copyRecords = (recs) => sanitizeRecords(recs);

export const hasRecords = (recs) => !!recs && (!!recs.dino || Object.keys(recs.mazes || {}).length > 0);

// ---------- display helpers ----------

/** Program size of a file: non-empty lines and characters. */
export function programSize(code) {
  const text = String(code ?? "");
  return { lines: text.split("\n").filter((l) => l.trim()).length, chars: text.length };
}

/**
 * Bucket `values` into at most `buckets` equal-width integer ranges from min to
 * max → [{ from, to, count }] (inclusive bounds). [] for no values.
 */
export function histogram(values, buckets = HISTOGRAM_BUCKETS) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min + 1;
  const n = Math.max(1, Math.min(buckets, span));
  const width = Math.ceil(span / n);
  const out = [];
  for (let i = 0; i < n && min + i * width <= max; i++) {
    out.push({ from: min + i * width, to: Math.min(max, min + (i + 1) * width - 1), count: 0 });
  }
  for (const v of values) out[Math.min(out.length - 1, Math.floor((v - min) / width))].count++;
  return out;
}
