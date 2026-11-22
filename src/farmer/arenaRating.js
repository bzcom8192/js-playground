// Semicolon Acres — arena rating + the save's `arena` section (pure, no DOM).
// Kept apart from arena.js (the match runner) so world.js can sanitize the
// section without importing the runtime.
//
//   arena = { rating, matches: [{ at, bot, goal, result, ticks, delta, seed }] }
//   rating starts at START_RATING; matches: newest last, at most MAX_HISTORY.
// Standard ELO against the bot's fixed rating, K = 32: win 1, draw ½, loss 0.

export const START_RATING = 1000;
export const ELO_K = 32;
export const MAX_HISTORY = 20;
/** The built-in bots' fixed ratings. */
export const BOT_RATINGS = Object.freeze({ rookie: 800, pro: 1200, ace: 1600 });
/** Goal preset ids (the presets themselves live in arena.js). */
export const GOAL_IDS = Object.freeze(["hay500", "wood800", "pumpkin300"]);
export const RESULTS = Object.freeze(["win", "draw", "loss"]);

// ---------- ELO ----------

/** Expected score of a player rated `rating` against `opponent`. */
export const eloExpected = (rating, opponent) => 1 / (1 + 10 ** ((opponent - rating) / 400));

export const resultScore = (result) => (result === "win" ? 1 : result === "draw" ? 0.5 : 0);

/** Rating change (rounded to a whole point) for `result` vs a bot rated `opponent`. */
export const eloDelta = (rating, opponent, result, k = ELO_K) => Math.round(k * (resultScore(result) - eloExpected(rating, opponent)));

// ---------- save section ----------

export const emptyArena = () => ({ rating: START_RATING, matches: [] });

const int = (v, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : null;
};

function cleanMatch(m) {
  if (!m || typeof m !== "object") return null;
  if (!Object.hasOwn(BOT_RATINGS, m.bot) || !GOAL_IDS.includes(m.goal) || !RESULTS.includes(m.result)) return null;
  const ticks = int(m.ticks);
  if (ticks === null) return null;
  const d = Number(m.delta);
  return {
    at: int(m.at) ?? 0,
    bot: m.bot,
    goal: m.goal,
    result: m.result,
    ticks,
    delta: Number.isFinite(d) ? Math.round(d) : 0,
    seed: int(m.seed) !== null && int(m.seed) <= 0xffffffff ? int(m.seed) : null,
  };
}

/** A clean arena section from anything (old saves: none → fresh 1000 rating). */
export function sanitizeArena(raw) {
  const out = emptyArena();
  if (!raw || typeof raw !== "object") return out;
  const r = Number(raw.rating);
  if (Number.isFinite(r) && r > -10000 && r < 10000) out.rating = Math.round(r);
  if (Array.isArray(raw.matches)) out.matches = raw.matches.map(cleanMatch).filter(Boolean).slice(-MAX_HISTORY);
  return out;
}

/**
 * Apply a finished match to the player's rating and history (newest last,
 * capped at MAX_HISTORY). Never on a demo farm. → { recorded, delta, rating, entry }
 */
export function recordMatch(state, match, at = Date.now()) {
  if (!state || state.demo) return { recorded: false, delta: 0, rating: state?.arena?.rating ?? START_RATING, entry: null };
  const arena = (state.arena = sanitizeArena(state.arena));
  if (!Object.hasOwn(BOT_RATINGS, match.bot) || !GOAL_IDS.includes(match.goal) || !RESULTS.includes(match.result)) {
    throw new Error("recordMatch: bad match");
  }
  const delta = eloDelta(arena.rating, BOT_RATINGS[match.bot], match.result);
  arena.rating += delta;
  const entry = cleanMatch({ at, bot: match.bot, goal: match.goal, result: match.result, ticks: match.ticks, delta, seed: match.seed });
  arena.matches.push(entry);
  if (arena.matches.length > MAX_HISTORY) arena.matches.splice(0, arena.matches.length - MAX_HISTORY);
  return { recorded: true, delta, rating: arena.rating, entry };
}

export const deltaText = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0");
