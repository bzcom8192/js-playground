// Semicolon Acres Online (v4 phase 2) — headless replay of submitted programs, so
// the server can store results it measured itself (anti-cheat level 2).
//
// Pure engine code (no DOM, no Node APIs): it only wires the existing
// runtime.js / world.js / arena.js / maze.js together on a virtual clock, it
// does not re-implement any game rule. The server runs it inside a
// worker_thread with a wall-clock timeout (server/verifier.js); the caps here
// make sure a run ends on its own long before that in normal cases.
//
// Four verifiable contexts:
//  - Arena (friend challenges): runSolo() on the fixed arena world + goal for
//    the challenge seed — exactly what the client ran (same engine, same seed,
//    seeded Math.random) → { reached, ticks, ops }.
//  - Maze (leaderboard): the maze is fully determined by (seed, farm size,
//    start tile). The replay world is a fixed "verification farm" of that
//    size (everything unlocked at its top level except Mazes = the record's
//    level; every tile a grown Bush; plenty of every item; no weather) with
//    the drone on the start tile and the record's seed queued as the next
//    maze seed (state.pendingSeed, the Records window's replay mechanism).
//    1. "spawn" mode: the program runs from the top, as it did on the
//       player's farm. The first maze it spawns uses the queued seed; when it
//       is spawned on the recorded start tile it IS the recorded maze, and the
//       runtime times it exactly like on the page (counters at the treasure
//       harvest minus at the maze spawn).
//    2. "prespawned" mode (fallback, only if mode 1 never spawned the
//       recorded maze, e.g. the program's setup depends on the player's own
//       farm): the maze is generated before Run and timed from the run start.
//    solved = the recorded maze's treasure was harvested.
//  - Dino (leaderboard, v5 phase 2): the program runs from the top on ONE fixed
//    benchmark (DINO_BENCHMARK in onlineRules.js: the verification farm under
//    grass, a pre-planted dinosaur with a fixed seed), so a score is a function
//    of the program alone. It runs until it ends or the benchmark's farm time
//    is over; the result is its largest single dinosaur harvest, with the run
//    counters at that harvest → { harvested, bone, ticks, ops }.
//  - Daily race (v5 phase 3): the day's maze on the fixed RACE course
//    (dailyRace.js), on the maze farm above, always "prespawned": the maze
//    stands when the program starts and is timed from the run start. "spawn"
//    mode is not offered, because a program that grows the maze itself can
//    first park bots where it knows the treasure will be.

import { UNLOCKS, WORLD_SIZES } from "./constants.js";
import { mulberry32 } from "./maze.js";
import { createRuntime } from "./runtime.js";
import * as W from "./world.js";
import { GOALS, OP_BUDGET, TICK_MS, runSolo } from "./arena.js";
import { RACE } from "./dailyRace.js";
import { DINO_BENCHMARK } from "./onlineRules.js";

/** Wall-clock limit for one verification (enforced by the server's worker). */
export const VERIFY_TIMEOUT_MS = 10_000;
/** Maze replay: run-clock ticks (whole run, setup included) before it is cut
 *  off as unverifiable — 25,000 plain actions. */
export const MAZE_VERIFY_TICK_CAP = 5_000_000;
/** Maze replay: virtual milliseconds (loops that wait without acting). */
export const MAZE_VERIFY_CLOCK_CAP = 5_000_000;
/** Maze replay: API calls before the run is cut off (as in the arena). */
export const MAZE_VERIFY_OP_BUDGET = OP_BUDGET;
/** Dino benchmark: farm time (virtual ms) and API calls before the run ends.
 *  What was harvested until then counts. No separate run-clock cap: at the
 *  farm's Speed the run clock is bounded by these two. */
export const DINO_VERIFY_CLOCK_CAP = DINO_BENCHMARK.worldTicks * TICK_MS;
export const DINO_VERIFY_OP_BUDGET = OP_BUDGET;
/** Every item on the verification farm starts at this amount (Power: 0). */
export const VERIFY_STOCK = 1_000_000;

// Captured once at load, so a program that reassigns globals can't touch the driver.
const setImm = typeof globalThis.setImmediate === "function" ? globalThis.setImmediate : null;
const Channel = typeof MessageChannel === "function" ? MessageChannel : null;
const setTo = globalThis.setTimeout;
const macrotask = () =>
  new Promise((r) => {
    if (setImm) setImm(r);
    else if (Channel) {
      const ch = new Channel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    } else setTo(r, 0);
  });

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

// ---------- maze ----------

/** The verification farm: size × size, every unlock at its top level (Expand =
 *  the size), a grown `crop` on every tile, plenty of every item, no weather. */
function verifyFarm(size, crop, rng) {
  const state = W.createGame();
  for (const u of UNLOCKS) state.unlocks[u.id] = u.maxLevel;
  state.unlocks.Expand = WORLD_SIZES.indexOf(size);
  state.size = size;
  state.tiles = Array.from({ length: size * size }, () => {
    const t = W.newTile();
    t.entity = W.makeEntity(crop, rng, 1);
    return t;
  });
  for (const k of Object.keys(state.items)) state.items[k] = VERIFY_STOCK;
  state.items.Power = 0;
  state.arena = null;
  state.weather = null;
  return state;
}

/**
 * The maze verification farm (see the header). prespawned: generate the maze
 * now (consuming the queued seed) instead of leaving it to the program.
 * → { state, rng }
 */
export function mazeVerifyWorld({ seed, size, sx, sy, level }, { prespawned = false } = {}) {
  if (!WORLD_SIZES.includes(size)) throw new Error(`bad farm size ${String(size)}`);
  if (!(sx >= 0 && sy >= 0 && sx < size && sy < size)) throw new Error("start tile is off the farm");
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const state = verifyFarm(size, "Bush", rng);
  state.unlocks.Mazes = level;
  state.drone.x = sx;
  state.drone.y = sy;
  state.pendingSeed = seed >>> 0;
  if (prespawned) W.spawnMaze(state, rng);
  return { state, rng };
}

/**
 * One program on one world, headless, on a virtual clock (the arena's driver
 * pattern for a single side: run until every drone waits on a timer, jump the
 * clock to the earliest timer, world growth on a fixed TICK_MS grid).
 * check() → a truthy value ends the run (reason "done", value in `found`).
 * onRecord(ev, stats): a new best on this world, with the run counters then.
 */
async function runVirtual({ code, state, rng, seed, check, tickCap, clockCap, opBudget, timeExistingMaze = false, onRecord = () => {}, mapLine }) {
  const clock = { t: 0 };
  let timers = [];
  let seq = 0;
  let ended = false;
  let error = null;
  const sleep = (ms) =>
    new Promise((r) => {
      if (ended) return;
      timers.push({ at: clock.t + Math.max(0, ms), seq: seq++, r });
    });
  const rt = createRuntime({
    getState: () => state,
    onLog: (e) => {
      if (e.kind === "error" && error === null) error = e.text;
    },
    now: () => clock.t,
    sleep,
    yieldFn: () => sleep(0),
    rng,
    mathRandom: mulberry32((seed ^ 0x9e3779b9) >>> 0),
    wallClock: () => 0,
    today: () => "2000-01-01",
    timeExistingMaze,
    onRecord: (ev) => onRecord(ev, rt.stats()),
  });
  rt.run(String(code ?? ""), { mapLine }).then(() => (ended = true));
  let gridT = 0;
  const advanceTo = (target) => {
    while (gridT + TICK_MS <= target) {
      gridT += TICK_MS;
      W.tick(state, TICK_MS / 1000, rng);
    }
    clock.t = Math.max(clock.t, target);
  };
  let reason;
  let found = null;
  try {
    for (;;) {
      await macrotask(); // every microtask (all program code) has run
      if (!ended && !rt.isRunning()) ended = true;
      found = check();
      if (found) {
        reason = "done";
        break;
      }
      if (ended) {
        reason = error ? "error" : "ended";
        break;
      }
      const st = rt.stats();
      if (st.ops > opBudget) {
        reason = "op budget";
        break;
      }
      if (st.runTicks > tickCap) {
        reason = "tick cap";
        break;
      }
      let next = Infinity;
      for (const tm of timers) if (tm.at < next) next = tm.at;
      if (next === Infinity) {
        reason = "idle"; // every drone waits forever: nothing can change
        break;
      }
      if (next > clockCap) {
        reason = "clock cap";
        break;
      }
      advanceTo(next);
      const due = timers.filter((tm) => tm.at <= clock.t).sort((a, b) => a.at - b.at || a.seq - b.seq);
      timers = timers.filter((tm) => tm.at > clock.t);
      for (const tm of due) tm.r();
    }
  } finally {
    rt.stop(true);
    ended = true;
    timers = [];
  }
  return { reason, found, error, stats: rt.stats() };
}

const sameStart = (m, sx, sy) => !!m?.start && m.start.x === sx && m.start.y === sy;

async function mazeAttempt(job, prespawned) {
  const { seed, size, sx, sy, level } = job;
  const { state, rng } = mazeVerifyWorld(job, { prespawned });
  const key = String(level);
  let spawned = prespawned; // has the recorded maze been spawned?
  let wrongStart = null;
  const check = () => {
    const m = state.maze;
    if (!spawned && m && m.seed === seed) {
      if (sameStart(m, sx, sy)) spawned = true;
      else {
        wrongStart = { x: m.start.x, y: m.start.y };
        return { mismatch: true };
      }
    }
    const a = state.records?.mazes?.[key]?.attempts?.[0];
    if (!a) return null;
    // The first timed solve of this run is the recorded maze (the queued seed
    // is used by the first spawn; anything else was caught above).
    if (a.seed === seed && a.size === size && a.sx === sx && a.sy === sy) return { attempt: a };
    return { mismatch: true };
  };
  const r = await runVirtual({
    code: job.code,
    state,
    rng,
    seed,
    check,
    tickCap: MAZE_VERIFY_TICK_CAP,
    clockCap: MAZE_VERIFY_CLOCK_CAP,
    opBudget: MAZE_VERIFY_OP_BUDGET,
    timeExistingMaze: prespawned,
    mapLine: job.mapLine,
  });
  const a = r.found?.attempt;
  return {
    kind: "maze",
    mode: prespawned ? "prespawned" : "spawn",
    solved: !!a,
    spawned,
    ticks: a ? a.ticks : null,
    ops: a ? a.ops : null,
    reason: a ? "solved" : r.found?.mismatch ? "wrong maze" : r.reason,
    wrongStart,
    error: a ? null : r.error,
  };
}

/**
 * verifyMaze({ code, level, seed, size, sx, sy }) → { kind: "maze", mode,
 *   solved, ticks, ops, reason, error, … }. Tries "spawn" mode, then
 *   "prespawned" mode if the program never spawned the recorded maze.
 */
export async function verifyMaze(job) {
  const j = { code: String(job.code ?? ""), level: job.level, seed: job.seed >>> 0, size: job.size, sx: job.sx, sy: job.sy };
  const first = await mazeAttempt(j, false);
  if (first.solved || first.spawned) return first;
  const second = await mazeAttempt(j, true);
  if (second.solved) return { ...second, firstTry: first.reason };
  // Report why the program-spawned attempt failed too.
  return { ...second, firstTry: first.reason, wrongStart: first.wrongStart };
}

// ---------- daily race ----------

/**
 * verifyDaily({ code, seed, mapLine }) → { kind: "daily", seed, solved, ticks,
 *   ops, reason, error } — the program on the race course grown from `seed`.
 *   The server calls it with its own date's seed; the client with the seed the
 *   server told it (mapLine: error lines → the player's files).
 */
export async function verifyDaily({ code, seed, mapLine }) {
  const s = seed >>> 0;
  const r = await mazeAttempt({ code, seed: s, mapLine, ...RACE }, true);
  return { kind: "daily", seed: s, solved: r.solved, ticks: r.ticks, ops: r.ops, reason: r.reason, error: r.error };
}

// ---------- dino ----------

/**
 * The dino benchmark farm (see DINO_BENCHMARK): everything unlocked at its top
 * level, grown Grass everywhere, the stock of the maze farm but no Bone (a
 * program may count its Bone), the dinosaur already hatched. → { state, rng }
 */
export function dinoVerifyWorld() {
  const { seed, size, x, y } = DINO_BENCHMARK;
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const state = verifyFarm(size, "Grass", rng);
  state.items.Bone = 0;
  state.dinoSeed = seed;
  W.hatchDino(state, rng, { x, y });
  return { state, rng };
}

/**
 * verifyDino({ code }) → { kind: "dino", harvested, bone, cut, ticks, ops,
 *   reason, error } — the largest single dinosaur harvest of the run (the first
 *   one, if several are equal) and the run counters at that moment. A program
 *   that fails or is cut off later keeps what it had harvested by then.
 */
export async function verifyDino({ code }) {
  const { state, rng } = dinoVerifyWorld();
  let best = null;
  const r = await runVirtual({
    code,
    state,
    rng,
    seed: DINO_BENCHMARK.seed,
    check: () => null,
    tickCap: Infinity,
    clockCap: DINO_VERIFY_CLOCK_CAP,
    opBudget: DINO_VERIFY_OP_BUDGET,
    onRecord: (ev, stats) => {
      if (ev.kind === "dino") best = { bone: ev.rec.bone, cut: ev.rec.cut, ticks: stats.runTicks, ops: stats.ops };
    },
  });
  return {
    kind: "dino",
    harvested: !!best,
    bone: best ? best.bone : null,
    cut: best ? best.cut : null,
    ticks: best ? best.ticks : null,
    ops: best ? best.ops : null,
    reason: r.reason,
    error: r.error,
  };
}

/** Dispatch one job: { kind: "arena", code, goal, seed } | { kind: "maze", code, level, seed, size, sx, sy } | { kind: "dino", code } | { kind: "daily", code, seed }. */
export function runVerification(job) {
  if (job?.kind === "arena") return verifyArena(job);
  if (job?.kind === "maze") return verifyMaze(job);
  if (job?.kind === "dino") return verifyDino(job);
  if (job?.kind === "daily") return verifyDaily(job);
  return Promise.reject(new Error(`unknown verification kind ${String(job?.kind)}`));
}
