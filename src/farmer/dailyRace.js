// Semicolon Acres Online (v5 phase 3) — the Daily Maze Race: the rules shared by
// the Node server and the client. Pure, no DOM, no Node APIs.
//
// Everybody races the same maze each day. The race date is the Bangkok calendar
// date; the seed is the daily contracts' FNV-1a hash of "YYYY-MM-DD", and the
// maze is drawn from mulberry32(seed) (maze.js), on the fixed course below.
// The course already stands when the program starts, with the bot on the start
// tile, and the clock runs from the start of the run (verifyDaily in verify.js).
import { dailySeed, isDateString } from "./contracts.js";

/** The course: farm size, Mazes level and start tile, the same every day. */
export const RACE = Object.freeze({ size: 8, level: 1, sx: 0, sy: 0 });

// Asia/Bangkok is UTC+7 all year (no daylight saving), so a fixed offset is exact.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Bangkok calendar date at `ms` (Unix time) as "YYYY-MM-DD". */
export const bangkokDate = (ms = Date.now()) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

/** The calendar day before a "YYYY-MM-DD" date. */
export const previousDate = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/**
 * The ISO-8601 week of the Bangkok calendar date at `ms` as "YYYY-Www" (weeks
 * start on Monday, 00:00 in Bangkok; the year is the one its Thursday is in).
 * The maze leaderboard's hidden maze changes with it.
 */
export function bangkokWeek(ms = Date.now()) {
  const day = Math.floor((ms + BANGKOK_OFFSET_MS) / DAY_MS); // days since 1970-01-01, a Thursday
  const thursday = day - ((((day + 3) % 7) + 7) % 7) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1) / DAY_MS) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The race of one date → { date, seed, size, level, sx, sy }. */
export function dailyCourse(date) {
  if (!isDateString(date)) throw new Error(`bad race date ${String(date)}`);
  return { date, seed: dailySeed(date), ...RACE };
}

/** Why a race run (a verifyDaily result) has no score. */
export function dailyFailText(r) {
  if (r.error) return `the program failed: ${r.error}`;
  if (r.reason === "wrong maze") return "the program solved another maze, not the race course";
  if (r.reason === "tick cap" || r.reason === "clock cap") return "the program did not reach the treasure within the tick limit";
  if (r.reason === "op budget") return "the program was cut off before the treasure (too many API calls)";
  return "the program ended without harvesting the treasure";
}
