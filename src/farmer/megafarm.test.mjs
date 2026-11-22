// Megafarm (v2 phase 3): spawn_drone(), several drones running the same
// program concurrently, shared world/inventory, stop-all, the per-drone error
// rule, persistence and presentation. Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { createRuntime } from "./runtime.js";
import { ACTIONS } from "./transform.js";
import { EXAMPLES } from "./examples.js";
import { FARMER_GLOBALS, FARMER_LIB } from "./farmerLib.js";
import { BUSH_YIELD, FUTURE_UNLOCKS, UNLOCKS, UNLOCK_BY_ID, Unlocks, WORLD_SIZES, maxDrones } from "./constants.js";
import { stripFields } from "./statusStrip.js";
import { FarmScene } from "./board3d/FarmScene.js";
import { DRONE_BAND_0, DRONE_BANDS, droneBand } from "./droneBands.js";

// Small deterministic PRNG (mulberry32).
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const immediate = () => new Promise((r) => setImmediate(r));

/**
 * Virtual clock for several concurrent drones: sleep(ms) registers a timer;
 * the driver lets every program run until all of them wait on a timer, then
 * jumps to the earliest one (ticking the world in ≤100 ms steps on the way,
 * like the page's game loop). Unlike engine.test's per-sleep clock, N drones
 * sleeping at once do NOT make time run N× faster.
 */
function harness(state, { seed = 42, uiSpeed = 1 } = {}) {
  let t = 0;
  let seq = 0;
  let timers = [];
  const rng = seeded(seed);
  const logs = [];
  const statuses = [];
  const droneErrors = [];
  let paused = false;
  const rt = createRuntime({
    getState: () => state,
    onLog: (e) => logs.push(e),
    onStatus: (s, info) => statuses.push(info ? { s, info } : s),
    onDroneError: (e) => droneErrors.push(e),
    getUiSpeed: () => uiSpeed,
    now: () => t,
    rng,
    yieldFn: immediate,
    sleep: (ms) => new Promise((r) => timers.push({ at: t + ms, seq: seq++, r })),
  });
  let finished = null;
  const advanceTo = (target) => {
    while (t < target) {
      const step = Math.min(100, target - t);
      if (!paused) W.tick(state, step / 1000, rng);
      t += step;
    }
  };
  // Drive the clock for `ms` (or until the run ends / until() is true;
  // afterRun: keep driving after the run ended, for stray calls).
  async function runFor(ms, until = () => false, { afterRun = false } = {}) {
    const end = t + ms;
    const over = () => (!afterRun && finished !== null) || until();
    while (t < end && !over()) {
      for (let i = 0; i < 4; i++) await immediate();
      if (over()) break;
      if (!timers.length) {
        advanceTo(Math.min(end, t + 10));
        continue;
      }
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = Math.min(end, timers[0].at);
      advanceTo(next);
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.r());
    }
    for (let i = 0; i < 4; i++) await immediate();
  }
  return {
    rt,
    logs,
    statuses,
    droneErrors,
    now: () => t,
    prints: () => logs.filter((l) => l.kind === "print").map((l) => l.text),
    errors: () => logs.filter((l) => l.kind === "error").map((l) => l.text),
    warns: () => logs.filter((l) => l.kind === "warn").map((l) => l.text),
    run(code) {
      finished = null;
      const done = rt.run(code);
      done.then((r) => (finished = r));
      return done;
    },
    finished: () => finished,
    runFor,
    setPaused(p) {
      rt.setPaused(p);
      paused = rt.isPaused();
    },
  };
}

/** n×n farm (Expand level to match), every unlock given in `unlocks`. */
function farm(n, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, ...unlocks });
  return s;
}
const mega = (n, unlocks = {}) => farm(n, { Megafarm: 1, ...unlocks });
const positions = (s) => s.drones.map((d) => [d.x, d.y]);

// ---------- unlock & content ----------

test("Megafarm is a real unlock after Dinosaurs; no future unlocks; API declared", () => {
  const ids = UNLOCKS.map((u) => u.id);
  assert.equal(ids.indexOf("Megafarm"), ids.indexOf("Dinosaurs") + 1);
  assert.equal(ids[ids.length - 1], "Megafarm");
  const u = UNLOCK_BY_ID.Megafarm;
  assert.equal(u.requires, "Dinosaurs");
  assert.equal(u.maxLevel, 1);
  assert.deepEqual(u.cost(0), { Bone: 1400, Gold: 2400 });
  assert.equal(Unlocks.Megafarm, "Megafarm");
  assert.deepEqual(FUTURE_UNLOCKS, []);
  for (const n of ["spawn_bot", "spin_in_place", "spawn_drone", "do_a_flip"]) assert.ok(ACTIONS.includes(n), `${n} is auto-awaited`);
  for (const n of ["spawn_bot", "num_bots", "max_bots", "spin_in_place", "spawn_drone", "num_drones", "max_drones", "do_a_flip"]) {
    assert.equal(FARMER_GLOBALS[n], "readonly");
    assert.match(FARMER_LIB, new RegExp(`declare function ${n}\\(\\)`));
  }
  assert.match(FARMER_LIB, /Megafarm: "Megafarm";/);

  // Buying it: needs Dinosaurs, then Bone + Gold.
  const s = W.createGame();
  s.items.Bone = 1400;
  s.items.Gold = 2400;
  assert.equal(W.buyUnlock(s, "Megafarm").locked, "Dinosaurs");
  s.unlocks.Dinosaurs = 1;
  assert.equal(W.buyUnlock(s, "Megafarm").ok, true);
  assert.equal(s.items.Bone, 0);
  assert.equal(s.items.Gold, 0);
  assert.equal(W.buyUnlock(s, "Megafarm").ok, false, "max level 1");
});

test("cap rule: max drones = farm side length, at least 1", () => {
  assert.equal(maxDrones(1), 1);
  assert.equal(maxDrones(0), 1);
  assert.equal(maxDrones(NaN), 1);
  for (const n of WORLD_SIZES) {
    assert.equal(maxDrones(n), n);
    assert.equal(W.droneCap(farm(n)), n);
  }
});

// ---------- world level ----------

test("world: new games have one drone (drones[0] === drone); spawnDrone / withDrone / resetDrones", () => {
  const s = W.createGame();
  assert.equal(s.drones.length, 1);
  assert.equal(s.drones[0], s.drone);
  assert.deepEqual(W.allDrones({ drone: s.drone }), [s.drone], "hand-made states without a list");

  const f = farm(3);
  const locked = W.spawnDrone(f);
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, "Megafarm");
  assert.equal(f.drones.length, 1);

  f.unlocks.Megafarm = 1;
  f.drone.x = 2;
  f.drone.y = 1;
  const r1 = W.spawnDrone(f);
  assert.equal(r1.ok, true);
  assert.equal(r1.index, 1);
  assert.deepEqual([r1.drone.x, r1.drone.y], [2, 1], "spawns on the caller's tile");
  // As drone 1: spawn from drone 1's tile; world functions act on drone 1.
  r1.drone.x = 0;
  const r2 = W.withDrone(f, r1.drone, (st) => {
    assert.equal(st.drone, r1.drone);
    W.moveDrone(st, "North");
    return W.spawnDrone(st);
  });
  assert.equal(f.drone, f.drones[0], "drone 0 restored");
  assert.deepEqual(positions(f), [[2, 1], [0, 2], [0, 2]]);
  assert.equal(r2.ok, true);
  const capped = W.spawnDrone(f);
  assert.equal(capped.ok, false, "cap 3 on 3×3");
  assert.match(capped.msg, /cap is 3/);
  assert.throws(() => W.withDrone(f, r1.drone, () => { throw new Error("x"); }));
  assert.equal(f.drone, f.drones[0], "restored after a throw too");

  W.resetDrones(f);
  assert.deepEqual(positions(f), [[2, 1]]);
  assert.equal(f.drone, f.drones[0]);
});

// ---------- runtime ----------

test("spawn_drone() locked → false, a hint, still one drone", async () => {
  const s = farm(4);
  const h = harness(s);
  h.run(`print("spawn", spawn_drone(), num_drones(), max_drones());`);
  await h.runFor(5000);
  assert.equal(h.finished(), "done");
  assert.deepEqual(h.prints(), ["spawn false 1 1"]);
  assert.ok(h.warns().includes("🔒 Unlock Megafarm first (spawn_drone)"), h.warns().join("\n"));
  assert.equal(s.drones.length, 1);
});

test("spawn_drone() unlocked → a new drone on the caller's tile runs the same program from the top", async () => {
  const s = mega(5);
  const h = harness(s);
  h.run(`
const first = num_drones() === 1;
print("start", get_pos_x(), get_pos_y(), first);
if (first) {
  move(East);
  move(North);
  print("spawned", spawn_drone(), num_drones());
  move(East);
}
print("end", get_pos_x(), get_pos_y());
`);
  await h.runFor(10_000);
  assert.equal(h.finished(), "done");
  assert.deepEqual(h.prints(), [
    "start 0 0 true",
    "start 1 1 false", // the helper starts from the top, on the caller's tile
    "end 1 1", // …and, having nothing to do, ends at once
    "spawned true 2",
    "end 2 1",
  ]);
  assert.deepEqual(positions(s), [[2, 1], [1, 1]]);
  assert.deepEqual(h.statuses, ["running", "done"], "one status pair for the whole run");
});

test("spawn_bot / num_bots / max_bots / spin_in_place and their earlier names run identically", async () => {
  const play = async (code) => {
    const s = mega(3);
    const h = harness(s);
    h.run(code);
    await h.runFor(60_000);
    assert.equal(h.finished(), "done");
    const st = h.rt.stats();
    return { prints: h.prints(), warns: h.warns().map((w) => w.replace(/^spawn_\w+/, "spawn")), at: positions(s), flips: s.drones.map((d) => d.flips), ops: st.ops, ticks: st.runTicks, t: h.now() };
  };
  const now = `const first = num_bots() === 1;
print(spawn_bot(), num_bots(), max_bots());
spin_in_place();
if (first) move(North);
else move(East);
print(get_tick_count());`;
  const before = now.replaceAll("num_bots", "num_drones").replaceAll("max_bots", "max_drones").replace("spawn_bot", "spawn_drone").replace("spin_in_place", "do_a_flip");
  const a = await play(now);
  assert.deepEqual(a, await play(before));
  assert.equal(a.prints.filter((p) => p === "true 3 3").length, 2, a.prints.join(" | "));
  assert.equal(a.at.length, 3);
});

test("a program that declares a later API name itself still runs (its own declaration wins)", async () => {
  const s = mega(4);
  const h = harness(s);
  h.run(`const num_bots = 3;
let max_bots = num_bots + 1;
function spin_in_place() { return "mine"; }
print(num_bots, max_bots, spin_in_place(), num_drones());`);
  await h.runFor(5_000);
  assert.deepEqual(h.errors(), []);
  assert.deepEqual(h.prints(), ["3 4 mine 1"]);
});

test("cap enforced: every drone spawns until max_drones(); the extra calls return false", async () => {
  const s = mega(4);
  const h = harness(s);
  h.run(`
let ok = 0;
let refused = 0;
while (spawn_drone()) ok++;
refused++;
print(ok, refused, num_drones(), max_drones());
`);
  await h.runFor(20_000);
  assert.equal(h.finished(), "done");
  assert.equal(s.drones.length, 4);
  const lines = h.prints().map((l) => l.split(" ").map(Number));
  assert.equal(lines.length, 4, "each of the 4 drones ran the program");
  assert.equal(lines.reduce((a, l) => a + l[0], 0), 3, "exactly cap − 1 successful spawns");
  for (const l of lines) assert.deepEqual(l.slice(1), [1, 4, 4]);
  assert.equal(h.warns().filter((w) => w.startsWith("spawn_drone(): already")).length, 1, "the cap hint is shown once per run");
});

test("two drones run the same program concurrently and move independently (parallel, not N× slower)", async () => {
  const s = mega(6);
  const h = harness(s);
  h.run(`
const me = num_drones() === 1 ? 0 : 1;
if (me === 0) spawn_drone();
for (let i = 0; i < 5; i++) {
  move(me === 0 ? East : North);
  print(me, get_time().toFixed(1));
}
`);
  await h.runFor(20_000);
  assert.equal(h.finished(), "done");
  assert.deepEqual(positions(s), [[5, 0], [0, 5]]);
  const lines = h.prints();
  assert.equal(lines.length, 10);
  // Interleaved: neither drone finishes all its moves before the other starts.
  const order = lines.map((l) => l[0]).join("");
  assert.notEqual(order, "0000011111");
  assert.notEqual(order, "1111100000");
  // 1 spawn + 5 moves of 200 ms each run side by side: ~1.2 s, not 2.2 s.
  assert.ok(h.now() <= 1300, `took ${h.now()} ms`);
});

test("shared inventory: drones on the same tiles credit each harvest once", async () => {
  const s = mega(4);
  // A grown bush on every tile, on Soil so grass never regrows (Wood only from bushes).
  s.tiles.forEach((t) => {
    t.ground = "Soil";
    t.entity = { type: "Bush", progress: 1 };
  });
  const h = harness(s);
  // All four drones start on (0,0) and sweep the very same path.
  h.run(`
while (spawn_drone()) {}
let got = 0;
for (let x = 0; x < 4; x++) {
  for (let y = 0; y < 4; y++) {
    if (harvest()) got++;
    move(North);
  }
  move(East);
}
print("got", got);
`);
  await h.runFor(60_000);
  assert.equal(h.finished(), "done");
  assert.equal(s.drones.length, 4);
  const got = h.prints().map((l) => Number(l.split(" ")[1]));
  assert.equal(got.length, 4);
  assert.equal(got.reduce((a, b) => a + b, 0), 16, "16 bushes, 16 successful harvests in total");
  assert.equal(s.items.Wood, 16 * BUSH_YIELD[0], "each bush credited exactly once");
  assert.ok(s.tiles.every((t) => !t.entity));
});

test("Stop stops all drones; Pause pauses all drones", async () => {
  const s = mega(5);
  const h = harness(s);
  const done = h.run(`
const me = num_drones();
if (me < 3) { move(North); spawn_drone(); }
while (true) move(East);
`);
  await h.runFor(3000);
  assert.equal(s.drones.length, 3);
  assert.equal(h.rt.stats().drones, 3, "three running program instances");
  assert.ok(h.rt.isRunning());

  h.setPaused(true);
  const frozen = JSON.stringify(positions(s));
  const t0 = h.rt.stats().elapsed;
  await h.runFor(2000);
  assert.equal(JSON.stringify(positions(s)), frozen, "no drone moves while paused");
  assert.equal(h.rt.stats().elapsed, t0, "the run clock stops too");
  h.setPaused(false);
  await h.runFor(600); // 3 moves (5 would wrap a 5-wide farm back to the same tile)
  assert.notEqual(JSON.stringify(positions(s)), frozen, "all drones resume");

  h.rt.stop();
  assert.equal(await done, "stopped");
  assert.equal(h.rt.isRunning(), false);
  assert.equal(h.rt.stats().drones, 0);
  const after = JSON.stringify(positions(s));
  await h.runFor(3000);
  assert.equal(JSON.stringify(positions(s)), after, "nothing moves after Stop");
  assert.deepEqual(h.statuses, ["running", "stopped"]);
  assert.equal(s.drones.length, 3, "stopped drones stay on the farm (idle) until the next Run");
  // The next Run starts with drone 0 alone.
  h.run(`print(num_drones());`);
  await h.runFor(1000);
  assert.deepEqual(h.prints(), ["1"]);
  assert.equal(s.drones.length, 1);
});

test("an error stops only the drone that threw it; the others keep running", async () => {
  const s = mega(5);
  const h = harness(s);
  h.run(`const me = num_drones();
if (me === 1) spawn_drone();
if (me === 2) {
  move(North);
  throw new Error("boom");
}
for (let i = 0; i < 4; i++) move(East);
print("drone 0 done");
`);
  await h.runFor(800, () => h.droneErrors.length > 0);
  assert.deepEqual(h.errors(), ["Bot 1: Line 5: Error: boom"]);
  assert.equal(h.droneErrors.length, 1);
  assert.equal(h.droneErrors[0].drone, 1);
  assert.equal(h.droneErrors[0].line, 5);
  assert.ok(h.rt.isRunning(), "still running: drone 0 is busy");
  assert.deepEqual(h.statuses, ["running"]);
  await h.runFor(10_000);
  assert.deepEqual(h.prints(), ["drone 0 done"]);
  assert.deepEqual(positions(s), [[4, 0], [0, 1]], "drone 1 stopped where it failed");
  assert.equal(h.finished(), "error", "the run ends as an error once every drone is done");
  assert.equal(h.statuses.at(-1).s, "error");
  assert.equal(h.statuses.at(-1).info.drone, 1);

  // Drone 0's own errors look exactly as before (no prefix) and stop the run.
  const s2 = mega(3);
  const h2 = harness(s2);
  h2.run(`move(North);\nnull.x;`);
  await h2.runFor(5000);
  assert.equal(h2.finished(), "error");
  assert.equal(h2.errors().length, 1);
  assert.match(h2.errors()[0], /^Line 2: TypeError/);
});

test("spawn_drone() outside a running program fails cleanly", async () => {
  const s = mega(4);
  const h = harness(s);
  // Smuggle the API function out, then call it after the run has ended.
  h.run(`globalThis.__farmerSpawn = spawn_drone; print(num_drones());`);
  await h.runFor(2000);
  assert.equal(h.finished(), "done");
  const spawn = globalThis.__farmerSpawn;
  delete globalThis.__farmerSpawn;
  const res = spawn();
  await h.runFor(1000, () => false, { afterRun: true });
  assert.equal(await res, false);
  assert.equal(s.drones.length, 1);
  assert.ok(h.warns().some((w) => w === "spawn_drone(): only works inside a running program"), h.warns().join("\n"));
});

test("drones act on their own tile: maze measure() and dinosaur harvest per drone", async () => {
  // Maze: each drone measures the treasure direction from where IT is.
  const s = mega(7, { Mazes: 1, Fertilizer: 1 });
  s.drone.x = 3;
  s.drone.y = 3;
  s.tiles[W.idx(s, 3, 3)].entity = { type: "Bush", progress: 1 };
  s.items.Fertilizer = 1;
  // An idle helper standing where a hedge will appear is lifted onto the start tile.
  s.drones.push(W.newDrone(0, 1));
  const h = harness(s);
  h.run(`
use_item(Items.Fertilizer);
print("maze", num_drones());
`);
  // Run() dismisses idle helpers first, so this checks the plain single-drone maze;
  // then the hedge rule directly:
  await h.runFor(2000);
  assert.deepEqual(h.prints(), ["maze 1"]);
  assert.ok(s.maze);
  W.clearFarm(s);
  s.drone.x = 3;
  s.drone.y = 3;
  s.tiles[W.idx(s, 3, 3)].entity = { type: "Bush", progress: 1 };
  s.items.Fertilizer = 1;
  s.drones.push(W.newDrone(0, 1)); // (0,1): odd/even parity vs (3,3) → a wall tile
  W.useItem(s, "Fertilizer", 1, seeded(3));
  assert.ok(s.maze);
  assert.deepEqual(positions(s), [[3, 3], [3, 3]], "a helper on a hedge joins the maze start");
  W.resetDrones(s);

  const h2 = harness(s, { seed: 9 });
  h2.run(`
const me = num_drones() === 1 ? 0 : 1;
if (me === 0) spawn_drone();
// Each drone walks a different way, then reports what measure() says from there.
for (let i = 0; i < 6; i++) {
  if (can_move(me === 0 ? North : South)) move(me === 0 ? North : South);
  else if (can_move(me === 0 ? East : West)) move(me === 0 ? East : West);
}
print(me, get_pos_x(), get_pos_y(), measure());
`);
  await h2.runFor(20_000);
  assert.equal(h2.finished(), "done");
  const t = s.maze.treasure;
  const lines = h2.prints().map((l) => l.split(" "));
  assert.equal(lines.length, 2);
  for (const [me, x, y, dir] of lines) {
    const d = s.drones[Number(me)];
    assert.deepEqual([d.x, d.y], [Number(x), Number(y)]);
    const expected = W.withDrone(s, d, (st) => W.measure(st)) ?? "null";
    assert.equal(dir, String(expected), `drone ${me} measured from its own tile`);
    // And it agrees with the rule from that tile.
    const dx = t.x - d.x;
    const dy = t.y - d.y;
    if (dx || dy) assert.equal(dir, Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "East" : "West") : dy > 0 ? "North" : "South");
  }
  assert.notDeepEqual(positions(s)[0], positions(s)[1]);

  // Dinosaur: a helper harvesting the head credits the Bone once.
  const g = mega(5, { Dinosaurs: 1 });
  g.items.Gold = 24;
  const h3 = harness(g, { seed: 5 });
  h3.run(`
const me = num_drones() === 1 ? 0 : 1;
if (me === 0) {
  move(East);
  move(East);
  spawn_drone(); // the helper starts on (2, 0)
} else {
  plant(Entities.Dinosaur);
  print("hatched", get_entity_type());
  if (get_entity_type() === Entities.Dinosaur) print("bone", harvest(), num_items(Items.Bone));
}
`);
  await h3.runFor(10_000, () => h3.prints().length >= 2);
  const p = h3.prints();
  assert.equal(p[0], "hatched Dinosaur");
  // The harvest lands 200 ms after hatching, before the first 300 ms step: 1² Bone, once.
  assert.equal(p[1], "bone true 1");
  assert.equal(g.items.Bone, 1);
  assert.equal(g.dino, null);
  h3.rt.stop();
});

test("save / load with 3 drones: positions round-trip, drones load idle; old saves → one drone", async () => {
  const s = mega(6);
  const h = harness(s);
  h.run(`
const me = num_drones();
if (me < 3) { move(North); spawn_drone(); }
for (let i = 0; i < me; i++) move(East);
`);
  await h.runFor(10_000);
  assert.equal(h.finished(), "done");
  assert.deepEqual(positions(s), [[1, 1], [2, 2], [3, 2]]);

  const data = JSON.parse(JSON.stringify(W.serialize(s)));
  assert.deepEqual(data.drones, [[1, 1], [2, 2], [3, 2]]);
  assert.deepEqual(data.drone, { x: 1, y: 1 }, "drone 0 also in the old field");
  const back = W.deserialize(data);
  assert.deepEqual(positions(back), [[1, 1], [2, 2], [3, 2]]);
  assert.equal(back.drone, back.drones[0]);
  assert.deepEqual(W.serialize(back), W.serialize(s), "exact round trip");
  assert.equal(stripFields(back, { elapsed: 0, ticks: 0, lastMeasure: null }, "idle", false).drones, 3);

  // Loaded drones are idle: a new Run on the loaded farm starts with drone 0 alone.
  const h2 = harness(back);
  h2.run(`print(num_drones(), get_pos_x(), get_pos_y());`);
  await h2.runFor(1000);
  assert.deepEqual(h2.prints(), ["1 1 1"]);
  assert.equal(back.drones.length, 1);

  // Old single-drone saves (no `drones` list) load as one drone.
  const old = { ...data };
  delete old.drones;
  const o = W.deserialize(old);
  assert.deepEqual(positions(o), [[1, 1]]);
  assert.equal(o.drone, o.drones[0]);

  // Damaged lists: bad entries dropped, cut to the cap, drone 0 always from `drone`.
  const bad = W.deserialize({
    ...data,
    drones: [[5, 5], [0, 0], [-1, 2], [6, 0], "x", null, [1.5, 2], [2, 3], [3, 3], [4, 4], [5, 5], [5, 4], [5, 3], [5, 2]],
  });
  assert.deepEqual(positions(bad)[0], [1, 1]);
  assert.deepEqual(positions(bad).slice(1), [[0, 0], [2, 3], [3, 3], [4, 4], [5, 5]]);
  assert.equal(bad.drones.length, 6, "cap 6 on 6×6");
  assert.deepEqual(positions(W.deserialize({ ...data, drones: "nope" })), [[1, 1]]);
});

test("example 9 (A bot per column) puts one bot on every column and farms with all of them", async () => {
  const code = EXAMPLES.find((e) => e.id === "megafarm").code;
  assert.ok(EXAMPLES.find((e) => e.id === "megafarm").needs.includes("Megafarm"));
  const s = mega(6);
  s.drone.x = 3; // drone 0 starts mid-farm; it walks to the West edge first
  s.drone.y = 2;
  s.tiles.forEach((t) => (t.entity = W.makeEntity("Grass", Math.random, 1)));
  const h = harness(s);
  h.run(code);
  await h.runFor(30_000);
  assert.equal(h.finished(), null, "farms forever");
  assert.deepEqual(h.errors(), []);
  assert.equal(s.drones.length, 6);
  assert.deepEqual(s.drones.map((d) => d.x).sort(), [0, 1, 2, 3, 4, 5], "one drone per column");
  assert.deepEqual(h.prints(), ["6 bots at work, 6 columns"]);
  assert.ok(s.items.Hay > 100, `hay ${s.items.Hay}`);
  h.rt.stop();

  // Without Megafarm the same program still works with one drone (column 0).
  const one = farm(4);
  one.tiles.forEach((t) => (t.entity = W.makeEntity("Grass", Math.random, 1)));
  const h1 = harness(one);
  h1.run(code);
  await h1.runFor(10_000);
  assert.equal(one.drones.length, 1);
  assert.equal(one.drone.x, 0);
  assert.equal(h1.prints()[0], "Nobody for column 1 (no Bot Crew, or everyone is out)");
  assert.ok(one.items.Hay > 0);
  h1.rt.stop();
});

test("real clock: a busy-looping drone does not starve the other drone or the UI timer", async () => {
  // Default sleep/now/yield (real event loop), sped up 10× so moves take ~20 ms.
  const s = mega(4);
  const rt = createRuntime({ getState: () => s, getUiSpeed: () => 10 });
  let uiTicks = 0;
  const ui = setInterval(() => uiTicks++, 10);
  const t0 = performance.now();
  const done = rt.run(`
if (num_drones() === 1) {
  spawn_drone();
  for (let i = 0; i < 6; i++) move(East);
  globalThis.__farmerT = get_time();
} else {
  let n = 0;
  while (true) { n++; } // no actions at all
}
`);
  while (globalThis.__farmerT === undefined && performance.now() - t0 < 3000) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const took = globalThis.__farmerT;
  delete globalThis.__farmerT;
  rt.stop();
  clearInterval(ui);
  assert.equal(await done, "stopped");
  assert.ok(took !== undefined && took < 1.5, `drone 0 finished its 7 actions in ${took}s`);
  assert.equal(s.drone.x, 2, "6 moves East on 4×4 wrap to x = 2");
  assert.ok(uiTicks >= 5, `UI timer fired ${uiTicks}×`);
});

// ---------- presentation ----------

test("3D: one field-bot model per bot; helpers get their own band colour", () => {
  assert.equal(droneBand(0), DRONE_BAND_0);
  assert.equal(droneBand(1), DRONE_BANDS[0]);
  assert.equal(droneBand(DRONE_BANDS.length + 1), DRONE_BANDS[0], "colours cycle");
  assert.ok(!DRONE_BANDS.includes(DRONE_BAND_0));
  assert.equal(new Set(DRONE_BANDS.slice(0, 11)).size, 11, "drones 1–11 (12 on 12×12) all differ");

  const game = mega(4);
  const fs = new FarmScene();
  fs.sync(game);
  fs.update(1 / 60);
  assert.equal(fs.droneRecs.length, 1);
  const base = fs.scene.children.length;
  game.drones.push(W.newDrone(1, 2), W.newDrone(3, 3));
  fs.update(1 / 60);
  assert.equal(fs.droneRecs.length, 3);
  assert.equal(fs.scene.children.length, base + 4, "model + shadow for each helper");
  assert.ok(fs.kit._geometryCache.has("botBody"));
  assert.ok(fs.kit._geometryCache.has(`botBody:${droneBand(1)}`));
  assert.ok(fs.kit._geometryCache.has(`botBody:${droneBand(2)}`));
  // Helpers sit on their own tiles (a new drone appears in place, no glide).
  const [, a, b] = fs.droneRecs;
  assert.ok(Math.abs(a.x - (1 - 1.5)) < 1e-6 && Math.abs(a.z - -(2 - 1.5)) < 1e-6);
  assert.ok(Math.abs(b.x - 1.5) < 1e-6 && Math.abs(b.z - -1.5) < 1e-6);
  // Drone 0 still follows game.drone.
  game.drone.x = 2;
  for (let i = 0; i < 90; i++) fs.update(1 / 60);
  assert.ok(Math.abs(fs.drone.x - 0.5) < 1e-3);
  W.resetDrones(game);
  fs.update(1 / 60);
  assert.equal(fs.droneRecs.length, 1);
  assert.equal(fs.scene.children.length, base, "helper models removed");
  fs.dispose();
});

test("info strip: follows drone 0; drone count only with helpers", () => {
  const g = mega(4);
  const stats = { running: true, ticks: 0, actions: 0, elapsed: 0, lastMeasure: null };
  const one = stripFields(g, stats, "running", false);
  assert.equal("drones" in one, false, "single-drone strip unchanged");
  g.drones.push(W.newDrone(3, 3));
  g.tiles[W.idx(g, 3, 3)].entity = { type: "Bush", progress: 1 };
  const two = stripFields(g, stats, "running", false);
  assert.equal(two.drones, 2);
  assert.equal(two.x, 0);
  assert.equal(two.what, "Grassland", "still drone 0's tile");
});
