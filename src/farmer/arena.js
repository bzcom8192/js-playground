// Semicolon Acres — Async Arena + ELO (pure, no DOM). v3 phase 3.
//
// A match races the player's program against a built-in bot. Each side gets
// its OWN fresh 8×8 world (built from the same seed, so both start
// identically) and its OWN runtime, and both run HEADLESS on one shared
// virtual clock: nothing waits for wall time, so a match finishes as fast as
// the programs can be stepped.
//
// Virtual clock (the Megafarm test driver pattern): every runtime sleep
// registers a timer on its side's queue; the driver lets all programs run
// until each one waits on a timer, then jumps the clock to the earliest timer
// of either side and resolves every timer due at that instant. World growth
// ticks on a FIXED grid (every TICK_MS of virtual time, like the page's game
// loop), never at timer boundaries, so one side's timing can never change
// the other side's world: the two farms only share the clock.
//
// Match ticks = virtual milliseconds of game time (1 tick = 1 ms; an action
// is 200 ticks before Speed / Power, so "200,000 ticks" = 1,000 base actions).
//
// Determinism: every random draw comes from mulberry32(seed): the starting
// world, the world rng (petals, cactus sizes, rotten pumpkins), and the
// program's own Math.random (a separate, identically seeded stream per side).
// Yields go through the virtual queue too. Same seed + same two programs →
// the same winner, ticks and amounts on every run.
//
// Isolation: a match only ever touches the two throwaway worlds it creates
// (and their runtimes). The player's world, save, records and contracts are
// written only afterwards, by recordMatch(), into `state.arena`.
//
// Save section (in `farmer_save_v1`, own section, not in records):
//   arena = { rating, matches: [{ at, bot, goal, result, ticks, delta, seed }] }
//   (newest last, at most MAX_HISTORY).

import { WORLD_SIZES } from "./constants.js";
import { mulberry32, randomSeed } from "./maze.js";
import { createRuntime } from "./runtime.js";
import * as W from "./world.js";
import { BOT_CODE } from "./arenaBots.js";
import { BOT_RATINGS, GOAL_IDS } from "./arenaRating.js";

export * from "./arenaRating.js";

export const ARENA_SIZE = 8;
export const TICK_CAP = 200_000;
// API calls one side may make in a match before it is cut off.
export const OP_BUDGET = 2_000_000;
export const TICK_MS = 100; // world growth step (virtual ms), as on the page

/**
 * The fixed arena unlock set: everything up to Megafarm at level 1, the farm
 * at 8×8 — except Speed (level 0: buying it is part of the race), Mazes /
 * Dinosaurs (locked: maze and dinosaur goals are out of scope, and with them
 * the only fresh-world Gold source is gone) and Rice (locked: rice goals are
 * out of scope, and Rice → Gold would bring a Gold source back). Bots may still buy upgrades with
 * unlock() like on a normal farm.
 */
export const ARENA_UNLOCKS = Object.freeze({
  Speed: 0,
  Expand: WORLD_SIZES.indexOf(ARENA_SIZE),
  Plant: 1,
  Senses: 1,
  Grass: 1,
  Carrots: 1,
  Trees: 1,
  Watering: 1,
  Pumpkins: 1,
  Sunflowers: 1,
  Fertilizer: 1,
  Rice: 0, // v3 phase 5: no rice in the arena (no rice goal; see RESULT13.md)
  Cactus: 1,
  Mazes: 0,
  Dinosaurs: 0,
  Megafarm: 1,
});

/** Goal presets: first to HOLD `amount` of `item` wins. (No gold200, see RESULT11.md.) */
export const GOALS = Object.freeze({
  hay500: Object.freeze({ id: "hay500", item: "Hay", amount: 500, label: "500 Hay" }),
  wood800: Object.freeze({ id: "wood800", item: "Wood", amount: 800, label: "800 Wood" }),
  pumpkin300: Object.freeze({ id: "pumpkin300", item: "Pumpkin", amount: 300, label: "300 Pumpkin" }),
});
if (Object.keys(GOALS).join() !== GOAL_IDS.join()) throw new Error("arena: GOALS and GOAL_IDS disagree");

/** Built-in opponents: fixed ratings, plain source strings (no privileges). */
export const BOTS = Object.freeze({
  rookie: Object.freeze({ id: "rookie", name: "Rookie", rating: BOT_RATINGS.rookie, code: BOT_CODE.rookie, desc: "Spiral farmer: Hay and Wood only, walks a lot." }),
  pro: Object.freeze({ id: "pro", name: "Pro", rating: BOT_RATINGS.pro, code: BOT_CODE.pro, desc: "Structured ensure_* farmer: Speed, then hay → wood → carrot → pumpkin." }),
  ace: Object.freeze({ id: "ace", name: "Ace", rating: BOT_RATINGS.ace, code: BOT_CODE.ace, desc: "Pro with a full Megafarm crew (8 bots) and tighter loops." }),
});
export const BOT_IDS = Object.keys(BOTS);

// ---------- worlds ----------

/**
 * A fresh arena world from `seed`: 8×8 Grassland, grass on every tile at a
 * seeded growth stage, empty inventory, the arena unlock set. → { state, rng }
 * where rng is the world's random stream (the same seed gives the same stream).
 */
export function arenaWorld(seed) {
  const rng = mulberry32(seed >>> 0);
  const state = W.createGame();
  Object.assign(state.unlocks, ARENA_UNLOCKS);
  state.size = ARENA_SIZE;
  state.tiles = Array.from({ length: ARENA_SIZE * ARENA_SIZE }, () => {
    const t = W.newTile();
    t.entity = W.makeEntity("Grass", rng, rng());
    return t;
  });
  state.arena = null; // a throwaway world has no rating of its own
  return { state, rng };
}

// ---------- the match runner ----------

const defaultMacrotask = () =>
  new Promise((r) => {
    if (typeof globalThis.setImmediate === "function") globalThis.setImmediate(r);
    else if (typeof MessageChannel === "function") {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    } else setTimeout(r, 0);
  });
const defaultUiPause = () => new Promise((r) => setTimeout(r, 0));
const defaultWallNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function makeSide(id, label, code, { seed, goal, clock, mapLine }) {
  const { state, rng } = arenaWorld(seed);
  const side = {
    id,
    label,
    state,
    rng,
    timers: [],
    seq: 0,
    error: null, // first error log line (a bot that errors loses)
    errorAt: null,
    reachedAt: null,
    cut: null, // "op budget" when cut off
    ended: false, // its program is no longer running
    maxDrones: 1,
    rt: null,
  };
  const sleep = (ms) =>
    new Promise((r) => {
      if (side.ended) return; // a finished side's stray sleeps never settle
      side.timers.push({ at: clock.t + Math.max(0, ms), seq: side.seq++, r });
    });
  side.rt = createRuntime({
    getState: () => state,
    onLog: (e) => {
      if (e.kind === "error" && side.error === null) {
        side.error = e.text;
        side.errorAt = clock.t;
      }
    },
    onDroneError: () => {
      if (side.errorAt === null) side.errorAt = clock.t;
    },
    now: () => clock.t,
    sleep,
    yieldFn: () => sleep(0),
    rng,
    mathRandom: mulberry32((seed ^ 0x9e3779b9) >>> 0),
    wallClock: () => 0,
    today: () => "2000-01-01",
    arenaGoal: { item: goal.item, amount: goal.amount },
  });
  side.done = side.rt.run(code, { mapLine });
  side.done.then(() => (side.ended = true));
  side.amount = () => state.items[goal.item] || 0;
  return side;
}

/**
 * runMatch({ code, bot, goal, seed, mapLine, tickCap, opBudget, onProgress })
 *  code: the player's (combined) program; bot: a BOTS id; goal: a GOALS id.
 *  seed: 32-bit match seed (default: a random one, reported in the result).
 *  onProgress({ ticks, you, bot, cap }) is called now and then (UI).
 *  botCode: run this source as the opponent instead of the bot's own code
 *  (tests; the bot's name and rating still apply).
 * Resolves with:
 *  { goal, bot, seed, ticks, result: "win"|"draw"|"loss" (for the player),
 *    winner: "you"|"bot"|"draw", reason: "goal"|"error"|"cap"|"idle", text,
 *    amounts: { you, bot }, sides: { you, bot }: { amount, reachedAt, error, cut, drones, ops } }
 */
export async function runMatch(opts) {
  const {
    code,
    bot: botId,
    goal: goalId,
    mapLine,
    tickCap = TICK_CAP,
    opBudget = OP_BUDGET,
    onProgress = () => {},
    macrotask = defaultMacrotask,
    uiPause = defaultUiPause,
    wallNow = defaultWallNow,
    uiEveryMs = 30,
  } = opts;
  const bot = BOTS[botId];
  const goal = GOALS[goalId];
  if (!bot) throw new Error(`Unknown arena bot ${String(botId)}`);
  if (!goal) throw new Error(`Unknown arena goal ${String(goalId)}`);
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const clock = { t: 0 };
  const you = makeSide("you", "You", String(code ?? ""), { seed, goal, clock, mapLine });
  const opp = makeSide("bot", bot.name, opts.botCode ?? bot.code, { seed, goal, clock });
  const sides = [you, opp];
  let gridT = 0; // last world tick (virtual ms, multiple of TICK_MS)

  const advanceTo = (target) => {
    while (gridT + TICK_MS <= target) {
      gridT += TICK_MS;
      for (const s of sides) W.tick(s.state, TICK_MS / 1000, s.rng);
    }
    clock.t = Math.max(clock.t, target);
  };
  const settle = async () => {
    await macrotask(); // every microtask (all program code) has run
    for (const s of sides) {
      if (!s.ended && !s.rt.isRunning()) s.ended = true;
      if (s.ended) s.timers.length = 0;
      s.maxDrones = Math.max(s.maxDrones, W.allDrones(s.state).length);
      if (!s.ended && !s.cut && s.rt.stats().ops > opBudget) {
        s.cut = "op budget";
        s.rt.stop(true);
        s.ended = true;
        s.timers.length = 0;
      }
      if (s.reachedAt === null && s.amount() >= goal.amount) s.reachedAt = clock.t;
      if (s.errorAt !== null && !s.ended) {
        s.rt.stop(true); // one drone failed: the whole side is out
        s.ended = true;
        s.timers.length = 0;
      }
    }
  };

  let reason = null;
  let lastUi = wallNow();
  onProgress({ ticks: 0, you: you.amount(), bot: opp.amount(), cap: tickCap });
  await settle();
  for (;;) {
    if (sides.some((s) => s.errorAt !== null)) {
      reason = "error";
      break;
    }
    if (sides.some((s) => s.reachedAt !== null)) {
      reason = "goal";
      break;
    }
    let next = Infinity;
    for (const s of sides) for (const tm of s.timers) if (tm.at < next) next = tm.at;
    if (next === Infinity) {
      reason = "idle"; // both programs ended (or wait forever): nothing can change
      break;
    }
    if (next > tickCap) {
      advanceTo(tickCap);
      reason = "cap";
      break;
    }
    advanceTo(next);
    for (const s of sides) {
      const due = s.timers.filter((tm) => tm.at <= clock.t).sort((a, b) => a.at - b.at || a.seq - b.seq);
      s.timers = s.timers.filter((tm) => tm.at > clock.t);
      for (const tm of due) tm.r();
    }
    await settle();
    if (wallNow() - lastUi > uiEveryMs) {
      onProgress({ ticks: Math.round(clock.t), you: you.amount(), bot: opp.amount(), cap: tickCap });
      await uiPause();
      lastUi = wallNow();
    }
  }
  for (const s of sides) {
    s.rt.stop(true);
    s.ended = true;
    s.timers.length = 0;
  }

  // Decide.
  let winner = "draw";
  if (reason === "error") {
    const [a, b] = [you.errorAt, opp.errorAt];
    if (a !== null && (b === null || a < b)) winner = "bot";
    else if (b !== null && (a === null || b < a)) winner = "you";
  } else if (reason === "goal") {
    const [a, b] = [you.reachedAt, opp.reachedAt];
    if (a !== null && (b === null || a < b)) winner = "you";
    else if (b !== null && (a === null || b < a)) winner = "bot";
  } else if (you.amount() !== opp.amount()) {
    winner = you.amount() > opp.amount() ? "you" : "bot";
  }
  const result = winner === "you" ? "win" : winner === "bot" ? "loss" : "draw";
  const ticks = Math.round(clock.t);
  const amounts = { you: you.amount(), bot: opp.amount() };
  const sideInfo = (s) => ({ amount: s.amount(), reachedAt: s.reachedAt, error: s.error, cut: s.cut, drones: s.maxDrones, ops: s.rt.stats().ops });
  const out = {
    goal: goal.id,
    bot: bot.id,
    seed,
    ticks,
    result,
    winner,
    reason,
    amounts,
    sides: { you: sideInfo(you), bot: sideInfo(opp) },
  };
  out.text = matchText(out);
  onProgress({ ticks, you: amounts.you, bot: amounts.bot, cap: tickCap });
  return out;
}

/** A solo run that did not reach the goal reports this many ticks (always loses). */
export const DNF_TICKS = TICK_CAP + 1;

/**
 * runSolo({ code, goal, seed, mapLine, … }) — v4 friend arena: the player's
 * program alone on the fixed arena world (same rules, unlocks and clock as a
 * match; the opponent side runs an empty program). Used both to create a
 * challenge and to answer one: two players' solo runs on the same seed are
 * exactly the two sides of a match, since the sides never interact.
 * Resolves with { goal, seed, reached, ticks, ops, amount, error, cut, drones, reason }
 *  ticks: the tick the goal was reached, else DNF_TICKS. ops: API calls by then.
 */
export async function runSolo(opts) {
  const { onProgress, ...rest } = opts;
  const m = await runMatch({
    ...rest,
    bot: "rookie", // placeholder: its code is replaced by the empty program
    botCode: "",
    onProgress: onProgress ? (p) => onProgress({ ticks: p.ticks, you: p.you, cap: p.cap }) : undefined,
  });
  const you = m.sides.you;
  const reached = you.reachedAt !== null && you.error === null;
  return {
    goal: m.goal,
    seed: m.seed,
    reached,
    ticks: reached ? you.reachedAt : DNF_TICKS,
    ops: you.ops,
    amount: you.amount,
    error: you.error,
    cut: you.cut,
    drones: you.drones,
    reason: m.reason,
  };
}

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

/** One line explaining how a match ended. */
export function matchText(m) {
  const goal = GOALS[m.goal];
  const bot = BOTS[m.bot];
  const name = (w) => (w === "you" ? "You" : bot.name);
  if (m.reason === "error") {
    if (m.winner === "draw") return `Both programs failed at ${fmt(m.ticks)} ticks.`;
    const loser = m.winner === "you" ? "bot" : "you";
    return `${name(loser)} failed: ${m.sides[loser].error || "error"}`;
  }
  if (m.reason === "goal") {
    if (m.winner === "draw") return `Both reached ${goal.label} at ${fmt(m.ticks)} ticks.`;
    return `${name(m.winner)} reached ${goal.label} first, at ${fmt(m.ticks)} ticks.`;
  }
  const why = m.reason === "cap" ? `Tick cap (${fmt(m.ticks)})` : `Both programs ended (${fmt(m.ticks)} ticks)`;
  if (m.winner === "draw") return `${why}: equal ${goal.item}, a draw.`;
  return `${why}: ${name(m.winner)} had more ${goal.item}.`;
}

