// v4 phase 2: headless replay verification (src/farmer/verify.js), the engine
// side of the server's anti-cheat level 2. The worker / HTTP side is tested in
// server/server.test.mjs.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { ACTION_TICKS, FLIP_TICKS } from "./runtime.js";
import { generateSeededMaze, pathDistances } from "./maze.js";
import { EXAMPLES } from "./examples.js";
import { BOT_CODE } from "./arenaBots.js";
import { DNF_TICKS, runSolo } from "./arena.js";
import { DINO_BENCHMARK, DINO_MAX_BONE, MAZE_BENCHMARK } from "./onlineRules.js";
import {
  DINO_VERIFY_CLOCK_CAP,
  MAZE_VERIFY_TICK_CAP,
  VERIFY_STOCK,
  dinoVerifyWorld,
  mazeVerifyWorld,
  runVerification,
  verifyArena,
  verifyDino,
  verifyMaze,
} from "./verify.js";

// The DFS solver from the online tests: spawns the maze itself, then solves it.
const SOLVER = `use_item(Items.Fertilizer);
const seen = new Set();
const back = { North: South, South: North, East: West, West: East };
const key = () => get_pos_x() + "," + get_pos_y();
function dfs() {
  if (get_entity_type() === Entities.Treasure) { harvest(); return true; }
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
const MAZE_RUNNER = EXAMPLES.find((e) => e.id === "maze").code;

const SOLVE_ONLY = SOLVER.replace("use_item(Items.Fertilizer);", "");
const JOB = { level: 1, seed: 424242 };
const { size: N, sx: SX, sy: SY } = MAZE_BENCHMARK;
const COURSE = generateSeededMaze(N, SX, SY, JOB.seed);
const DIST = pathDistances(N, COURSE.walls, SX, SY)[COURSE.treasure.y * N + COURSE.treasure.x];
/** The fewest ticks any program can need: every step of the way, one action each. */
const FLOOR = DIST * ACTION_TICKS;

test("maze benchmark: the documented, fixed farm; its public definition has no maze seed", () => {
  assert.deepEqual(MAZE_BENCHMARK, { size: 12, sx: 0, sy: 0, rngSeed: 2112 });
  const { state } = mazeVerifyWorld({ ...MAZE_BENCHMARK, ...JOB, level: 2, hidden: true });
  assert.ok(state.tiles.every((t) => t.entity.type === "Bush" && t.entity.progress === 1));
  assert.deepEqual([state.unlocks.Mazes, state.unlocks.Speed, state.drone.x, state.drone.y, state.weather], [2, 5, 0, 0, null]);
  for (const [item, n] of Object.entries(state.items)) assert.equal(n, item === "Power" ? 0 : VERIFY_STOCK, item);
  // The fallback world holds exactly the maze of the seed.
  const standing = mazeVerifyWorld({ ...MAZE_BENCHMARK, ...JOB, hidden: true }, { prespawned: true }).state;
  assert.deepEqual(standing.maze.treasure, COURSE.treasure);
  assert.deepEqual(standing.tiles.map((t) => t.entity?.type === "Hedge"), COURSE.walls);
  assert.equal(W.createGame().benchMaze, null, "no other world has one");
  assert.equal("benchMaze" in W.serialize(state), false, "never saved");
});

test("maze benchmark: one program, one seed → the same numbers every time; another seed → another maze", async () => {
  for (const code of [SOLVER, MAZE_RUNNER]) {
    const r = await verifyMaze({ ...JOB, code });
    assert.deepEqual([r.solved, r.mode, r.error], [true, "spawn", null], JSON.stringify(r));
    assert.ok(r.ticks >= FLOOR && r.ops > DIST);
    assert.deepEqual(await verifyMaze({ ...JOB, code }), r);
    const other = await verifyMaze({ ...JOB, seed: 7, code });
    assert.equal(other.solved, true);
    assert.notDeepEqual([other.ticks, other.ops], [r.ticks, r.ops]);
  }
});

test("maze benchmark: no claim and no layout from the job is an input", async () => {
  const r = await verifyMaze({ ...JOB, code: SOLVER });
  const forged = await runVerification({ kind: "maze", ...JOB, code: SOLVER, ticks: 1, ops: 1, size: 1, sx: 3, sy: 5, rngSeed: 9, hidden: false });
  assert.deepEqual(forged, r, "a tiny farm or another start tile can't be asked for");
});

test("maze benchmark: the clock runs from the start of the run, whoever grows the maze", async () => {
  const grown = await verifyMaze({ ...JOB, code: SOLVER });
  const standing = await verifyMaze({ ...JOB, code: SOLVE_ONLY });
  assert.deepEqual([standing.solved, standing.mode], [true, "prespawned"], JSON.stringify(standing));
  assert.deepEqual([grown.ticks, grown.ops], [standing.ticks + ACTION_TICKS, standing.ops + 1], "growing it costs its one action");
  const late = await verifyMaze({ ...JOB, code: `spin_in_place();\n${SOLVER}` });
  assert.equal(late.ticks, grown.ticks + FLIP_TICKS);
});

test("maze benchmark: a program that prepares its own farm first is measured too", async () => {
  const code = `clear(); plant(Entities.Bush); while (!can_harvest()) spin_in_place(); trade(Items.Fertilizer);\n${SOLVER}`;
  const r = await verifyMaze({ ...JOB, code });
  assert.deepEqual([r.solved, r.mode], [true, "spawn"], JSON.stringify(r));
  const plain = await verifyMaze({ ...JOB, code: SOLVER });
  assert.ok(r.ticks > plain.ticks);
});

test("maze benchmark: bots parked on the treasure (even with the seed known) gain nothing", async () => {
  const go = (n, d) => `for (let i = 0; i < ${n}; i++) move(${d});`;
  const code = `if (num_bots() === 1) {
  spawn_bot();
  for (let i = 0; i < 40; i++) spin_in_place();
  use_item(Items.Fertilizer);
} else {
  ${go(COURSE.treasure.x, "East")} ${go(COURSE.treasure.y, "North")}
  for (let i = 0; i < 400 && get_entity_type() !== Entities.Treasure; i++) spin_in_place();
  harvest();
}`;
  const r = await verifyMaze({ ...JOB, code });
  assert.equal(r.solved, false, JSON.stringify(r));
  // Growing the maze brings every bot to the spawner …
  const { state, rng } = mazeVerifyWorld({ ...MAZE_BENCHMARK, ...JOB, hidden: true });
  Object.assign(W.spawnDrone(state).drone, COURSE.treasure);
  W.spawnMaze(state, rng);
  assert.deepEqual(state.drones.map((d) => [d.x, d.y]), [[SX, SY], [SX, SY]]);
  // … on the benchmark only: on a player's farm a bot on a path tile stays there.
  const own = mazeVerifyWorld({ ...MAZE_BENCHMARK, ...JOB });
  Object.assign(W.spawnDrone(own.state).drone, COURSE.treasure);
  W.spawnMaze(own.state, own.rng);
  assert.deepEqual([own.state.drones[1].x, own.state.drones[1].y], [COURSE.treasure.x, COURSE.treasure.y]);
});

test("maze benchmark: spreading bots blindly, or running a timeline ahead first, is no shortcut", async () => {
  const solve = SOLVE_ONLY;
  const blind = `if (num_bots() === 1) {
  for (let i = 0; i < 11; i++) spawn_bot();
  for (let i = 0; i < 60; i++) spin_in_place();
  use_item(Items.Fertilizer);
} else {
  for (let i = Math.floor(Math.random() * 6); i > 0; i--) { move(East); move(East); }
  for (let i = Math.floor(Math.random() * 6); i > 0; i--) { move(North); move(North); }
  while (can_move(North) && can_move(East) && can_move(South) && can_move(West)) spin_in_place();
}
${solve}`;
  // Free senses move a bot's own clock without any waiting: 60,000 ticks ahead.
  const ahead = `if (num_bots() === 1) {
  spawn_bot();
  for (let i = 0; i < 60000; i++) get_time();
  use_item(Items.Fertilizer);
} else {
  while (get_entity_type() === Entities.Bush) spin_in_place();
${solve}
}`;
  for (const [name, code] of Object.entries({ blind, ahead })) {
    const r = await verifyMaze({ ...JOB, code });
    if (r.solved) assert.ok(r.ticks >= FLOOR, `${name}: ${r.ticks} ticks, the way alone is ${FLOOR}`);
  }
  const masked = await verifyMaze({ ...JOB, code: ahead });
  assert.ok(masked.solved && masked.ticks >= 60_000, JSON.stringify(masked));
});

test("maze benchmark: a program can't work the seed out from its random numbers or a decoy maze", async () => {
  // Math.random() and the world's rolls are the same whatever the seed …
  const read = async (seed) => {
    const { state, rng } = mazeVerifyWorld({ ...MAZE_BENCHMARK, level: 1, seed, hidden: true });
    assert.equal(state.pendingSeed, null);
    const r = await verifyMaze({ level: 1, seed, code: "throw new Error([Math.random(), Math.random()].join());" });
    return [rng(), rng(), r.error];
  };
  assert.deepEqual(await read(1), await read(2 ** 32 - 1));
  // … and a maze grown anywhere else is a decoy that has nothing to do with it.
  const decoy = (seed) => {
    const { state, rng } = mazeVerifyWorld({ ...MAZE_BENCHMARK, level: 1, seed, hidden: true });
    state.drone.x = 4;
    W.spawnMaze(state, rng);
    return [state.maze.seed, state.tiles.map((t) => t.entity?.type ?? null)];
  };
  assert.deepEqual(decoy(1), decoy(99));
  assert.notEqual(decoy(1)[0], 1);
  const away = await verifyMaze({ ...JOB, code: "move(East); move(East); use_item(Items.Fertilizer);" });
  assert.deepEqual([away.solved, away.wrongStart], [false, { x: 2, y: 0 }]);
  // A solver that grows it elsewhere still gets its run, on the standing maze.
  const late = await verifyMaze({ ...JOB, code: `move(East); move(East);\n${SOLVER}` });
  assert.deepEqual([late.solved, late.mode], [true, "prespawned"], JSON.stringify(late));
});

test("maze benchmark: programs that never solve the maze have no result", async () => {
  const walker = await verifyMaze({ ...JOB, code: "while (true) { move(North); }" });
  assert.equal(walker.solved, false);
  assert.equal(walker.ticks, null);
  assert.match(walker.reason, /cap/);
  assert.ok(MAZE_VERIFY_TICK_CAP >= 1_000_000);
  const broken = await verifyMaze({ ...JOB, code: "use_item(Items.Fertilizer); nope();" });
  assert.equal(broken.solved, false);
  assert.match(broken.error, /nope/);
  const quits = await verifyMaze({ ...JOB, code: "use_item(Items.Fertilizer);" });
  assert.equal(quits.solved, false);
  assert.match(quits.reason, /ended|idle/);
});

test("maze benchmark: program randomness is seeded, so a random-walk solver replays deterministically", async () => {
  const code = `use_item(Items.Fertilizer);
const dirs = [North, East, South, West];
while (get_entity_type() !== Entities.Treasure) move(dirs[Math.floor(Math.random() * 4)]);
harvest();`;
  const a = await verifyMaze({ ...JOB, code });
  const b = await verifyMaze({ ...JOB, code });
  assert.equal(a.solved, true, JSON.stringify(a));
  assert.deepEqual([a.ticks, a.ops], [b.ticks, b.ops]);
});

test("arena replay equals the client's runSolo; non-finishers report DNF", async () => {
  const r = await verifyArena({ code: BOT_CODE.pro, goal: "wood800", seed: 31 });
  const solo = await runSolo({ code: BOT_CODE.pro, goal: "wood800", seed: 31 });
  assert.deepEqual([r.reached, r.ticks, r.ops], [true, solo.ticks, solo.ops]);
  const dnf = await runVerification({ kind: "arena", code: "harvest()", goal: "hay500", seed: 1 });
  assert.deepEqual([dnf.reached, dnf.ticks], [false, DNF_TICKS]);
  await assert.rejects(runVerification({ kind: "chess" }), /unknown verification kind/);
  await assert.rejects(verifyArena({ code: "x", goal: "gold200", seed: 1 }), /unknown arena goal/);
});

// ---------- dino benchmark (v5 phase 2) ----------

// Wait until the dinosaur has grown for a while, then cut it wherever the sweep meets it.
const DINO_SWEEP = `const n = get_world_size();
while (get_time() < 100) spin_in_place();
for (let x = 0; x < n; x++) {
  for (let y = 0; y < n; y++) {
    if (get_entity_type() === Entities.Dinosaur) harvest();
    move(North);
  }
  move(East);
}
`;

test("dino benchmark farm: the documented, fixed definition", () => {
  assert.deepEqual(DINO_BENCHMARK, { seed: 4188, size: 12, x: 6, y: 6, worldTicks: 3000 });
  assert.equal(DINO_VERIFY_CLOCK_CAP, 300_000);
  const { state } = dinoVerifyWorld();
  assert.equal(state.size, 12);
  assert.deepEqual(state.dino, { body: [{ x: 6, y: 6 }], dir: "South", stepTimer: 0, appleTimer: 0, seed: 4188, draws: 0, start: { x: 6, y: 6 } });
  assert.ok(state.tiles.every((t, i) => t.entity.type === (i === 6 * 12 + 6 ? "Dinosaur" : "Grass") && t.entity.progress === 1));
  assert.deepEqual([state.drone.x, state.drone.y], [0, 0]);
  assert.equal(state.unlocks.Dinosaurs, 3);
  assert.equal(state.unlocks.Speed, 5);
  for (const [item, n] of Object.entries(state.items)) assert.equal(n, item === "Bone" || item === "Power" ? 0 : VERIFY_STOCK, item);
  assert.deepEqual([state.weather, state.maze, state.records.dino], [null, null, null]);
  assert.equal(JSON.stringify(dinoVerifyWorld().state), JSON.stringify(state), "the same every time");
});

test("dino benchmark: the score is the largest single harvest, identical on every run", async () => {
  const a = await verifyDino({ code: DINO_SWEEP });
  assert.equal(a.harvested, true, JSON.stringify(a));
  assert.equal(a.reason, "ended");
  assert.equal(a.bone, a.cut ** 2 * 3, "segments² × level 3");
  assert.ok(a.cut >= 3 && a.bone <= DINO_MAX_BONE);
  assert.ok(a.ticks > 0 && a.ops > 0);
  const b = await runVerification({ kind: "dino", code: DINO_SWEEP, value: 999_999, bone: 1, ticks: 1, ops: 1, seed: 1 });
  assert.deepEqual(b, a, "no number from the job is an input");
  // A smaller harvest afterwards (or a later, equal one) changes nothing.
  const more = await verifyDino({ code: DINO_SWEEP + "while (true) spin_in_place();" });
  assert.deepEqual({ ...more, reason: "" }, { ...a, reason: "" });
  assert.equal(more.reason, "clock cap", "a program that never ends is measured up to the cap");
});

test("dino benchmark: an egg planted later has the benchmark seed too (clear() first is no re-roll)", async () => {
  const replant = `clear();
for (let i = 0; i < 6; i++) move(North);
for (let i = 0; i < 6; i++) move(East);
plant(Entities.Dinosaur);
while (get_time() < 2) spin_in_place();
while (get_entity_type() !== Entities.Dinosaur) move([North, East, South, West][Math.floor(Math.random() * 4)]);
harvest();`;
  const r = await verifyDino({ code: replant });
  assert.equal(r.harvested, true, JSON.stringify(r));
  assert.deepEqual(await verifyDino({ code: replant }), r, "Math.random() is seeded as well");
  const { state } = dinoVerifyWorld();
  W.clearFarm(state);
  W.plant(state, "Dinosaur", () => 0.123);
  assert.equal(state.dino.seed, DINO_BENCHMARK.seed);
});

test("dino benchmark: nothing harvested → no result; a late failure keeps the harvest", async () => {
  for (const [code, reason] of [["harvest();", "ended"], ["while (true) spin_in_place();", "clock cap"], ["nope();", "error"], ["let x = ;", "error"], ["while (true) { get_pos_x(); }", "clock cap"]]) {
    const r = await verifyDino({ code });
    assert.deepEqual([r.harvested, r.bone, r.ticks, r.ops, r.reason], [false, null, null, null, reason], code);
  }
  const ok = await verifyDino({ code: DINO_SWEEP });
  const late = await verifyDino({ code: DINO_SWEEP + "throw new Error('too late');" });
  assert.deepEqual([late.bone, late.ticks, late.ops], [ok.bone, ok.ticks, ok.ops]);
  assert.match(late.error, /too late/);
});
