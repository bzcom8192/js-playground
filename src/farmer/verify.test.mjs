// v4 phase 2: headless replay verification (src/farmer/verify.js), the engine
// side of the server's anti-cheat level 2. The worker / HTTP side is tested in
// server/server.test.mjs. Since BRIEF22 the arena is the only context.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOT_CODE } from "./arenaBots.js";
import { DNF_TICKS, runSolo } from "./arena.js";
import * as V from "./verify.js";
import { runVerification, verifyArena } from "./verify.js";

test("arena replay equals the client's runSolo; non-finishers report DNF", async () => {
  const r = await verifyArena({ code: BOT_CODE.pro, goal: "wood800", seed: 31 });
  const solo = await runSolo({ code: BOT_CODE.pro, goal: "wood800", seed: 31 });
  assert.deepEqual([r.reached, r.ticks, r.ops], [true, solo.ticks, solo.ops]);
  const dnf = await runVerification({ kind: "arena", code: "harvest()", goal: "hay500", seed: 1 });
  assert.deepEqual([dnf.reached, dnf.ticks], [false, DNF_TICKS]);
  await assert.rejects(runVerification({ kind: "chess" }), /unknown verification kind/);
  await assert.rejects(verifyArena({ code: "x", goal: "gold200", seed: 1 }), /unknown arena goal/);
});

test("the maze, dino and daily race replays are gone: their jobs are unknown kinds", async () => {
  for (const kind of ["maze", "dino", "daily"]) {
    await assert.rejects(runVerification({ kind, code: "harvest();", level: 1, seed: 1 }), /unknown verification kind/, kind);
  }
  assert.deepEqual(Object.keys(V).sort(), ["VERIFY_TIMEOUT_MS", "runVerification", "verifyArena"]);
});
