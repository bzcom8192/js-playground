// JS Farmer — execution runtime. Compiles transformed player code into an
// AsyncFunction whose parameters are the drone API, runs it, and makes it
// stoppable. No DOM dependencies: time sources are injectable for node tests.
//
// Megafarm: one Run is a *session* that owns one program instance (ctx) per
// drone. Drone 0 runs the program as before; spawn_drone() adds a drone on the
// caller's tile that runs the SAME program from the top in its own ctx. Every
// API call acts on the calling drone (W.withDrone). The instances interleave
// on the event loop: each one sleeps for its own action time, and each yields
// to the event loop after YIELD_EVERY_MS of busy work, so the macrotask queue
// steps them round-robin and none can starve the others or the UI.
// Pause/Stop act on the whole session; an error stops only the drone that
// threw it (the session reports "error" once every drone has finished).
//
// Run metrics (v3): a run (Run press → Stop / program end / error) counts
//  - ops: every call of a farmer API function, across ALL drones combined.
//    The rule is simply "if the runtime hands it to the program, it counts":
//    every action, every sense (also the free ones like num_items, get_pos_x,
//    get_time), print / quick_print and the console.* aliases — 1 op per call,
//    counted on entry, whatever the call then returns (also locked / failed
//    calls). Constants (Entities, North, …) are not calls, and the loop guards
//    the transform injects (__loopGuard etc.) are not player calls.
//  - ticks: the run clock in ticks = the longest drone timeline. Each drone's
//    timeline is its own tick count (get_tick_count) plus the spawner's clock
//    when it was spawned, so with one drone it is exactly drone 0's ticks.
//  - program size of the main file (non-empty lines, characters).
// Maze records use the counters at the maze spawn vs at the treasure harvest
// (both inside the same run; see worldEvent).
//
// Contracts (v3 phase 2): the run clock also drives the save's farm clock
// (state.clock): whenever the run clock grows, the farm clock grows by the
// same amount (O(1): only the calling drone's timeline can have moved), and
// active contracts past their deadline expire right there (≤ 3 to look at).
// get_contracts() / deliver_contract(id) see today's contracts (`today`).
//
// Weather (v3 phase 4): get_weather() is a free sense (1 op, 1 tick).
// get_forecast() — information about the FUTURE — is priced: it counts as
// FORECAST_OPS = 25 ops (1 for the call + 24 extra), still 1 tick. Both read
// the world's weather (null on a weatherless world such as the arena).

import { transform } from "./transform.js";
import {
  DIR_DELTA,
  Directions,
  ENTITY_INFO,
  ENTITY_UNLOCK,
  Entities,
  Grounds,
  Items,
  UNLOCK_BY_ID,
  Unlocks,
} from "./constants.js";
import * as W from "./world.js";
import * as R from "./records.js";
import * as C from "./contracts.js";
import { FORECAST_OPS } from "./weather.js";

export const STOP = Symbol("farmer-stop");

// Ticks per call (1 tick = 1 ms of wall time at 1× speed, before power).
export const ACTION_TICKS = 200;
export const FLIP_TICKS = 600;
export const SENSE_TICKS = 1;
export const RUNAWAY_GUARDS = 200_000;
export const SYNC_LOOP_LIMIT = 10_000_000;
const MIN_SLEEP_MS = 4;
const YIELD_EVERY_MS = 16;
// Actions sleep in slices of at most this many ms, checking pause/stop between.
export const SLICE_MS = 50;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// A frozen copy of Math whose random() is `random` (arena determinism).
function seededMath(random) {
  const m = {};
  for (const k of Object.getOwnPropertyNames(Math)) m[k] = Math[k];
  m.random = () => random();
  return Object.freeze(m);
}

function defaultYield() {
  if (typeof globalThis.setImmediate === "function") return new Promise((r) => globalThis.setImmediate(r));
  if (typeof MessageChannel === "function") {
    return new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    });
  }
  return new Promise((r) => setTimeout(r, 0));
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultNow = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export function formatValue(v) {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  if (typeof v === "function") return `[function ${v.name || "anonymous"}]`;
  if (typeof v === "symbol") return v.toString();
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// Line number (1-based, in the player's code) from an error thrown inside the
// compiled AsyncFunction. V8: "<anonymous>:LINE:COL", Firefox: "AsyncFunction:LINE:COL".
// The function header adds 2 lines; the transform never adds newlines.
export function errorLine(err) {
  const m = String(err?.stack || "").match(/(?:<anonymous>|AsyncFunction|Function):(\d+):(\d+)/);
  if (!m) return null;
  const line = Number(m[1]) - 2;
  return line >= 1 ? line : null;
}

/**
 * createRuntime({ getState, onChange, onLog, onStatus, getUiSpeed, sleep, now, yieldFn })
 *  getState()  → current world state (mutated in place by actions)
 *  onChange()  → called after every action that changed the world
 *  onLog(entry) → { kind: "print"|"warn"|"error"|"info"|"clear", text }
 *  onStatus(status, info) → "running" | "done" | "stopped" | "error"
 *  onDroneError(info) → one drone's program failed (Megafarm: others keep going)
 */
export function createRuntime(opts) {
  const {
    getState,
    onChange = () => {},
    onLog = () => {},
    onStatus = () => {},
    // A drone's program failed (that drone stops; the run may go on): { error, line, file, drone }.
    onDroneError = () => {},
    getUiSpeed = () => 1,
    sleep = defaultSleep,
    now = defaultNow,
    yieldFn = defaultYield,
    rng = Math.random,
    // Wall clock for record timestamps.
    wallClock = Date.now,
    // Today's local date "YYYY-MM-DD" (which daily contracts are current).
    today = () => C.localDate(new Date(wallClock())),
    // Arena (v3 phase 3): the match goal { item, amount } that get_arena_goal()
    // returns. An arena run has no daily contracts (get_contracts() is [] and
    // deliver_contract() fails), so its Gold/Bone can't depend on the date.
    arenaGoal = null,
    // Arena: a seeded replacement for Math.random inside the program (the
    // program gets its own frozen `Math` whose random() is this function).
    mathRandom = null,
  } = opts;

  let current = null; // the current session
  let paused = false;

  const log = (kind, text) => onLog({ kind, text });

  function makeSession(body, mapLine, program) {
    let resolveDone;
    const donePromise = new Promise((r) => (resolveDone = r));
    return {
      body, // transformed program source, compiled once per drone
      mapLine,
      program, // { lines, chars } of the main file
      ops: 0, // farmer API calls, all drones combined
      maze: null, // { ref, ticks, ops } — counters when this run spawned the current maze
      clockMark: 0, // run clock already added to the farm clock (state.clock)
      ctxs: [],
      stopped: false,
      finished: false,
      error: null, // { error, line, file, drone } of the first drone error
      startTime: now(),
      endTime: null,
      pausedMs: 0,
      pauseStart: null,
      hints: new Set(),
      donePromise,
      resolveDone,
    };
  }

  // The session ends when its last drone does: "stopped" after a Stop,
  // otherwise "error" if any drone failed, otherwise "done".
  function finishSession(session, status, info, silent = false) {
    if (session.finished) return;
    session.finished = true;
    session.endTime = now();
    if (session.pauseStart !== null) {
      session.pausedMs += session.endTime - session.pauseStart;
      session.pauseStart = null;
    }
    if (current === session) paused = false;
    if (current === session && !silent) onStatus(status, info);
    session.resolveDone(status);
  }

  function finish(ctx, status, info) {
    if (ctx.finished) return;
    ctx.finished = true;
    ctx.status = status;
    const session = ctx.session;
    if (status === "error") {
      const e = { ...info, drone: ctx.index };
      if (!session.error) session.error = e;
      if (current === session) onDroneError(e);
    }
    if (session.finished || session.ctxs.some((c) => !c.finished)) return;
    if (session.stopped) finishSession(session, "stopped", null);
    else if (session.error) finishSession(session, "error", session.error);
    else finishSession(session, "done");
  }

  // drone: the world drone object this instance moves (null = drone 0, i.e.
  // whatever `state.drone` is, exactly as before Megafarm).
  // t0: the run clock (ticks) at which this drone started (its spawner's clock).
  function makeCtx(session, drone, t0 = 0) {
    let resolveStop;
    const stopPromise = new Promise((r) => (resolveStop = r));
    const ctx = {
      session,
      index: session.ctxs.length,
      drone,
      t0,
      status: "running",
      stopped: false,
      thrown: false,
      finished: false,
      busy: false,
      ticks: 0,
      actions: 0,
      debt: 0,
      lastYield: now(),
      guardsSinceAction: 0,
      syncGuards: 0,
      warnedRunaway: false,
      stopPromise,
      resolveStop,
      lastMeasure: null,
    };
    session.ctxs.push(ctx);
    return ctx;
  }

  // The run clock in ticks: the longest drone timeline (see the header).
  const runTicks = (session) => session.ctxs.reduce((m, c) => Math.max(m, c.t0 + c.ticks), 0);

  // ctx spent `t` ticks. If that moved the run clock (the longest timeline),
  // the farm clock moves with it and overdue contracts expire.
  function addTicks(ctx, s, t) {
    ctx.ticks += t;
    const session = ctx.session;
    const timeline = ctx.t0 + ctx.ticks;
    if (timeline <= session.clockMark || session.finished) return;
    s.clock = C.farmClock(s) + (timeline - session.clockMark);
    session.clockMark = timeline;
    for (const c of C.expireContracts(s)) log("warn", C.expiredText(c));
  }

  // Today's contracts (a new day rolls them over, also mid-run).
  function contractsToday(s) {
    for (const line of C.rolloverLines(C.ensureContracts(s, today()))) log("info", line);
  }

  // A score-relevant world event during one of this run's actions.
  function worldEvent(ctx, s, ev) {
    const session = ctx.session;
    if (ev.type === "mazeSpawn") {
      session.maze = { ref: ev.maze, ticks: runTicks(session), ops: session.ops };
      log("info", `Maze seed: ${ev.seed}${ev.replay ? " (replay)" : ""}`);
      return;
    }
    if (ev.type === "mazeSolve") {
      const snap = session.maze && session.maze.ref === ev.maze ? session.maze : null;
      session.maze = null;
      const seed = ev.maze?.seed;
      if (!snap || seed === null || seed === undefined) {
        log("info", "🏁 Maze solved — not timed (it was spawned before this run)");
        return;
      }
      const attempt = {
        level: ev.level,
        seed,
        size: ev.size,
        sx: ev.maze.start?.x ?? 0,
        sy: ev.maze.start?.y ?? 0,
        ticks: Math.round(runTicks(session) - snap.ticks),
        ops: session.ops - snap.ops,
        lines: session.program.lines,
        chars: session.program.chars,
        at: wallClock(),
      };
      const r = R.addMazeAttempt(s, attempt);
      const fmt = (n) => n.toLocaleString("en-US");
      let msg = `🏁 Maze solved in ${fmt(attempt.ticks)} ticks · ${fmt(attempt.ops)} ops`;
      if (r.best) msg += ` — new best for Mazes level ${ev.level}!`;
      log("info", msg);
      return;
    }
    if (ev.type === "dinoHarvest") {
      const r = R.addDinoHarvest(s, { bone: ev.bone, level: ev.level, cut: ev.cut, at: wallClock() });
      if (r.best) log("info", `🦴 New best dinosaur harvest: ${ev.bone.toLocaleString("en-US")} Bone (${ev.cut} cut)`);
    }
  }

  // "Drone 2: " in front of errors from spawned drones (drone 0 logs as before).
  const dronePrefix = (ctx) => (ctx.index > 0 ? `Drone ${ctx.index}: ` : "");

  // While paused, wait in small slices until resumed or stopped.
  async function waitWhilePaused(ctx) {
    while (paused && !ctx.stopped) {
      await Promise.race([sleep(SLICE_MS), ctx.stopPromise]);
    }
  }

  function buildApi(ctx) {
    const state = () => getState();
    const session = ctx.session;
    // Run a world function as this ctx's drone.
    const asDrone = (s, fn) => W.withDrone(s, ctx.drone, fn);

    // Throws STOP once; afterwards — e.g. if the player
    // swallowed it in a try/catch, or for un-awaited callbacks — park forever.
    const gate = async () => {
      if (paused) await waitWhilePaused(ctx);
      if (!ctx.stopped) return;
      if (ctx.thrown) await new Promise(() => {});
      ctx.thrown = true;
      throw STOP;
    };
    const sleepAbortable = (ms) => Promise.race([sleep(ms), ctx.stopPromise]);

    // Hints are shared by all drones of a run, so 12 drones don't repeat them.
    const hintOnce = (msg) => {
      if (session.hints.has(msg)) return;
      session.hints.add(msg);
      log("warn", msg);
    };
    const report = (fname, res) => {
      if (res === true || res === false) return res;
      if (!res.ok) {
        if (res.locked) hintOnce(`🔒 Unlock ${res.locked} first (${fname})`);
        else if (res.msg) hintOnce(`${fname}(): ${res.msg}`);
      }
      return res.ok;
    };

    const spend = async (ms) => {
      ctx.debt += ms;
      if (ctx.debt >= MIN_SLEEP_MS) {
        // Sleep in slices so Pause/Stop react within SLICE_MS.
        while (ctx.debt >= MIN_SLEEP_MS && !ctx.stopped) {
          const chunk = Math.min(ctx.debt, SLICE_MS);
          const t0 = now();
          await sleepAbortable(chunk);
          const spent = now() - t0;
          ctx.debt -= spent > 0 ? spent : chunk;
          if (paused) await waitWhilePaused(ctx);
        }
        ctx.debt = Math.max(-50, ctx.debt);
        ctx.lastYield = now();
      } else if (now() - ctx.lastYield > YIELD_EVERY_MS) {
        await yieldFn();
        ctx.lastYield = now();
      }
      await gate();
    };

    const action =
      (name, fn, ticks = ACTION_TICKS) =>
      async (...args) => {
        await gate();
        if (ctx.busy) {
          // Called from an un-awaited callback: fail the whole run (the main
          // flow sees the error at its next action) and never settle this one.
          const err = new Error(
            `${name}(): the drone is still busy with another action. ` +
              "Actions inside callbacks (forEach/map/setTimeout) are not awaited — use a for…of loop instead.",
          );
          log("error", `${dronePrefix(ctx)}${err.name}: ${err.message}`);
          ctx.stopped = true;
          ctx.thrown = true; // every other flow parks at its next gate
          ctx.resolveStop();
          finish(ctx, "error", { error: err });
          await new Promise(() => {});
        }
        ctx.busy = true;
        try {
          const s = state();
          const [raw, events] = W.withEvents(() => asDrone(s, () => fn(s, ...args)));
          const res = report(name, raw);
          for (const ev of events) worldEvent(ctx, s, ev);
          addTicks(ctx, s, ticks);
          ctx.actions++;
          ctx.guardsSinceAction = 0;
          ctx.syncGuards = 0;
          let mult = W.speedMultiplier(s) * getUiSpeed();
          if (s.items.Power > 0) {
            s.items.Power -= 1; // each action while Power > 0 costs 1 Power…
            mult *= 2; // …and runs 2× faster
          }
          if (name === "do_a_flip") (ctx.drone ?? s.drone).flipMs = Math.min(600, ticks / mult);
          onChange();
          await spend(ticks / mult);
          return res;
        } finally {
          ctx.busy = false;
        }
      };

    const sense =
      (name, fn, needsSenses = true) =>
      (...args) => {
        if (ctx.stopped && !ctx.thrown) {
          ctx.thrown = true;
          throw STOP;
        }
        const s = state();
        addTicks(ctx, s, SENSE_TICKS);
        if (needsSenses && !W.isUnlocked(s, "Senses")) {
          hintOnce(`🔒 Unlock Senses first (${name})`);
          return null;
        }
        return asDrone(s, () => fn(s, ...args));
      };

    const checkDir = (fname, dir) => {
      if (!DIR_DELTA[dir]) {
        throw new TypeError(`${fname}(): expected North, East, South or West, got ${formatValue(dir)}`);
      }
    };

    const print = (...args) => log("print", args.map(formatValue).join(" "));

    const api = {
      // constants
      Entities,
      Items,
      Grounds,
      Unlocks,
      North: Directions.North,
      East: Directions.East,
      South: Directions.South,
      West: Directions.West,

      // actions
      harvest: action("harvest", (s) => W.harvest(s)),
      plant: action("plant", (s, e) => W.plant(s, e, rng)),
      move: action("move", (s, dir) => {
        checkDir("move", dir);
        return W.moveDrone(s, dir);
      }),
      till: action("till", (s) => W.till(s)),
      clear: action("clear", (s) => {
        W.clearFarm(s);
        return true;
      }),
      swap: action("swap", (s, dir) => {
        checkDir("swap", dir);
        return W.swap(s, dir);
      }),
      use_item: action("use_item", (s, item, n = 1) => W.useItem(s, item, n, rng)),
      trade: action("trade", (s, item, n = 1) => W.trade(s, item, n)),
      unlock: action("unlock", (s, id) => W.buyUnlock(s, id)),
      do_a_flip: action(
        "do_a_flip",
        (s) => {
          s.drone.flips = (s.drone.flips || 0) + 1;
          return true;
        },
        FLIP_TICKS,
      ),
      // Contracts: deliver today's contract `id` from the shared inventory.
      deliver_contract: action("deliver_contract", (s, id) => {
        if (arenaGoal) return { ok: false, msg: "there are no contracts in the arena" };
        contractsToday(s);
        const res = C.deliverContract(s, id);
        if (res.ok) log("info", C.deliveredText(res.contract));
        return res;
      }),
      // Megafarm: a new drone on this tile runs this same program from the top.
      spawn_drone: action("spawn_drone", (s) => {
        if (session.finished || session.stopped || ctx.finished || current !== session) {
          return { ok: false, msg: "only works inside a running program" };
        }
        const res = W.spawnDrone(s);
        if (res.ok) startDrone(session, res.drone, ctx.t0 + ctx.ticks);
        return res;
      }),

      // senses (need the Senses unlock)
      // Apples are never harvestable (only the dinosaur eats them).
      can_harvest: sense("can_harvest", (s) => {
        const e = W.droneTile(s).entity;
        return W.isGrown(e) && e.type !== "Apple";
      }),
      get_entity_type: sense("get_entity_type", (s) => W.droneTile(s).entity?.type ?? null),
      get_ground_type: sense("get_ground_type", (s) => W.droneTile(s).ground),
      get_pos_x: sense("get_pos_x", (s) => s.drone.x),
      get_pos_y: sense("get_pos_y", (s) => s.drone.y),
      get_water: sense("get_water", (s) => Math.round(W.droneTile(s).water * 1000) / 1000),
      measure: sense("measure", (s, dir) => {
        if (dir !== undefined) checkDir("measure", dir);
        const v = W.measure(s, dir);
        ctx.lastMeasure = v;
        return v;
      }),

      // always available
      // Open field: always true. In a maze: false into a Hedge or across the edge.
      can_move: sense("can_move", (s, dir) => !!DIR_DELTA[dir] && W.canMove(s, dir), false),
      get_world_size: sense("get_world_size", (s) => s.size, false),
      num_items: sense("num_items", (s, item) => s.items[item] ?? 0, false),
      get_cost: sense(
        "get_cost",
        (s, thing) => {
          // Names shared by an unlock and an entity (Cactus, Grass, Rice) resolve to the unlock.
          if (UNLOCK_BY_ID[thing]) {
            const c = W.unlockCost(s, thing);
            return c ? { ...c } : null;
          }
          const info = ENTITY_INFO[thing];
          return info && info.cost ? { ...info.cost } : null;
        },
        false,
      ),
      num_unlocked: sense(
        "num_unlocked",
        (s, thing) => {
          if (UNLOCK_BY_ID[thing]) return W.level(s, thing);
          if (ENTITY_UNLOCK[thing]) return W.level(s, ENTITY_UNLOCK[thing]);
          return 0;
        },
        false,
      ),
      num_drones: sense("num_drones", (s) => W.allDrones(s).length, false),
      // 1 until Megafarm is unlocked, then the cap (farm side length).
      max_drones: sense("max_drones", (s) => (W.isUnlocked(s, "Megafarm") ? W.droneCap(s) : 1), false),
      get_time: sense("get_time", () => runSeconds(session), false),
      get_tick_count: sense("get_tick_count", () => ctx.ticks, false),
      // Today's contracts: [{ id, item, amount, reward, rewardItem, ticksLeft, status }].
      get_contracts: sense(
        "get_contracts",
        (s) => {
          if (arenaGoal) return [];
          contractsToday(s);
          return C.contractSnapshot(s);
        },
        false,
      ),
      // Weather: the current state ("Sunny" | "Rain" | "Storm" | "Drought").
      get_weather: sense("get_weather", (s) => W.currentWeather(s), false),
      // { next, inTicks }: the true next segment's weather + an APPROXIMATE
      // tick count (±20 %, never exact). Costs FORECAST_OPS ops (see below).
      get_forecast: sense("get_forecast", (s) => W.weatherForecast(s), false),
      // Arena: this match's goal { item, amount }; null outside the arena.
      get_arena_goal: sense("get_arena_goal", () => (arenaGoal ? { item: arenaGoal.item, amount: arenaGoal.amount } : null), false),

      // output
      print,
      quick_print: print,
      console: {
        log: print,
        info: (...a) => log("info", a.map(formatValue).join(" ")),
        warn: (...a) => log("warn", a.map(formatValue).join(" ")),
        error: (...a) => log("error", a.map(formatValue).join(" ")),
        clear: () => log("clear", ""),
      },

      // injected by the transform
      __loopGuard: async () => {
        if (ctx.stopped || paused) await gate();
        ctx.syncGuards = 0;
        if (++ctx.guardsSinceAction > RUNAWAY_GUARDS) {
          if (!ctx.warnedRunaway) {
            ctx.warnedRunaway = true;
            log(
              "warn",
              `⚠️ ${RUNAWAY_GUARDS.toLocaleString("en-US")} loop iterations without a drone action — ` +
                "throttling this loop to 100/s (loop without actions?). It speeds up again after the next action.",
            );
          }
          await sleepAbortable(10);
          ctx.lastYield = now();
          await gate();
          return;
        }
        if (now() - ctx.lastYield > YIELD_EVERY_MS) {
          await yieldFn();
          ctx.lastYield = now();
          await gate();
        }
      },
      __loopGuardSync: () => {
        if (ctx.stopped) throw STOP;
        if (++ctx.syncGuards > SYNC_LOOP_LIMIT) {
          throw new Error(
            "Loop inside a synchronous callback ran 10,000,000 times — infinite loop? " +
              "Move it into a named function or a top-level loop.",
          );
        }
      },
      __loopIter: async function* (iterable) {
        for (const v of iterable) {
          await api.__loopGuard();
          yield v;
        }
      },
      __loopKeys: async function* (obj) {
        const keys = [];
        for (const k in obj) keys.push(k);
        for (const k of keys) {
          await api.__loopGuard();
          yield k;
        }
      },
    };

    // Ops: every function the program can call counts (see the header) —
    // all of the API above except the transform's __loop* helpers.
    const counted = (fn) =>
      function (...args) {
        if (!session.finished) session.ops++;
        return fn.apply(this, args);
      };
    for (const name of Object.keys(api)) {
      if (typeof api[name] === "function" && !name.startsWith("__")) api[name] = counted(api[name]);
    }
    // get_forecast() is the one priced call: 25 ops in total.
    const forecast = api.get_forecast;
    api.get_forecast = function (...args) {
      if (!session.finished) session.ops += FORECAST_OPS - 1;
      return forecast.apply(this, args);
    };
    api.console = Object.fromEntries(Object.entries(api.console).map(([k, f]) => [k, counted(f)]));
    if (mathRandom) api.Math = seededMath(mathRandom);
    return api;
  }

  function compile(body, ctx) {
    const api = buildApi(ctx);
    const names = Object.keys(api);
    // "use strict" is prepended on line 1 (no newline) so line numbers stay intact.
    const fn = new AsyncFunction(...names, '"use strict";' + body);
    return { fn, args: names.map((n) => api[n]) };
  }

  // Seconds since Run, excluding paused time (one clock for all drones).
  function runSeconds(session) {
    const end = session.endTime ?? now();
    const pausing = session.pauseStart !== null ? end - session.pauseStart : 0;
    return Math.max(0, end - session.startTime - session.pausedMs - pausing) / 1000;
  }

  // Start one program instance. Errors stop only this drone.
  function launch(ctx, compiled) {
    const { mapLine } = ctx.session;
    compiled.fn(...compiled.args).then(
      () => finish(ctx, "done"),
      (err) => {
        if (err === STOP || ctx.stopped) return finish(ctx, "stopped");
        const line = errorLine(err);
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${formatValue(err)}`;
        const where = line && mapLine ? mapLine(line) : null;
        let prefix = line ? `Line ${line}: ` : "";
        if (where) prefix = where.main ? `Line ${where.line}: ` : `${where.name}, line ${where.line}: `;
        log("error", dronePrefix(ctx) + prefix + msg);
        // Park this drone's other flows (un-awaited callbacks) at their next gate.
        ctx.stopped = true;
        ctx.thrown = true;
        ctx.resolveStop();
        finish(ctx, "error", { error: err, line: where ? where.line : line, file: where?.name });
      },
    );
  }

  // spawn_drone(): the new drone starts on the next microtask, outside the
  // spawning action (so none of its code runs inside the caller's call).
  function startDrone(session, drone, t0) {
    const ctx = makeCtx(session, drone, t0);
    Promise.resolve().then(() => {
      if (session.stopped || session.finished) return finish(ctx, "stopped");
      launch(ctx, compile(session.body, ctx));
    });
  }

  /**
   * run(code, { mapLine }) — mapLine(line) → { name, line, main } maps a line of
   * the combined multi-file program back to its file (see program.js).
   * program: { lines, chars } of the main file (default: measured from `code`).
   */
  function run(code, { mapLine, program } = {}) {
    stop(true);
    setPaused(false);
    // A new Run starts with one drone: idle helpers (from the last run or a
    // loaded save) are dismissed.
    W.resetDrones(getState());
    let body = null;
    let compileError = null;
    try {
      body = transform(code);
    } catch (err) {
      compileError = err;
    }
    const session = makeSession(body, mapLine, program ?? R.programSize(code));
    current = session;
    const ctx = makeCtx(session, null);
    let compiled;
    try {
      if (compileError) throw compileError;
      compiled = compile(body, ctx);
    } catch (err) {
      log("error", `${err.name || "Error"}: ${err.message}`);
      finish(ctx, "error", { error: err });
      return session.donePromise;
    }
    onStatus("running");
    launch(ctx, compiled);
    // Resolves with "done" | "stopped" | "error" — even if the player's code
    // is left parked forever after a stop.
    return session.donePromise;
  }

  // Stop every drone of the current run.
  function stop(silent = false) {
    const session = current;
    if (!session || session.stopped || session.finished) return;
    setPaused(false);
    session.stopped = true;
    for (const ctx of session.ctxs) {
      ctx.stopped = true;
      ctx.resolveStop();
      if (!ctx.finished) {
        ctx.finished = true;
        ctx.status = "stopped";
      }
    }
    finishSession(session, "stopped", null, silent);
  }

  // Drone 0's numbers (the info strip follows drone 0) + how many drones run,
  // plus the run metrics. Read-only snapshot; the UI samples it.
  function stats() {
    const session = current;
    if (!session) {
      return { running: false, ticks: 0, actions: 0, elapsed: 0, lastMeasure: null, drones: 0, runTicks: 0, ops: 0, lines: 0, chars: 0 };
    }
    const ctx = session.ctxs[0];
    return {
      // Run metrics (all drones): run clock in ticks, API calls, main file size.
      runTicks: Math.round(runTicks(session)),
      ops: session.ops,
      lines: session.program.lines,
      chars: session.program.chars,
      running: !session.finished,
      ticks: ctx.ticks,
      actions: ctx.actions,
      elapsed: runSeconds(session),
      lastMeasure: ctx.lastMeasure,
      drones: session.ctxs.filter((c) => !c.finished).length,
    };
  }

  // Pause / resume the running program (actions and loops wait; time stops).
  function setPaused(p) {
    p = !!p;
    if (p === paused) return;
    const session = current;
    if (p && (!session || session.finished)) return; // nothing to pause
    paused = p;
    if (!session) return;
    if (p) session.pauseStart = now();
    else if (session.pauseStart !== null) {
      session.pausedMs += now() - session.pauseStart;
      session.pauseStart = null;
    }
  }

  return {
    run,
    stop,
    stats,
    setPaused,
    isPaused: () => paused,
    isRunning: () => !!current && !current.finished,
  };
}
