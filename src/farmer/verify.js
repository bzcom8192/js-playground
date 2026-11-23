// Semicolon Acres Online (v4 phase 2) — headless replay of submitted programs, so
// the server can store results it measured itself (anti-cheat level 2).
//
// Pure engine code (no DOM, no Node APIs): it only wires the existing
// runtime.js / world.js / arena.js together, it does not re-implement any game
// rule. The server runs it inside a worker_thread with a wall-clock timeout
// (server/verifier.js); the arena's own caps make sure a run ends on its own
// long before that in normal cases.
//
// One verifiable context (BRIEF22 removed the maze, dino and daily race ones):
//  - Arena (friend challenges): runSolo() on the fixed arena world + goal for
//    the challenge seed — exactly what the client ran (same engine, same seed,
//    seeded Math.random) → { reached, ticks, ops }.

import { GOALS, runSolo } from "./arena.js";

/** Wall-clock limit for one verification (enforced by the server's worker). */
export const VERIFY_TIMEOUT_MS = 10_000;

// ---------- arena ----------

/**
 * verifyArena({ code, goal, seed }) → { kind: "arena", goal, seed, reached,
 *   ticks, ops, reason, error } — ticks = the tick the goal was reached, else
 *   DNF_TICKS (see arena.js runSolo).
 */
export async function verifyArena({ code, goal, seed }) {
  if (!GOALS[goal]) throw new Error(`unknown arena goal ${String(goal)}`);
  const r = await runSolo({ code: String(code ?? ""), goal, seed: seed >>> 0 });
  return { kind: "arena", goal, seed: r.seed, reached: r.reached, ticks: r.ticks, ops: r.ops, reason: r.reason, error: r.error, cut: r.cut };
}

/** Dispatch one job: { kind: "arena", code, goal, seed }. */
export function runVerification(job) {
  if (job?.kind === "arena") return verifyArena(job);
  return Promise.reject(new Error(`unknown verification kind ${String(job?.kind)}`));
}
