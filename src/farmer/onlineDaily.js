// v5 phase 3: what the Online window's daily race section shows for one answer
// of GET /api/daily. Pure (no React, no DOM), so it is testable.
import { isDateString } from "./contracts.js";
import { parseSeed } from "./maze.js";

/** Board rows shown; the player's own row follows if it is further down. */
export const DAILY_TOP = 10;

const isCount = (v) => Number.isInteger(v) && v >= 0;

function cleanRow(e, meId) {
  if (!e || !isCount(e.rank) || !isCount(e.ticks) || !isCount(e.ops) || typeof e.name !== "string") return null;
  return { rank: e.rank, playerId: e.playerId ?? null, name: e.name, ticks: e.ticks, ops: e.ops, mine: meId !== null && e.playerId === meId };
}

/**
 * dailyView(data, meId) → { date, seed, size, rows (top 10), mine, outside, yesterday }
 *  mine: my best today, or null; outside: the same when it is not among `rows`.
 *  yesterday: { date, name, ticks } or null.
 *  null for an answer this client can't show; bad rows are skipped.
 */
export function dailyView(data, meId = null) {
  if (!data || !isDateString(data.date) || typeof data.seed !== "number" || parseSeed(data.seed) === null) return null;
  const all = (Array.isArray(data.board) ? data.board : []).map((e) => cleanRow(e, meId)).filter(Boolean);
  const rows = all.slice(0, DAILY_TOP);
  // The server sends `me` too: the board stops at 50 players.
  const me = cleanRow(data.me, meId);
  const mine = all.find((r) => r.mine) ?? (me?.mine ? me : null);
  const w = data.yesterday?.winner;
  return {
    date: data.date,
    seed: data.seed,
    size: isCount(data.size) ? data.size : null,
    rows,
    mine,
    outside: mine && !rows.includes(mine) ? mine : null,
    yesterday:
      isDateString(data.yesterday?.date) && typeof w?.name === "string" && isCount(w.ticks) ? { date: data.yesterday.date, name: w.name, ticks: w.ticks } : null,
  };
}
