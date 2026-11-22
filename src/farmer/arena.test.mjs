// Arena + ELO (v3 phase 3): headless deterministic matches on throwaway
// worlds, the built-in bots, safety (errors, infinite loops), the ELO math and
// the save's `arena` section. Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as C from "./contracts.js";
import * as R from "./records.js";
import { createRuntime } from "./runtime.js";
import {
  ARENA_SIZE,
  ARENA_UNLOCKS,
  BOTS,
  BOT_IDS,
  BOT_RATINGS,
  GOALS,
  GOAL_IDS,
  MAX_HISTORY,
  START_RATING,
  TICK_CAP,
  arenaWorld,
  eloDelta,
  eloExpected,
  emptyArena,
  recordMatch,
  runMatch,
  sanitizeArena,
} from "./arena.js";
import { FARMER_GLOBALS, FARMER_LIB } from "./farmerLib.js";
import { UNLOCKS, WORLD_SIZES } from "./constants.js";

const IDLE = "while (true) { do_a_flip(); }";
const play = (code, bot, goal, seed = 1, extra = {}) => runMatch({ code, bot, goal, seed, ...extra });
// What a match must report identically on every run.
const essence = (m) => ({
  result: m.result,
  winner: m.winner,
  reason: m.reason,
  ticks: m.ticks,
  amounts: m.amounts,
  sides: m.sides,
  text: m.text,
});

// ---------- setup ----------

test("arena content: goals, bots with fixed ratings, the unlock set, get_arena_goal declared", () => {
  assert.deepEqual(GOAL_IDS, ["hay500", "wood800", "pumpkin300"], "gold200 is dropped (no Gold source in the arena set)");
  assert.deepEqual(
    GOAL_IDS.map((id) => [GOALS[id].item, GOALS[id].amount]),
    [
      ["Hay", 500],
      ["Wood", 800],
      ["Pumpkin", 300],
    ],
  );
  assert.deepEqual(BOT_IDS, ["rookie", "pro", "ace"]);
  assert.deepEqual(
    BOT_IDS.map((id) => BOTS[id].rating),
    [800, 1200, 1600],
  );
  assert.deepEqual(BOT_RATINGS, { rookie: 800, pro: 1200, ace: 1600 });
  for (const id of BOT_IDS) assert.equal(typeof BOTS[id].code, "string");
  // Every unlock up to (and including) Megafarm is named in the set.
  assert.deepEqual(Object.keys(ARENA_UNLOCKS).sort(), UNLOCKS.map((u) => u.id).sort());
  assert.equal(WORLD_SIZES[ARENA_UNLOCKS.Expand], ARENA_SIZE);
  assert.equal(ARENA_UNLOCKS.Megafarm, 1);
  assert.equal(ARENA_UNLOCKS.Speed, 0);
  assert.equal(ARENA_UNLOCKS.Mazes, 0, "no maze Gold in the arena");
  assert.equal(FARMER_GLOBALS.get_arena_goal, "readonly");
  assert.match(FARMER_LIB, /declare function get_arena_goal\(\)/);
});

test("arena worlds: same seed → identical fresh 8×8 start; another seed differs", () => {
  const a = arenaWorld(42);
  const b = arenaWorld(42);
  assert.deepEqual(W.serialize(a.state), W.serialize(b.state));
  assert.equal(a.rng(), b.rng(), "the world rng streams match too");
  assert.equal(a.state.size, 8);
  assert.equal(a.state.tiles.length, 64);
  assert.ok(a.state.tiles.every((t) => t.entity?.type === "Grass" && t.ground === "Grassland"));
  assert.ok(Object.values(a.state.items).every((v) => v === 0), "empty inventory");
  assert.equal(W.droneCap(a.state), 8);
  assert.notDeepEqual(W.serialize(arenaWorld(43).state).tiles, W.serialize(a.state).tiles);
});

// ---------- determinism ----------

test("determinism: same seed + same programs → same winner, ticks and amounts (pro vs ace, every goal)", async () => {
  for (const goal of GOAL_IDS) {
    const a = await play(BOTS.pro.code, "ace", goal, 7);
    const b = await play(BOTS.pro.code, "ace", goal, 7);
    assert.deepEqual(essence(a), essence(b), goal);
    assert.equal(a.seed, 7);
  }
});

test("determinism: the program's Math.random is seeded (and identical on both sides)", async () => {
  // A player that farms at random: same seed → same result; both sides draw the same stream.
  const code = "while (true) { if (Math.random() < 0.6) harvest(); move(Math.random() < 0.5 ? North : East); }";
  const a = await play(code, "rookie", "hay500", 99, { botCode: code });
  const b = await play(code, "rookie", "hay500", 99, { botCode: code });
  assert.deepEqual(essence(a), essence(b));
  assert.equal(a.result, "draw", "mirror match");
  assert.equal(a.amounts.you, a.amounts.bot);
  const c = await play(code, "rookie", "hay500", 100, { botCode: code });
  assert.equal(c.result, "draw");
});

test("fairness: a mirror match (pro vs pro) is a draw at the same tick", async () => {
  for (const goal of GOAL_IDS) {
    const m = await play(BOTS.pro.code, "pro", goal, 3);
    assert.equal(m.result, "draw", goal);
    assert.equal(m.reason, "goal");
    assert.equal(m.sides.you.reachedAt, m.sides.bot.reachedAt);
    assert.deepEqual(m.sides.you, m.sides.bot);
  }
});

test("fairness: one side's timing never changes the other side's world", async () => {
  // Pro's run is the same whatever it races against (the farms only share the clock).
  const opponents = [IDLE, "while (true) {}", BOTS.rookie.code, "while (true) { harvest(); do_a_flip(); move(East); }"];
  const reached = [];
  for (const code of opponents) reached.push((await play(code, "pro", "hay500", 5)).sides.bot.reachedAt);
  assert.ok(reached[0] > 0 && reached[0] <= TICK_CAP);
  assert.deepEqual(reached, opponents.map(() => reached[0]));
});

// ---------- the bots ----------

test("pro reaches every goal preset well within the tick cap (hay500 included)", async () => {
  for (const goal of GOAL_IDS) {
    const m = await play(IDLE, "pro", goal, 1);
    assert.equal(m.reason, "goal", goal);
    assert.equal(m.winner, "bot", goal);
    assert.ok(m.sides.bot.reachedAt <= TICK_CAP, `${goal}: ${m.sides.bot.reachedAt}`);
    assert.ok(m.amounts.bot >= GOALS[goal].amount);
  }
  const hay = await play(IDLE, "pro", "hay500", 1);
  assert.ok(hay.ticks < TICK_CAP / 2, `pro: 500 Hay at ${hay.ticks} ticks`);
});

test("bots: rookie < pro < ace, and ace really uses the Megafarm squad", async () => {
  const pro = await play(BOTS.rookie.code, "pro", "hay500", 2);
  assert.equal(pro.result, "loss", "rookie loses to pro");
  const ace = await play(BOTS.pro.code, "ace", "hay500", 2);
  assert.equal(ace.result, "loss", "pro loses to ace");
  assert.equal(ace.sides.bot.drones, 8);
  assert.equal(ace.sides.you.drones, 1);
  const wood = await play(BOTS.rookie.code, "pro", "wood800", 2);
  assert.equal(wood.result, "loss");
  // Rookie never grows pumpkins: it holds 0 at the end.
  const pumpkin = await play(BOTS.rookie.code, "pro", "pumpkin300", 2);
  assert.equal(pumpkin.amounts.you, 0);
  assert.equal(pumpkin.result, "loss");
});

// ---------- safety ----------

test("an erroring program loses at once, with the reason recorded", async () => {
  const m = await play("harvest();\nmove(North);\nnope();", "rookie", "hay500", 1);
  assert.equal(m.result, "loss");
  assert.equal(m.reason, "error");
  assert.equal(m.ticks, 400, "two actions, then the error");
  assert.match(m.sides.you.error, /Line 3: ReferenceError: nope is not defined/);
  assert.match(m.text, /You failed: Line 3/);

  const syntax = await play("while (true {", "pro", "hay500", 1);
  assert.equal(syntax.result, "loss");
  assert.equal(syntax.ticks, 0);
  assert.match(syntax.sides.you.error, /SyntaxError/);

  // The opponent erroring → the player wins; both at the same tick → draw.
  const botErr = await play(IDLE, "ace", "hay500", 1, { botCode: "move(North);\nthrow new Error('boom');" });
  assert.equal(botErr.result, "win");
  assert.match(botErr.sides.bot.error, /boom/);
  const both = await play("null.x;", "pro", "hay500", 1, { botCode: "null.y;" });
  assert.equal(both.result, "draw");
  assert.equal(both.reason, "error");

  // One failing Megafarm drone is enough to lose (the rest is stopped).
  const drone = await play(
    "if (num_drones() === 1) { spawn_drone(); while (true) harvest(); } else { move(North); undefined_thing(); }",
    "rookie",
    "hay500",
    1,
  );
  assert.equal(drone.result, "loss");
  assert.match(drone.sides.you.error, /Bot 1: .*undefined_thing/);
});

test("an infinite loop is capped by the tick cap; an op flood by the op budget", async () => {
  const t0 = Date.now();
  const spin = await play("while (true) {}", "rookie", "hay500", 1, { botCode: "while (true) {}" });
  assert.equal(spin.reason, "cap");
  assert.equal(spin.ticks, TICK_CAP);
  assert.equal(spin.result, "draw", "0 vs 0 at the cap");
  // A loop without actions vs a real farmer: the farmer wins on the goal.
  const vs = await play("while (true) { num_items(Items.Hay); }", "rookie", "hay500", 1);
  assert.equal(vs.result, "loss");
  assert.equal(vs.reason, "goal");
  // At the cap the bigger amount wins.
  const capped = await play("while (true) { harvest(); move(North); }", "rookie", "hay500", 1, { tickCap: 20_000 });
  assert.equal(capped.reason, "cap");
  assert.equal(capped.ticks, 20_000);
  const { you, bot } = capped.amounts;
  assert.equal(capped.result, you > bot ? "win" : you < bot ? "loss" : "draw");
  const behind = await play(IDLE, "rookie", "hay500", 1, { tickCap: 20_000 });
  assert.equal(behind.reason, "cap");
  assert.ok(behind.amounts.you < behind.amounts.bot);
  assert.equal(behind.result, "loss", "more at the cap wins");
  // Op budget: the flooding side is cut off (and stays at what it holds).
  const flood = await play("while (true) { num_items(Items.Hay); }", "rookie", "hay500", 1, { opBudget: 50_000 });
  assert.equal(flood.sides.you.cut, "op budget");
  assert.equal(flood.result, "loss");
  // A program that simply ends just stops; the other side plays on.
  const ends = await play("harvest();", "pro", "hay500", 1);
  assert.equal(ends.reason, "goal");
  assert.equal(ends.result, "loss");
  // Both end → the match ends right away.
  const idle = await play("harvest();", "pro", "hay500", 1, { botCode: "harvest(); harvest();" });
  assert.equal(idle.reason, "idle");
  assert.ok(Date.now() - t0 < 30_000, "headless: seconds, not minutes");
});

// ---------- isolation ----------

test("isolation: the player's world, save, records and contracts are untouched by a match", async () => {
  const s = W.createGame();
  s.unlocks.Expand = 3;
  s.size = 4;
  s.tiles = Array.from({ length: 16 }, W.newTile);
  Object.assign(s.items, { Hay: 123, Wood: 45, Gold: 6 });
  s.clock = 777;
  C.ensureContracts(s, "2026-11-21");
  R.addDinoHarvest(s, { bone: 9, level: 1, cut: 3, at: 1 });
  s.arena = sanitizeArena({ rating: 1111, matches: [] });
  const before = JSON.stringify(W.serialize(s));

  // localStorage must never be touched by the runner.
  const touched = [];
  const prev = globalThis.localStorage;
  globalThis.localStorage = new Proxy({}, { get: (_t, k) => (touched.push(k), () => null) });
  try {
    // A program that does everything it can to its farm: clear, expand, spend.
    const vandal = "clear(); unlock(Unlocks.Speed); deliver_contract('2026-11-21#1'); while (true) { harvest(); move(East); }";
    const m = await play(vandal, "ace", "hay500", 4);
    assert.equal(m.result, "loss");
    await play(BOTS.ace.code, "pro", "pumpkin300", 4);
  } finally {
    globalThis.localStorage = prev;
  }
  assert.deepEqual(touched, []);
  assert.equal(JSON.stringify(W.serialize(s)), before);
  assert.equal(s.arena.rating, 1111, "only recordMatch() writes the rating");
});

test("isolation: a match runs beside a live player run without disturbing it", async () => {
  const s = W.createGame();
  const logs = [];
  let t = 0; // the player's own virtual clock
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: (ms) => ((t += ms), Promise.resolve()),
  });
  const done = rt.run("for (let i = 0; i < 50; i++) { harvest(); } print(get_arena_goal(), get_contracts().length > 0);");
  const m = await play(BOTS.pro.code, "rookie", "hay500", 8);
  assert.equal(await done, "done");
  assert.equal(m.result, "win");
  assert.deepEqual(
    logs.filter((l) => l.kind === "print").map((l) => l.text),
    ["null true"],
    "outside the arena: no goal, normal contracts",
  );
});

test("inside a match: get_arena_goal() is the goal, contracts are off", async () => {
  const code =
    "const g = get_arena_goal();\n" +
    "if (g.item !== Items.Wood || g.amount !== 800) throw new Error('bad goal ' + JSON.stringify(g));\n" +
    "if (get_contracts().length !== 0) throw new Error('contracts in the arena');\n" +
    "if (deliver_contract('x')) throw new Error('delivered');\n" +
    "while (true) do_a_flip();";
  const m = await play(code, "pro", "wood800", 1, { tickCap: 5_000 });
  assert.equal(m.sides.you.error, null);
  assert.equal(m.reason, "cap");
});

// ---------- ELO ----------

test("ELO: expected score and the rating change vs each bot (K = 32)", () => {
  assert.equal(eloExpected(1000, 1000), 0.5);
  assert.ok(Math.abs(eloExpected(1000, 1200) - 0.24025) < 1e-4);
  assert.ok(Math.abs(eloExpected(1000, 800) - 0.75975) < 1e-4);
  assert.ok(Math.abs(eloExpected(1000, 1600) - 0.03065) < 1e-4);
  const table = Object.fromEntries(BOT_IDS.map((id) => [id, ["win", "draw", "loss"].map((r) => eloDelta(START_RATING, BOTS[id].rating, r))]));
  assert.deepEqual(table, {
    rookie: [8, -8, -24],
    pro: [24, 8, -8],
    ace: [31, 15, -1],
  });
  assert.deepEqual(
    ["win", "draw", "loss"].map((r) => eloDelta(1200, 1200, r)),
    [16, 0, -16],
    "equal ratings: ±K/2",
  );
});

test("ELO: recordMatch updates the rating and history; not on a demo farm", () => {
  const s = W.createGame();
  assert.deepEqual(s.arena, emptyArena());
  assert.equal(s.arena.rating, 1000);
  let r = recordMatch(s, { bot: "pro", goal: "hay500", result: "win", ticks: 50_850, seed: 7 }, 111);
  assert.deepEqual([r.recorded, r.delta, r.rating], [true, 24, 1024]);
  assert.deepEqual(s.arena.matches, [{ at: 111, bot: "pro", goal: "hay500", result: "win", ticks: 50_850, delta: 24, seed: 7 }]);
  r = recordMatch(s, { bot: "ace", goal: "wood800", result: "loss", ticks: 33_725, seed: 1 }, 112);
  assert.equal(r.delta, Math.round(32 * (0 - eloExpected(1024, 1600))));
  assert.equal(s.arena.rating, 1024 + r.delta);
  r = recordMatch(s, { bot: "rookie", goal: "pumpkin300", result: "draw", ticks: 200_000, seed: 2 }, 113);
  assert.equal(r.delta, Math.round(32 * (0.5 - eloExpected(1023, 800))));
  assert.throws(() => recordMatch(s, { bot: "toString", goal: "hay500", result: "win", ticks: 1 }));

  const demo = W.createGame();
  demo.demo = true;
  const d = recordMatch(demo, { bot: "pro", goal: "hay500", result: "win", ticks: 1 });
  assert.equal(d.recorded, false);
  assert.deepEqual(demo.arena, emptyArena());
  assert.equal(W.serialize(demo).arena, null, "a demo farm never persists arena data");
});

test("history: capped at the last 20 matches (newest last)", () => {
  assert.equal(MAX_HISTORY, 20);
  const s = W.createGame();
  for (let i = 0; i < 25; i++) recordMatch(s, { bot: "rookie", goal: "hay500", result: i % 2 ? "win" : "loss", ticks: i, seed: i }, 1000 + i);
  assert.equal(s.arena.matches.length, 20);
  assert.deepEqual(
    s.arena.matches.map((m) => m.ticks),
    Array.from({ length: 20 }, (_, i) => i + 5),
  );
  const big = { rating: 1234, matches: Array.from({ length: 30 }, (_, i) => ({ at: i, bot: "pro", goal: "wood800", result: "draw", ticks: i })) };
  const clean = sanitizeArena(big);
  assert.equal(clean.matches.length, 20);
  assert.equal(clean.matches[0].ticks, 10);
});

test("save: the arena section round-trips, survives a rejected farm, old saves start at 1000", () => {
  const s = W.createGame();
  recordMatch(s, { bot: "ace", goal: "pumpkin300", result: "win", ticks: 90_000, seed: 5 }, 42);
  const data = W.serialize(s);
  assert.deepEqual(data.arena, s.arena);
  assert.deepEqual(W.deserialize(JSON.parse(JSON.stringify(data))).arena, s.arena);
  // A broken farm part still keeps the rating (like records).
  assert.deepEqual(W.deserialize({ ...data, size: 999 }).arena, s.arena);
  // Older saves have no arena section.
  const old = { ...data };
  delete old.arena;
  assert.deepEqual(W.deserialize(old).arena, emptyArena());
  // Junk is cleaned entry by entry.
  const junk = {
    rating: "nope",
    matches: [null, { bot: "boss", goal: "hay500", result: "win", ticks: 1 }, { bot: "pro", goal: "gold200", result: "win", ticks: 1 }, { bot: "pro", goal: "hay500", result: "win", ticks: -1 }, { bot: "pro", goal: "hay500", result: "draw", ticks: 9, delta: "x", seed: -4 }],
  };
  assert.deepEqual(W.deserialize({ ...data, arena: junk }).arena, {
    rating: 1000,
    matches: [{ at: 0, bot: "pro", goal: "hay500", result: "draw", ticks: 9, delta: 0, seed: null }],
  });
  assert.deepEqual(W.serialize(W.deserialize(W.serialize(s))), W.serialize(s), "stable");
});

test("UI path: playMatch (main-thread fallback without Workers) maps error lines back to the file", async () => {
  const { playMatch } = await import("./arenaClient.js");
  const { buildProgram } = await import("./program.js");
  assert.equal(typeof globalThis.Worker, "undefined", "node: no Worker → same runMatch on this thread");
  const files = [
    { id: 1, name: "bot", code: "while (true) {\n  helper();\n}" },
    { id: 2, name: "lib", code: "function helper() {\n  harvest();\n  missing_fn();\n}" },
  ];
  const prog = buildProgram(files, 1);
  const seen = [];
  const m = await playMatch({ code: prog.code, segments: prog.segments, bot: "rookie", goal: "hay500", seed: 1, onProgress: (p) => seen.push(p) });
  assert.equal(m.result, "loss");
  assert.match(m.sides.you.error, /^lib, line 3: ReferenceError: missing_fn is not defined/);
  assert.ok(seen.length >= 1 && seen.at(-1).ticks === m.ticks);
});
