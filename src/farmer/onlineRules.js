// Semicolon Acres Online (v4 phase 1) — the rules shared by the Node server
// (server/) and the game client (onlineApi.js / OnlinePanel.jsx). Pure, no
// DOM, no Node APIs: both sides import this file, so the server validates
// with exactly the rules the client builds its payloads with.
//
// Anti-cheat (v4 phase 2) is LEVEL 2 for everything that can be replayed:
// the server re-runs the submitted program with this engine (src/farmer/
// verify.js, in a worker thread with a tick cap and a wall-clock timeout) and
// stores only what it measured itself — friend-arena challenges and results,
// and maze scores (the program, on the server's hidden maze of the week: see
// MAZE_BENCHMARK). v5 phase 2: dino scores too. The dinosaur is seeded now, so a dino
// score is the program itself, run by the server on one fixed benchmark farm
// (DINO_BENCHMARK). v5 phase 3: daily race entries are the program itself too,
// run on the day's course (dailyRace.js). See RESULT15.md / RESULT19.md / RESULT20.md.

import { UNLOCKS, WORLD_SIZES } from "./constants.js";
import { GOAL_IDS, eloExpected } from "./arenaRating.js";
import { DNF_TICKS as SOLO_DNF_TICKS, TICK_CAP } from "./arena.js";
import { RACE } from "./dailyRace.js";

export { GOAL_IDS };

export const NAME_MAX = 24;
export const ELO_START = 1000;
export const ELO_K = 32;
export const LEADERBOARD_LIMIT = 50;
export const CHALLENGE_LIST_LIMIT = 50;
/** v5: an unanswered challenge expires 7 days after it was created. */
export const CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** v5: events in GET /api/players/me/history. */
export const HISTORY_LIMIT = 20;
/** Longest program (characters) a challenge / result may carry. */
export const CODE_MAX = 100_000;

const maxLevel = (id) => UNLOCKS.find((u) => u.id === id)?.maxLevel ?? 0;

/** Maze levels on the leaderboard: 1 … Mazes max level (3). */
export const MAZE_LEVELS = Object.freeze(Array.from({ length: maxLevel("Mazes") }, (_, i) => i + 1));

/**
 * The maze leaderboard's benchmark (the farm itself: mazeVerifyWorld in
 * verify.js). The farm and the start tile are fixed; the maze's seed is NOT
 * here: the server derives it from its secret, the Bangkok ISO week and the
 * level (server/mazeBenchmark.js) and never sends it to anyone. `rngSeed` is
 * public: the program's Math.random() and the world's other randomness.
 */
export const MAZE_BENCHMARK = Object.freeze({ size: 12, sx: 0, sy: 0, rngSeed: 2112 });

/** The biggest Bone one harvest can pay: every tile of the largest farm cut at
 *  once, squared, × the top Dinosaurs level (12×12 → 144² × 3 = 62,208). */
export const DINO_MAX_BONE = (WORLD_SIZES[WORLD_SIZES.length - 1] ** 2) ** 2 * maxLevel("Dinosaurs");

/**
 * v5 phase 2: the dino leaderboard's benchmark, the same for everybody (the
 * farm itself: dinoVerifyWorld in verify.js). A `size` × `size` verification
 * farm covered in grown Grass, a dinosaur hatched on tile (x, y), the bot on
 * (0, 0); every dinosaur of the run — that one and any egg planted later — has
 * `seed`. The run lasts `worldTicks` world ticks of 100 ms: 300 s of farm time,
 * 1,000 dinosaur steps and 200 apple spawns.
 */
export const DINO_BENCHMARK = Object.freeze({ seed: 4188, size: 12, x: 6, y: 6, worldTicks: 3000 });

/** Arena (friend challenges): a run that did not reach the goal within the
 *  arena tick cap is reported with ticks = DNF_TICKS (always loses). */
export const ARENA_TICK_CAP = TICK_CAP;
export const DNF_TICKS = SOLO_DNF_TICKS; // = TICK_CAP + 1
export const ARENA_MAX_OPS = 10_000_000;
/** Goes up whenever game numbers change what an arena run measures (yields,
 *  growth times, prices). A challenge keeps the version it was posted under; an
 *  answer to an older one re-measures its author too, so both runs are played
 *  by the same numbers. 1: until BRIEF21 (stored as null). 2: its retune. */
export const RULES_VERSION = 2;

/** Leaderboard categories and their ordering rule (the daily race has its own
 *  board, GET /api/daily). */
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
 *  maze: level 1–3; `code` (required) is all that counts besides it: the server
 *        runs it on its hidden maze of the week (MAZE_BENCHMARK) and stores the
 *        ticks and ops IT measures. A seed, farm size, start tile, ticks or ops
 *        in the body are ignored; the seed is never filled in either.
 *  dino: no level; `code` (required) is all that counts: the server runs it on
 *        DINO_BENCHMARK and stores the Bone, ticks and ops IT measures. Claimed
 *        numbers (value, ticks, ops, seed) are accepted but ignored: they come
 *        from the player's own farm, not from the benchmark.
 *  daily: `code` (required) is all that counts: the server runs it on the course
 *        of ITS Bangkok date. Any date, seed, ticks or ops in the body are
 *        ignored; the seed here is null until the server fills it in.
 */
export function validateScore(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body must be a JSON object");
  const { code } = body;
  if (body.category === "daily") {
    if (!validCode(code)) return fail(`daily scores need code: a non-empty string of at most ${CODE_MAX} characters (the program, for the race)`);
    return { ok: true, score: { category: "daily", ticks: null, ops: null, value: null, seed: null, ...RACE, code } };
  }
  const q = validateBoardQuery(body.category, body.level);
  if (!q.ok) return q;
  if (q.category === "maze") {
    if (!validCode(code)) return fail(`maze scores need code: a non-empty string of at most ${CODE_MAX} characters (the program, for the benchmark run)`);
    const { size, sx, sy } = MAZE_BENCHMARK;
    return { ok: true, score: { category: "maze", level: q.level, ticks: null, ops: null, value: null, seed: null, size, sx, sy, code } };
  }
  if (!validCode(code)) return fail(`dino scores need code: a non-empty string of at most ${CODE_MAX} characters (the program, for the benchmark run)`);
  const { seed, size, x, y } = DINO_BENCHMARK;
  return { ok: true, score: { category: "dino", level: null, ticks: null, ops: null, value: null, seed, size, sx: x, sy: y, code } };
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
