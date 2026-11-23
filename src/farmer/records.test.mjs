// v3 phase 1: run metrics (ops / ticks / program size), seeds, the save-level
// records (since BRIEF22: the contract totals only), persistence and export /
// import.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as R from "./records.js";
import { parseSeed } from "./rng.js";
import { WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { buildExport, parseImport } from "./saveData.js";
import { createDemoGame } from "./demo.js";
import { FARMER_GLOBALS } from "./farmerLib.js";
import { FORECAST_OPS } from "./weather.js";

/** n×n farm (Expand level to match) with the given unlocks. */
function farm(n, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, ...unlocks });
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
  const fns = Object.keys(FARMER_GLOBALS).filter((n) => !/^[A-Z]/.test(n) && n !== "spawn_bot" && n !== "spawn_drone");
  // Every non-constant global in the .d.ts (spawn_bot needs Megafarm; covered below), called once.
  const calls = fns.map((n) => `${n}(${n === "move" || n === "swap" || n === "can_move" ? "North" : ""});`).join("\n");
  assert.equal(await rt.run(calls), "done");
  // v3 phase 4: get_forecast() is the one priced call (25 ops = 1 + 24 extra).
  assert.equal(rt.stats().ops, fns.length + (FORECAST_OPS - 1));
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

// ---------- seeds ----------

test("seeds: parseSeed accepts 0 … 2³²−1 (numbers or digit strings) only", () => {
  assert.equal(parseSeed("123456789"), 123456789);
  assert.equal(parseSeed(" 42 "), 42);
  assert.equal(parseSeed(0), 0);
  assert.equal(parseSeed(4294967295), 4294967295);
  for (const bad of [4294967296, -1, 1.5, "abc", "", "1e3", "-3", null, undefined, NaN, {}]) {
    assert.equal(parseSeed(bad), null, String(bad));
  }
});

// ---------- records: the contract totals ----------

const done = (rewardItem, reward) => ({ rewardItem, reward });

test("records: only the contract totals, counted per reward item", () => {
  const s = farm(3);
  assert.deepEqual(s.records, { contracts: { completed: 0, bonus: { Pumpkin: 0, Cactus: 0 } } });
  assert.deepEqual(R.addContractDone(s, done("Pumpkin", 12)), { recorded: true });
  R.addContractDone(s, done("Cactus", 40));
  R.addContractDone(s, done("Pumpkin", 3));
  assert.deepEqual(s.records.contracts, { completed: 3, bonus: { Pumpkin: 15, Cactus: 40 } });
  for (const gone of ["addMazeAttempt", "addDinoHarvest", "betterMaze", "hasRecords", "histogram", "MAX_ATTEMPTS", "copyRecords"]) assert.equal(R[gone], undefined, gone);
});

test("old saves without records load with empty ones; damaged records → empty", () => {
  const s = farm(3);
  R.addContractDone(s, done("Pumpkin", 9));
  const old = JSON.parse(JSON.stringify(W.serialize(s)));
  delete old.records;
  assert.deepEqual(W.deserialize(old).records, R.emptyRecords());
  for (const junk of [null, 5, "x", { contracts: 7 }, { contracts: { completed: -3, bonus: { Pumpkin: "lots" } } }]) {
    assert.deepEqual(W.deserialize({ ...W.serialize(s), records: junk }).records, R.emptyRecords(), JSON.stringify(junk));
  }
});

test("a pre-BRIEF22 save's maze / dino records, replay seeds and Gold / Bone bonus are dropped; the contract count stays", () => {
  const s = farm(3);
  const save = {
    ...JSON.parse(JSON.stringify(W.serialize(s))),
    records: {
      mazes: { 1: { best: { level: 1, seed: 7, size: 6, sx: 0, sy: 0, ticks: 900, ops: 9, lines: 3, chars: 40, at: 1 }, attempts: [] } },
      dino: { bone: 192, level: 3, cut: 8, at: 1, seed: 4188, size: 12, sx: 6, sy: 6 },
      contracts: { completed: 11, bonus: { Gold: 400, Bone: 30 } },
    },
    pendingSeed: 424242,
    pendingDinoSeed: 12,
  };
  const back = W.deserialize(save);
  assert.deepEqual(back.records, { contracts: { completed: 11, bonus: { Pumpkin: 0, Cactus: 0 } } });
  for (const k of ["pendingSeed", "pendingDinoSeed", "dinoSeed", "maze", "dino", "benchMaze"]) assert.equal(k in back, false, k);
  const again = W.serialize(back);
  for (const k of ["pendingSeed", "pendingDinoSeed", "maze", "dino"]) assert.equal(k in again, false, `not written back: ${k}`);
});

test("export / import round-trips the records; old export files without records still import", () => {
  const s = farm(3);
  R.addContractDone(s, done("Cactus", 288));
  s.items.Gold = 77;
  const file = JSON.stringify(buildExport({ save: W.serialize(s), files: null }));
  const parsed = parseImport(file);
  assert.equal(parsed.ok, true);
  const loaded = W.deserialize(parsed.save);
  assert.deepEqual(loaded.records, s.records);
  assert.deepEqual(W.serialize(W.deserialize(W.serialize(loaded))), W.serialize(loaded), "stable");

  const oldSave = W.serialize(s);
  delete oldSave.records;
  const oldFile = parseImport(JSON.stringify(buildExport({ save: oldSave })));
  assert.equal(oldFile.ok, true);
  const oldLoaded = W.deserialize(oldFile.save);
  assert.deepEqual(oldLoaded.records, R.emptyRecords());
  assert.equal(oldLoaded.items.Gold, 77);
});

test("demo mode writes no records", async () => {
  const d = createDemoGame();
  assert.equal(d.demo, true);
  const { rt, logs } = runtime(d);
  assert.equal(await rt.run("harvest(); move(North); harvest();"), "done", JSON.stringify(logs.filter((l) => l.kind === "error")));
  assert.deepEqual(d.records, R.emptyRecords());
  assert.equal(R.addContractDone(d, done("Pumpkin", 5)).recorded, false);
  assert.deepEqual(d.records, R.emptyRecords());
});
