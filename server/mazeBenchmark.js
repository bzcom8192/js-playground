// Semicolon Acres Online — the maze leaderboard's hidden seed (server only: the
// game client never imports this file, and no endpoint answers with the seed).
//
// seed = HMAC-SHA256(server secret, "maze-benchmark:<week>:L<level>"), first 32
// bits. Everybody who submits to one level in one Bangkok ISO week runs on the
// same maze; without the secret it can't be computed for any week. Each level
// has its own maze, so a run on one board says nothing about another.
import { createHmac } from "node:crypto";
import { bangkokWeek } from "../src/farmer/dailyRace.js";

export const SECRET_MIN = 16;

/** A secret given by the operator, or an Error if it is too short to be one. */
export function checkSecret(secret) {
  if (typeof secret !== "string" || secret.length < SECRET_MIN) throw new Error(`the server secret must be a string of at least ${SECRET_MIN} characters`);
  return secret;
}

export function mazeSeed(secret, period, level) {
  return createHmac("sha256", checkSecret(secret)).update(`maze-benchmark:${period}:L${level}`).digest().readUInt32BE(0);
}

/** The benchmark at time `ms` → { period, seed(level) }. */
export function mazeBenchmark(secret, ms) {
  const period = bangkokWeek(ms);
  return { period, seed: (level) => mazeSeed(secret, period, level) };
}
