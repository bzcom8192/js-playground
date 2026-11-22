// v4 phase 2: headless replay verification (src/farmer/verify.js), the engine
// side of the server's anti-cheat level 2. The worker / HTTP side is tested in
// server/server.test.mjs.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { generateSeededMaze, mulberry32 } from "./maze.js";
import { EXAMPLES } from "./examples.js";
import { BOT_CODE } from "./arenaBots.js";
import { DNF_TICKS, runSolo } from "./arena.js";
import { MAZE_VERIFY_TICK_CAP, mazeVerifyWorld, runVerification, verifyArena, verifyMaze } from "./verify.js";

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

/** Play `code` on a small "player farm" (as the page would) until its first
 *  timed maze solve → the runtime's onRecord event { attempt, code }. */
async function localRecord(code, { n = 6, x = 2, y = 3, level = 1, rngSeed = 5 } = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, Carrots: 1, Pumpkins: 1, Fertilizer: 1, Mazes: level });
  s.items.Fertilizer = 1;
  s.drone.x = x;
  s.drone.y = y;
  W.droneTile(s).entity = { type: "Bush", progress: 1 };
  let t = 0;
  const events = [];
  const rt = createRuntime({
    getState: () => s,
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
    rng: mulberry32(rngSeed),
    onRecord: (ev) => {
      events.push(ev);
      rt.stop();
    },
  });
  await rt.run(code);
  assert.equal(events.length, 1, "the local run set a record");
  return events[0];
}
const jobOf = (ev) => ({ code: ev.code, level: ev.attempt.level, seed: ev.attempt.seed, size: ev.attempt.size, sx: ev.attempt.sx, sy: ev.attempt.sy });

test("maze replay reproduces a local record exactly (program spawns the maze itself)", async () => {
  for (const [code, opts] of [
    [SOLVER, {}],
    [SOLVER, { n: 10, x: 7, y: 1, level: 3 }],
    [MAZE_RUNNER, { n: 8, x: 0, y: 0, level: 2 }],
  ]) {
    const ev = await localRecord(code, opts);
    const r = await verifyMaze(jobOf(ev));
    assert.equal(r.solved, true, JSON.stringify(r));
    assert.equal(r.mode, "spawn");
    assert.deepEqual([r.ticks, r.ops], [ev.attempt.ticks, ev.attempt.ops]);
    // Deterministic: the same job again gives the same numbers.
    const again = await verifyMaze(jobOf(ev));
    assert.deepEqual([again.ticks, again.ops], [r.ticks, r.ops]);
  }
});

test("maze replay: the claim is never an input (fake numbers can't leak in)", async () => {
  const ev = await localRecord(SOLVER);
  const r = await runVerification({ kind: "maze", ...jobOf(ev), ticks: 1, ops: 1 });
  assert.deepEqual([r.ticks, r.ops], [ev.attempt.ticks, ev.attempt.ops]);
});

test("maze replay: a solver that expects an existing maze is verified in prespawned mode", async () => {
  const solveOnly = SOLVER.replace("use_item(Items.Fertilizer);", "");
  const r = await verifyMaze({ code: solveOnly, level: 1, seed: 424242, size: 8, sx: 3, sy: 5 });
  assert.equal(r.solved, true, JSON.stringify(r));
  assert.equal(r.mode, "prespawned");
  assert.ok(r.ticks > 0 && r.ops > 0);
  // The maze it solved is the claimed one: the prespawned world holds exactly it.
  const { state } = mazeVerifyWorld({ seed: 424242, size: 8, sx: 3, sy: 5, level: 1 }, { prespawned: true });
  const { walls, treasure } = generateSeededMaze(8, 3, 5, 424242);
  assert.deepEqual(state.maze.treasure, treasure);
  assert.deepEqual(state.tiles.map((t) => t.entity?.type === "Hedge"), walls);
});

test("maze replay: programs that never solve the recorded maze are not verified", async () => {
  const job = { level: 1, seed: 99, size: 6, sx: 0, sy: 0 };
  const walker = await verifyMaze({ ...job, code: "while (true) { move(North); }" });
  assert.equal(walker.solved, false);
  assert.equal(walker.ticks, null);
  assert.match(walker.reason, /cap/);
  assert.ok(MAZE_VERIFY_TICK_CAP >= 1_000_000);
  const broken = await verifyMaze({ ...job, code: "use_item(Items.Fertilizer); nope();" });
  assert.equal(broken.solved, false);
  assert.match(broken.error, /nope/);
  const quits = await verifyMaze({ ...job, code: "use_item(Items.Fertilizer);" });
  assert.equal(quits.solved, false);
  assert.match(quits.reason, /ended|idle/);
});

test("maze replay: program randomness is seeded, so a random-walk solver replays deterministically", async () => {
  const code = `use_item(Items.Fertilizer);
const dirs = [North, East, South, West];
while (get_entity_type() !== Entities.Treasure) move(dirs[Math.floor(Math.random() * 4)]);
harvest();`;
  const job = { code, level: 1, seed: 7, size: 5, sx: 2, sy: 2 };
  const a = await verifyMaze(job);
  const b = await verifyMaze(job);
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
