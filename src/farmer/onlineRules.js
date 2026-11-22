// JS Farmer Online (v4 phase 1) — the rules shared by the Node server
// (server/) and the game client (onlineApi.js / OnlinePanel.jsx). Pure, no
// DOM, no Node APIs: both sides import this file, so the server validates
// with exactly the rules the client builds its payloads with.
//
// Anti-cheat (v4 phase 2) is LEVEL 2 for everything that can be replayed:
// the server re-runs the submitted program with this engine (src/farmer/
// verify.js, in a worker thread with a tick cap and a wall-clock timeout) and
// stores only what it measured itself — friend-arena challenges and results,
// and maze scores (which now carry their code + seed + farm size + start
// tile). Dino scores stay LEVEL 1 (trust + the sanity rules below): the
// dinosaur's walk is not seeded, so a harvest cannot be replayed. See
// RESULT15.md.

import { UNLOCKS, WORLD_SIZES } from "./constants.js";
import { GOAL_IDS, eloExpected } from "./arenaRating.js";
import { DNF_TICKS as SOLO_DNF_TICKS, TICK_CAP } from "./arena.js";

export { GOAL_IDS };

export const NAME_MAX = 24;
export const ELO_START = 1000;
export const ELO_K = 32;
export const LEADERBOARD_LIMIT = 50;
export const CHALLENGE_LIST_LIMIT = 50;
/** Longest program (characters) a challenge / result may carry. */
export const CODE_MAX = 100_000;

const maxLevel = (id) => UNLOCKS.find((u) => u.id === id)?.maxLevel ?? 0;

/** Maze levels on the leaderboard: 1 … Mazes max level (3). */
export const MAZE_LEVELS = Object.freeze(Array.from({ length: maxLevel("Mazes") }, (_, i) => i + 1));

// Sanity caps (far beyond anything a real run reaches, well below "absurd").
export const MAZE_MAX_TICKS = 100_000_000; // 500,000 actions inside one maze
export const MAZE_MAX_OPS = 100_000_000;
/** The biggest Bone one harvest can pay: every tile of the largest farm cut at
 *  once, squared, × the top Dinosaurs level (12×12 → 144² × 3 = 62,208). */
export const DINO_MAX_BONE = (WORLD_SIZES[WORLD_SIZES.length - 1] ** 2) ** 2 * maxLevel("Dinosaurs");
export const DINO_MAX_TICKS = 1_000_000_000;
export const DINO_MAX_OPS = 1_000_000_000;

/** Arena (friend challenges): a run that did not reach the goal within the
 *  arena tick cap is reported with ticks = DNF_TICKS (always loses). */
export const ARENA_TICK_CAP = TICK_CAP;
export const DNF_TICKS = SOLO_DNF_TICKS; // = TICK_CAP + 1
export const ARENA_MAX_OPS = 10_000_000;

/** Leaderboard categories and their ordering rule. */
export const CATEGORIES = Object.freeze({
  maze: Object.freeze({ id: "maze", levels: MAZE_LEVELS, order: "ticks asc, ops asc" }),
  dino: Object.freeze({ id: "dino", levels: null, order: "value desc" }),
});

const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const isSeed = (v) => isInt(v) && v >= 0 && v <= 0xffffffff;
const fail = (error) => ({ ok: false, error });
const validCode = (code) => typeof code === "string" && code.trim().length > 0 && code.length <= CODE_MAX;

// ---------- names ----------

/** A player name: trimmed, inner whitespace collapsed, 1–24 characters, no
 *  control characters. → { ok, name } | { ok: false, error } */
export function validateName(raw) {
  if (typeof raw !== "string") return fail("name must be a string");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return fail("name contains control characters");
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  const len = [...name].length;
  if (len < 1) return fail("name must not be empty");
  if (len > NAME_MAX) return fail(`name must be at most ${NAME_MAX} characters`);
  return { ok: true, name };
}

// ---------- leaderboard ----------

/** Query of GET /api/leaderboard → { ok, category, level } (level null for dino). */
export function validateBoardQuery(category, level) {
  const cat = CATEGORIES[category];
  if (!cat || !Object.hasOwn(CATEGORIES, category)) return fail("unknown category");
  if (!cat.levels) {
    if (level !== undefined && level !== null && level !== "") return fail(`category ${category} has no level`);
    return { ok: true, category, level: null };
  }
  const n = Number(level);
  if (!cat.levels.includes(n)) return fail(`unknown level for ${category} (use ${cat.levels.join(", ")})`);
  return { ok: true, category, level: n };
}

/**
 * Body of POST /api/scores → { ok, score: { category, level, ticks, ops, value, seed, … } }.
 *  maze: level 1–3, ticks ≥ 1, 1 ≤ ops ≤ ticks (every counted call but print /
 *        get_forecast costs at least one tick, see RESULT14.md), caps above.
 *        v4 phase 2: also the replay inputs — seed (required), size (a farm
 *        size), the start tile sx / sy and the program `code` — because the
 *        server replays the run and keeps ITS ticks / ops (the claimed ones
 *        are only sanity-checked). → score also has { size, sx, sy, code }.
 *  dino: no level, value = Bone of one harvest 1 … DINO_MAX_BONE; ticks / ops
 *        optional (if sent: positive and capped). Not replayable (level 1).
 */
export function validateScore(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body must be a JSON object");
  const q = validateBoardQuery(body.category, body.level);
  if (!q.ok) return q;
  const seed = body.seed === undefined || body.seed === null ? null : body.seed;
  if (seed !== null && !isSeed(seed)) return fail("seed must be a 32-bit unsigned integer");
  if (q.category === "maze") {
    const { ticks, ops, size, sx, sy, code } = body;
    if (!isInt(ticks) || ticks <= 0) return fail("ticks must be a positive integer");
    if (!isInt(ops) || ops <= 0) return fail("ops must be a positive integer");
    if (ops > ticks) return fail("ops cannot exceed ticks");
    if (ticks > MAZE_MAX_TICKS) return fail("ticks is out of range");
    if (ops > MAZE_MAX_OPS) return fail("ops is out of range");
    if (body.value !== undefined && body.value !== null) return fail("maze scores have no value");
    if (seed === null) return fail("maze scores need the maze seed (for the replay)");
    if (!isInt(size) || !WORLD_SIZES.includes(size)) return fail(`size must be a farm size (${WORLD_SIZES.join(", ")})`);
    if (!isInt(sx) || !isInt(sy) || sx < 0 || sy < 0 || sx >= size || sy >= size) return fail("sx / sy must be the start tile on the farm");
    if (!validCode(code)) return fail(`code must be a non-empty string of at most ${CODE_MAX} characters (the program, for the replay)`);
    return { ok: true, score: { category: "maze", level: q.level, ticks, ops, value: null, seed, size, sx, sy, code } };
  }
  const { value } = body;
  if (!isInt(value) || value <= 0) return fail("value must be a positive integer");
  if (value > DINO_MAX_BONE) return fail(`value is out of range (max ${DINO_MAX_BONE})`);
  const opt = (v, max, label) => {
    if (v === undefined || v === null) return { v: null };
    if (!isInt(v) || v <= 0) return { error: `${label} must be a positive integer` };
    if (v > max) return { error: `${label} is out of range` };
    return { v };
  };
  const t = opt(body.ticks, DINO_MAX_TICKS, "ticks");
  if (t.error) return fail(t.error);
  const o = opt(body.ops, DINO_MAX_OPS, "ops");
  if (o.error) return fail(o.error);
  return { ok: true, score: { category: "dino", level: null, ticks: t.v, ops: o.v, value, seed, size: null, sx: null, sy: null, code: null } };
}

/** Is leaderboard entry `a` better than `b` in `category`? */
export function betterScore(category, a, b) {
  if (!b) return true;
  if (category === "dino") return a.value > b.value;
  if (a.ticks !== b.ticks) return a.ticks < b.ticks;
  return a.ops < b.ops;
}

// ---------- friend arena ----------

/** Body of POST /api/challenges → { ok, challenge: { goal, seed, code } }.
 *  v4 phase 2: authorTicks / authorOps are still accepted (older clients send
 *  them) but IGNORED: the server replays the code and stores its own numbers. */
export function validateChallenge(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body must be a JSON object");
  const { goal, seed, code } = body;
  if (!GOAL_IDS.includes(goal)) return fail(`unknown goal (use ${GOAL_IDS.join(", ")})`);
  if (!isSeed(seed)) return fail("seed must be a 32-bit unsigned integer");
  if (!validCode(code)) return fail(`code must be a non-empty string of at most ${CODE_MAX} characters`);
  return { ok: true, challenge: { goal, seed, code } };
}

/** Body of POST /api/challenges/:id/results → { ok, result: { code } }.
 *  v4 phase 2: ticks / ops are accepted but IGNORED (the server replays the
 *  code on the challenge seed; a run that misses the goal counts DNF_TICKS). */
export function validateResult(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body must be a JSON object");
  const { code } = body;
  if (!validCode(code)) return fail(`code must be a non-empty string of at most ${CODE_MAX} characters`);
  return { ok: true, result: { code } };
}

/** Race outcome for side A: 1 win, 0 loss, 0.5 draw. Fewer ticks wins; equal
 *  ticks → fewer ops; both equal → draw. */
export function raceScore(a, b) {
  if (a.ticks !== b.ticks) return a.ticks < b.ticks ? 1 : 0;
  if (a.ops !== b.ops) return a.ops < b.ops ? 1 : 0;
  return 0.5;
}

/**
 * ELO for a player-vs-player game (K = 32, standard expected score).
 * scoreA: 1 / 0.5 / 0 for player A. The change is rounded to a whole point
 * and zero-sum: deltaB = −deltaA. → { deltaA, deltaB, ratingA, ratingB }
 */
export function eloUpdate(ratingA, ratingB, scoreA, k = ELO_K) {
  const deltaA = Math.round(k * (scoreA - eloExpected(ratingA, ratingB)));
  const deltaB = -deltaA || 0; // no −0
  return { deltaA, deltaB, ratingA: ratingA + deltaA, ratingB: ratingB + deltaB };
}

export const outcomeOf = (score) => (score === 1 ? "win" : score === 0 ? "loss" : "draw");
