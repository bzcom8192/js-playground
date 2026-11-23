// Semicolon Acres Online (v4 phase 1) — the rules shared by the Node server
// (server/) and the game client (onlineApi.js / OnlinePanel.jsx). Pure, no
// DOM, no Node APIs: both sides import this file, so the server validates
// with exactly the rules the client builds its payloads with.
//
// Anti-cheat (v4 phase 2) is LEVEL 2 for everything that can be replayed:
// the server re-runs the submitted program with this engine (src/farmer/
// verify.js, in a worker thread with a tick cap and a wall-clock timeout) and
// stores only what it measured itself: friend-arena challenges and results.
// BRIEF22 removed the maze, dino and daily race score categories (and their
// benchmarks); the server answers them as unknown categories.

import { GOAL_IDS, eloExpected } from "./arenaRating.js";
import { DNF_TICKS as SOLO_DNF_TICKS, TICK_CAP } from "./arena.js";

export { GOAL_IDS };

export const NAME_MAX = 24;
export const ELO_START = 1000;
export const ELO_K = 32;
export const CHALLENGE_LIST_LIMIT = 50;
/** v5: an unanswered challenge expires 7 days after it was created. */
export const CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** v5: events in GET /api/players/me/history. */
export const HISTORY_LIMIT = 20;
/** Longest program (characters) a challenge / result may carry. */
export const CODE_MAX = 100_000;

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
