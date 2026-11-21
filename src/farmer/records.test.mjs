// v3 phase 1: run metrics (ops / ticks / program size), seeded mazes,
// personal records (maze + dinosaur), persistence and export / import.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as R from "./records.js";
import { generateSeededMaze, mulberry32, parseSeed, randomSeed } from "./maze.js";
import { WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { buildExport, parseImport } from "./saveData.js";
import { createDemoGame } from "./demo.js";
import { FARMER_GLOBALS } from "./farmerLib.js";

/** n×n farm (Expand level to match) with the given unlocks. */
function farm(n, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, ...unlocks });
  return s;
}

/** A farm ready to spawn a maze: grown Bush under the drone, Fertilizer in stock. */
function mazeReady(n = 6, { mazes = 1, at = [0, 0] } = {}) {
  const s = farm(n, { Fertilizer: 1, Mazes: mazes });
  s.items.Fertilizer = 10;
  [s.drone.x, s.drone.y] = at;
  W.droneTile(s).entity = { type: "Bush", progress: 1 };
  return s;
}

function runtime(s, opts = {}) {
  const logs = [];
  let t = 0; // virtual clock: sleeping advances it
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
    wallClock: () => 1_700_000_000_000,
    ...opts,
  });
  return { rt, logs };
}

// Spawns a maze and solves it with a depth-first search.
const SOLVER = `use_item(Items.Fertilizer);
const seen = new Set();
const back = { North: South, South: North, East: West, West: East };
const key = () => get_pos_x() + "," + get_pos_y();
function dfs() {
  if (get_entity_type() === Entities.Treasure) {
    harvest();
    return true;
  }
  seen.add(key());
  for (const d of [North, East, South, West]) {
    if (!can_move(d)) continue;
    move(d);
    if (!seen.has(key()) && dfs()) return true;
    move(back[d]);
  }
  return false;
}
dfs();
`;

const layout = (s) => s.tiles.map((t) => t.entity?.type ?? ".").join("");

// ---------- ops counter ----------

test("ops: every farmer API call counts 1, constants and loop guards don't", async () => {
  const s = farm(3);
  s.items.Hay = 5;
  const { rt, logs } = runtime(s);
  const code = `
    move(North);            // 1 action
    harvest();              // 2
    get_pos_x();            // 3 sense
    num_items(Items.Hay);   // 4 free sense
    const d = East;         // constants: no op
    for (let i = 0; i < 5; i++) can_move(d); // 5..9 (loop guards: no ops)
    print("a");             // 10
    quick_print("b");       // 11
    console.log("c");       // 12 (console.* is print)
    get_time();             // 13
    get_tick_count();       // 14
  `;
  assert.equal(await rt.run(code), "done", JSON.stringify(logs));
  const st = rt.stats();
  assert.equal(st.ops, 14);
  assert.equal(st.runTicks, st.ticks, "one drone: the run clock is drone 0's ticks");
  assert.equal(st.runTicks, 200 + 200 + 1 + 1 + 5 + 1 + 1);
});

test("ops: locked / failed calls count too; a new Run resets the counter", async () => {
  const s = farm(1);
  s.unlocks.Senses = 0;
  const { rt } = runtime(s);
  await rt.run("get_pos_x(); measure(); plant(Entities.Carrot); use_item(Items.Water);");
  assert.equal(rt.stats().ops, 4);
  await rt.run("print(1)");
  assert.equal(rt.stats().ops, 1);
});

test("ops: every function the program is given is counted (the whole API surface)", async () => {
  const s = farm(2);
  const { rt } = runtime(s);
  const fns = Object.keys(FARMER_GLOBALS).filter((n) => !/^[A-Z]/.test(n) && n !== "spawn_drone");
  // Every non-constant global in the .d.ts (spawn_drone needs Megafarm; covered below), called once.
  const calls = fns.map((n) => `${n}(${n === "move" || n === "swap" || n === "can_move" ? "North" : ""});`).join("\n");
  assert.equal(await rt.run(calls), "done");
  assert.equal(rt.stats().ops, fns.length);
});

test("ops: counted across all drones combined; the run clock follows the longest timeline", async () => {
  const s = farm(4, { Megafarm: 1 });
  const { rt, logs } = runtime(s);
  // Drone 0: num_drones + spawn_drone = 2 ops, 1 + 200 ticks.
  // Drone 1: num_drones + 2 × move = 3 ops; it starts at drone 0's clock (1) → 1 + 1 + 400.
  const code = "if (num_drones() === 1) spawn_drone();\nelse { move(East); move(East); }";
  assert.equal(await rt.run(code), "done", JSON.stringify(logs));
  assert.equal(rt.stats().ops, 5);
  assert.equal(rt.stats().ticks, 201, "drone 0's own ticks (info strip)");
  assert.equal(rt.stats().runTicks, 402, "the run clock is the longest drone timeline");
});

test("program size: non-empty lines and characters of the main file", async () => {
  assert.deepEqual(R.programSize("a();\n\n  \nb();\n"), { lines: 2, chars: 14 });
  const s = farm(1);
  const { rt } = runtime(s);
  await rt.run("print(1)\n\nprint(2)", { program: { lines: 7, chars: 99 } });
  assert.equal(rt.stats().lines, 7);
  assert.equal(rt.stats().chars, 99);
  await rt.run("print(1)\n\nprint(2)");
  assert.deepEqual([rt.stats().lines, rt.stats().chars], [2, 18], "defaults to the run code");
});

// ---------- seeded mazes ----------

test("seeded mazes: same seed + size + start → identical layout and treasure; other seeds differ", () => {
  for (const n of WORLD_SIZES.filter((k) => k >= 3)) {
    const a = generateSeededMaze(n, 0, 0, 123456789);
    const b = generateSeededMaze(n, 0, 0, 123456789);
    assert.deepEqual(a, b, `size ${n}`);
  }
  const base = generateSeededMaze(12, 0, 0, 1);
  let differ = 0;
  for (let seed = 2; seed < 22; seed++) {
    const m = generateSeededMaze(12, 0, 0, seed);
    if (m.walls.join() !== base.walls.join()) differ++;
  }
  assert.equal(differ, 20, "every other seed gives a different 12×12 layout");

  // Through the world: pending seed on two separate farms.
  const games = [mazeReady(8), mazeReady(8)];
  for (const g of games) {
    g.pendingSeed = 987654321;
    assert.equal(W.useItem(g, "Fertilizer", 1, () => 0.5).ok, true);
    assert.equal(g.maze.seed, 987654321);
    assert.equal(g.pendingSeed, null, "the pending seed is used once");
  }
  assert.equal(layout(games[0]), layout(games[1]));
  assert.deepEqual(games[0].maze.treasure, games[1].maze.treasure);
  const other = mazeReady(8);
  other.pendingSeed = 987654322;
  W.useItem(other, "Fertilizer");
  assert.notEqual(layout(other), layout(games[0]));
});

test("seeded mazes: without a pending seed a random 32-bit seed is drawn and replays exactly", () => {
  const s = mazeReady(10, { at: [3, 5] });
  const rng = mulberry32(42);
  const expected = randomSeed(mulberry32(42));
  W.useItem(s, "Fertilizer", 1, rng);
  assert.equal(s.maze.seed, expected);
  assert.ok(Number.isInteger(s.maze.seed) && s.maze.seed >= 0 && s.maze.seed <= 0xffffffff);
  assert.deepEqual(s.maze.start, { x: 3, y: 5 });
  const replay = mazeReady(10, { at: [3, 5] });
  replay.pendingSeed = s.maze.seed;
  W.useItem(replay, "Fertilizer", 1, Math.random);
  assert.equal(layout(replay), layout(s));
  assert.deepEqual(replay.maze.treasure, s.maze.treasure);
  // The Mazes level does not change the layout (only the Gold).
  const l3 = mazeReady(10, { mazes: 3, at: [3, 5] });
  l3.pendingSeed = s.maze.seed;
  W.useItem(l3, "Fertilizer");
  assert.equal(layout(l3), layout(s));
});

test("seeds: parseSeed accepts 0 … 2³²−1 (numbers or digit strings) only", () => {
  assert.equal(parseSeed("123456789"), 123456789);
  assert.equal(parseSeed(" 42 "), 42);
  assert.equal(parseSeed(0), 0);
  assert.equal(parseSeed(4294967295), 4294967295);
  for (const bad of [4294967296, -1, 1.5, "abc", "", "1e3", "-3", null, undefined, NaN, {}]) {
    assert.equal(parseSeed(bad), null, String(bad));
  }
});

test("seeds: the maze seed and the pending seed survive a save round-trip", () => {
  const s = mazeReady(6);
  s.pendingSeed = 77;
  W.useItem(s, "Fertilizer");
  s.pendingSeed = 555;
  const back = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  assert.equal(back.maze.seed, 77);
  assert.deepEqual(back.maze.start, { x: 0, y: 0 });
  assert.equal(back.pendingSeed, 555);
  const junk = { ...W.serialize(s), pendingSeed: "nope" };
  assert.equal(W.deserialize(junk).pendingSeed, null);
});

// ---------- maze records ----------

test("maze solve in a run writes a record: seed, ticks and ops inside the maze, program size", async () => {
  const s = mazeReady(6, { mazes: 2 });
  const { rt, logs } = runtime(s, { rng: mulberry32(9) });
  const program = R.programSize(SOLVER);
  assert.equal(await rt.run(SOLVER, { program }), "done", JSON.stringify(logs.filter((l) => l.kind === "error")));
  assert.equal(s.items.Gold, 36 * 2);
  const seedLog = logs.find((l) => l.text.startsWith("Maze seed: "));
  assert.ok(seedLog, "the seed is announced in the Log");
  const entry = s.records.mazes["2"];
  assert.ok(entry, JSON.stringify(s.records));
  assert.equal(entry.attempts.length, 1);
  const a = entry.attempts[0];
  assert.equal(entry.best, a);
  assert.equal(String(a.seed), seedLog.text.slice("Maze seed: ".length));
  const st = rt.stats();
  // Counters at the spawn: before use_item's ticks, after its op. At the
  // solve: before harvest's ticks (the last action), after its op.
  assert.equal(a.ticks, st.runTicks - 200);
  assert.equal(a.ops, st.ops - 1);
  assert.deepEqual(
    { level: a.level, size: a.size, sx: a.sx, sy: a.sy, lines: a.lines, chars: a.chars, at: a.at },
    { level: 2, size: 6, sx: 0, sy: 0, lines: program.lines, chars: program.chars, at: 1_700_000_000_000 },
  );
  assert.ok(logs.some((l) => /^🏁 Maze solved in [\d,]+ ticks · [\d,]+ ops — new best for Mazes level 2!$/.test(l.text)));

  // Replaying the same seed from the same tile with the same program → the same numbers.
  const again = mazeReady(6, { mazes: 2 });
  again.pendingSeed = a.seed;
  const r2 = runtime(again);
  await r2.rt.run(SOLVER, { program });
  const b = again.records.mazes["2"].attempts[0];
  assert.deepEqual({ ...b, at: 0 }, { ...a, at: 0 });
  assert.ok(r2.logs.some((l) => l.text === `Maze seed: ${a.seed} (replay)`));
});

test("a maze spawned before the run is solved but not recorded", async () => {
  const s = mazeReady(4);
  W.useItem(s, "Fertilizer");
  const { rt, logs } = runtime(s);
  await rt.run(SOLVER.replace("use_item(Items.Fertilizer);", ""));
  assert.ok(s.items.Gold > 0);
  assert.deepEqual(s.records.mazes, {});
  assert.ok(logs.some((l) => l.text.includes("not timed")));
});

test("best per level: fewest ticks, tie → fewest ops; levels are separate", () => {
  const s = W.createGame();
  const att = (level, ticks, ops, seed = 1) => ({ level, seed, size: 6, sx: 0, sy: 0, ticks, ops, lines: 1, chars: 1, at: 0 });
  assert.equal(R.addMazeAttempt(s, att(1, 500, 50)).best, true);
  assert.equal(R.addMazeAttempt(s, att(1, 600, 10)).best, false, "more ticks loses even with fewer ops");
  assert.equal(R.addMazeAttempt(s, att(1, 500, 60)).best, false, "tie on ticks, more ops");
  assert.equal(R.addMazeAttempt(s, att(1, 500, 40, 2)).best, true, "tie on ticks, fewer ops wins");
  assert.equal(R.addMazeAttempt(s, att(1, 499, 999, 3)).best, true);
  assert.equal(R.addMazeAttempt(s, att(2, 9000, 9000)).best, true, "first attempt on level 2");
  assert.equal(s.records.mazes["1"].best.seed, 3);
  assert.equal(s.records.mazes["1"].attempts.length, 5);
  assert.equal(s.records.mazes["2"].best.ticks, 9000);
});

test("attempt history is capped at the last 100 per level; the best survives the cap", () => {
  const s = W.createGame();
  const att = (ticks, seed) => ({ level: 1, seed, size: 6, sx: 0, sy: 0, ticks, ops: 1, lines: 1, chars: 1, at: seed });
  R.addMazeAttempt(s, att(10, 0)); // the best, soon pushed out of the history
  for (let i = 1; i < 130; i++) R.addMazeAttempt(s, att(1000 + i, i));
  const e = s.records.mazes["1"];
  assert.equal(e.attempts.length, R.MAX_ATTEMPTS);
  assert.equal(e.attempts[0].seed, 30);
  assert.equal(e.attempts.at(-1).seed, 129);
  assert.equal(e.best.ticks, 10);
  const back = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  assert.equal(back.records.mazes["1"].best.ticks, 10);
  assert.equal(back.records.mazes["1"].attempts.length, 100);
  // A hand-edited save with too many attempts is trimmed on load.
  const big = W.serialize(s);
  big.records.mazes["1"].attempts = Array.from({ length: 150 }, (_, i) => att(2000 + i, i));
  assert.equal(W.deserialize(big).records.mazes["1"].attempts.length, 100);
});

// ---------- dinosaur records ----------

function dinoFarm() {
  const s = farm(6, { Dinosaurs: 2 });
  const cells = [[0, 0], [1, 0], [2, 0], [3, 0]];
  for (const [x, y] of cells) W.tileAt(s, x, y).entity = { type: "Dinosaur", progress: 1 };
  s.dino = { body: cells.map(([x, y]) => ({ x, y })), dir: "West", stepTimer: 0, appleTimer: 0 };
  return s;
}

test("dinosaur harvest writes the best single Bone haul with level and cut length", async () => {
  const s = dinoFarm();
  s.drone.x = 1; // segment 2 of 4 → cuts 3 → 3² × L2 = 18 Bone
  const { rt, logs } = runtime(s);
  await rt.run("harvest()");
  assert.equal(s.items.Bone, 18);
  assert.deepEqual(s.records.dino, { bone: 18, level: 2, cut: 3, at: 1_700_000_000_000 });
  assert.ok(logs.some((l) => l.text === "🦴 New best dinosaur harvest: 18 Bone (3 cut)"));
  s.drone.x = 0; // the head: 1 segment left → 2 Bone, not a record
  await rt.run("harvest()");
  assert.equal(s.items.Bone, 20);
  assert.equal(s.records.dino.bone, 18);
});

// ---------- persistence ----------

test("old saves without records (or seeds) load with empty records", () => {
  const s = mazeReady(6);
  W.useItem(s, "Fertilizer");
  const old = JSON.parse(JSON.stringify(W.serialize(s)));
  delete old.records;
  delete old.pendingSeed;
  delete old.maze.seed;
  delete old.maze.sx;
  delete old.maze.sy;
  const back = W.deserialize(old);
  assert.deepEqual(back.records, R.emptyRecords());
  assert.equal(back.pendingSeed, null);
  assert.ok(back.maze, "the old maze still loads");
  assert.equal(back.maze.seed, null);
  for (const junk of [null, 5, "x", { mazes: 7, dino: "big" }, { mazes: { 1: { attempts: [{ seed: -4 }] } } }]) {
    assert.deepEqual(W.deserialize({ ...W.serialize(s), records: junk }).records, R.emptyRecords(), JSON.stringify(junk));
  }
});

test("export / import round-trips records; old export files without records still import", async () => {
  const s = mazeReady(6);
  const { rt } = runtime(s);
  await rt.run(SOLVER);
  R.addDinoHarvest(s, { bone: 50, level: 1, cut: 5, at: 1 });
  s.pendingSeed = 4242;
  const recs = JSON.parse(JSON.stringify(s.records));
  assert.equal(recs.mazes["1"].attempts.length, 1);

  const file = JSON.stringify(buildExport({ save: W.serialize(s), files: null }));
  const parsed = parseImport(file);
  assert.equal(parsed.ok, true);
  const loaded = W.deserialize(parsed.save);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.records)), recs);
  assert.equal(loaded.pendingSeed, 4242);
  assert.deepEqual(W.serialize(W.deserialize(W.serialize(loaded))), W.serialize(loaded), "stable");

  const oldSave = W.serialize(s);
  delete oldSave.records;
  delete oldSave.pendingSeed;
  const oldFile = parseImport(JSON.stringify(buildExport({ save: oldSave })));
  assert.equal(oldFile.ok, true);
  const oldLoaded = W.deserialize(oldFile.save);
  assert.deepEqual(oldLoaded.records, R.emptyRecords());
  assert.equal(oldLoaded.items.Gold, s.items.Gold);
});

test("demo mode writes no records (maze solve or dinosaur harvest)", async () => {
  const d = createDemoGame();
  assert.equal(d.demo, true);
  W.droneTile(d).entity = { type: "Bush", progress: 1 };
  const { rt, logs } = runtime(d);
  assert.equal(await rt.run(SOLVER), "done", JSON.stringify(logs.filter((l) => l.kind === "error")));
  assert.ok(logs.some((l) => l.text.startsWith("🏁 Maze solved")), "still solved and timed in the Log");
  for (const [x, y] of [[0, 0], [1, 0]]) W.tileAt(d, x, y).entity = { type: "Dinosaur", progress: 1 };
  d.dino = { body: [{ x: 0, y: 0 }, { x: 1, y: 0 }], dir: "West", stepTimer: 0, appleTimer: 0 };
  d.drone.x = 0;
  d.drone.y = 0;
  await rt.run("harvest()");
  assert.ok(d.items.Bone > 625);
  assert.deepEqual(d.records, R.emptyRecords());
  assert.equal(R.addMazeAttempt(d, { level: 1, seed: 1, ticks: 1, ops: 1 }).recorded, false);
  assert.equal(R.addDinoHarvest(d, { bone: 1 }).recorded, false);
});

// ---------- histogram ----------

test("histogram: ≤10 equal-width buckets from min to max, every attempt counted once", () => {
  assert.deepEqual(R.histogram([]), []);
  assert.deepEqual(R.histogram([500, 500]), [{ from: 500, to: 500, count: 2 }]);
  const vals = Array.from({ length: 100 }, (_, i) => 1000 + i * 37);
  const h = R.histogram(vals);
  assert.ok(h.length <= 10 && h.length >= 9);
  assert.equal(h.reduce((n, b) => n + b.count, 0), 100);
  assert.equal(h[0].from, 1000);
  assert.equal(h.at(-1).to, Math.max(...vals));
  for (let i = 1; i < h.length; i++) assert.equal(h[i].from, h[i - 1].to + 1);
  for (const v of vals) assert.equal(h.filter((b) => v >= b.from && v <= b.to).length, 1);
  assert.deepEqual(R.histogram([1, 2, 3]).map((b) => b.count), [1, 1, 1], "small spans: one bucket per value");
});
