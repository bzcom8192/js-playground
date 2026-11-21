// JS Farmer — execution runtime. Compiles transformed player code into an
// AsyncFunction whose parameters are the drone API, runs it, and makes it
// stoppable. No DOM dependencies: time sources are injectable for node tests.

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
 */
export function createRuntime(opts) {
  const {
    getState,
    onChange = () => {},
    onLog = () => {},
    onStatus = () => {},
    getUiSpeed = () => 1,
    sleep = defaultSleep,
    now = defaultNow,
    yieldFn = defaultYield,
    rng = Math.random,
  } = opts;

  let current = null;
  let paused = false;

  const log = (kind, text) => onLog({ kind, text });

  function finish(ctx, status, info, silent = false) {
    if (ctx.finished) return;
    ctx.finished = true;
    ctx.endTime = now();
    if (ctx.pauseStart !== null) {
      ctx.pausedMs += ctx.endTime - ctx.pauseStart;
      ctx.pauseStart = null;
    }
    if (current === ctx) paused = false;
    if (current === ctx && !silent) onStatus(status, info);
    ctx.resolveDone(status);
  }

  function makeCtx() {
    let resolveStop, resolveDone;
    const stopPromise = new Promise((r) => (resolveStop = r));
    const donePromise = new Promise((r) => (resolveDone = r));
    return {
      stopped: false,
      thrown: false,
      finished: false,
      busy: false,
      ticks: 0,
      actions: 0,
      startTime: now(),
      endTime: null,
      debt: 0,
      lastYield: now(),
      guardsSinceAction: 0,
      syncGuards: 0,
      warnedRunaway: false,
      hints: new Set(),
      stopPromise,
      resolveStop,
      donePromise,
      resolveDone,
      lastMeasure: null,
      pausedMs: 0,
      pauseStart: null,
    };
  }

  // While paused, wait in small slices until resumed or stopped.
  async function waitWhilePaused(ctx) {
    while (paused && !ctx.stopped) {
      await Promise.race([sleep(SLICE_MS), ctx.stopPromise]);
    }
  }

  function buildApi(ctx) {
    const state = () => getState();

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

    const hintOnce = (msg) => {
      if (ctx.hints.has(msg)) return;
      ctx.hints.add(msg);
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
          log("error", `${err.name}: ${err.message}`);
          ctx.stopped = true;
          ctx.thrown = true; // every other flow parks at its next gate
          ctx.resolveStop();
          finish(ctx, "error", { error: err });
          await new Promise(() => {});
        }
        ctx.busy = true;
        try {
          const s = state();
          const res = report(name, fn(s, ...args));
          ctx.ticks += ticks;
          ctx.actions++;
          ctx.guardsSinceAction = 0;
          ctx.syncGuards = 0;
          let mult = W.speedMultiplier(s) * getUiSpeed();
          if (s.items.Power > 0) {
            s.items.Power -= 1; // each action while Power > 0 costs 1 Power…
            mult *= 2; // …and runs 2× faster
          }
          if (name === "do_a_flip") s.drone.flipMs = Math.min(600, ticks / mult);
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
        ctx.ticks += SENSE_TICKS;
        const s = state();
        if (needsSenses && !W.isUnlocked(s, "Senses")) {
          hintOnce(`🔒 Unlock Senses first (${name})`);
          return null;
        }
        return fn(s, ...args);
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

      // senses (need the Senses unlock)
      can_harvest: sense("can_harvest", (s) => W.isGrown(W.droneTile(s).entity)),
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
          // Names shared by an unlock and an entity (Cactus, Grass) resolve to the unlock.
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
      get_time: sense("get_time", () => runSeconds(ctx), false),
      get_tick_count: sense("get_tick_count", () => ctx.ticks, false),

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
    return api;
  }

  function compile(code, ctx) {
    const api = buildApi(ctx);
    const names = Object.keys(api);
    const body = transform(code);
    // "use strict" is prepended on line 1 (no newline) so line numbers stay intact.
    const fn = new AsyncFunction(...names, '"use strict";' + body);
    return { fn, args: names.map((n) => api[n]) };
  }

  // Seconds the program has been running, excluding paused time.
  function runSeconds(ctx) {
    const end = ctx.endTime ?? now();
    const pausing = ctx.pauseStart !== null ? end - ctx.pauseStart : 0;
    return Math.max(0, end - ctx.startTime - ctx.pausedMs - pausing) / 1000;
  }

  /**
   * run(code, { mapLine }) — mapLine(line) → { name, line, main } maps a line of
   * the combined multi-file program back to its file (see program.js).
   */
  function run(code, { mapLine } = {}) {
    stop(true);
    setPaused(false);
    const ctx = makeCtx();
    current = ctx;
    let compiled;
    try {
      compiled = compile(code, ctx);
    } catch (err) {
      log("error", `${err.name || "Error"}: ${err.message}`);
      finish(ctx, "error", { error: err });
      return ctx.donePromise;
    }
    onStatus("running");
    compiled.fn(...compiled.args).then(
      () => finish(ctx, "done"),
      (err) => {
        if (err === STOP || ctx.stopped) return finish(ctx, "stopped");
        const line = errorLine(err);
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${formatValue(err)}`;
        const where = line && mapLine ? mapLine(line) : null;
        let prefix = line ? `Line ${line}: ` : "";
        if (where) prefix = where.main ? `Line ${where.line}: ` : `${where.name}, line ${where.line}: `;
        log("error", prefix + msg);
        finish(ctx, "error", { error: err, line: where ? where.line : line, file: where?.name });
      },
    );
    // Resolves with "done" | "stopped" | "error" — even if the player's code
    // is left parked forever after a stop.
    return ctx.donePromise;
  }

  function stop(silent = false) {
    const ctx = current;
    if (!ctx || ctx.stopped || ctx.finished) return;
    setPaused(false);
    ctx.stopped = true;
    ctx.resolveStop();
    finish(ctx, "stopped", null, silent);
  }

  function stats() {
    const ctx = current;
    if (!ctx) return { running: false, ticks: 0, actions: 0, elapsed: 0, lastMeasure: null };
    const elapsed = runSeconds(ctx);
    return {
      running: !ctx.finished,
      ticks: ctx.ticks,
      actions: ctx.actions,
      elapsed,
      lastMeasure: ctx.lastMeasure,
    };
  }

  // Pause / resume the running program (actions and loops wait; time stops).
  function setPaused(p) {
    p = !!p;
    if (p === paused) return;
    const ctx = current;
    if (p && (!ctx || ctx.finished)) return; // nothing to pause
    paused = p;
    if (!ctx) return;
    if (p) ctx.pauseStart = now();
    else if (ctx.pauseStart !== null) {
      ctx.pausedMs += now() - ctx.pauseStart;
      ctx.pauseStart = null;
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
