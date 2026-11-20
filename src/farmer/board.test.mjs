// Board helpers + demo farm. Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { findGiantPumpkins } from "./boardModel.js";
import { createDemoGame, isDemoHash } from "./demo.js";

const pumpkin = (s, x, y, progress = 1) => {
  const t = W.tileAt(s, x, y);
  t.ground = "Soil";
  t.entity = W.makeEntity("Pumpkin", Math.random, progress);
};
const sized = (n) => {
  const s = W.createGame();
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  return s;
};

test("findGiantPumpkins: only full k×k groups of grown pumpkins (k ≥ 2)", () => {
  const s = sized(5);
  for (let x = 1; x < 3; x++) for (let y = 1; y < 3; y++) pumpkin(s, x, y);
  pumpkin(s, 4, 4); // single → not giant
  assert.deepEqual(
    findGiantPumpkins(s).map(({ x0, y0, k }) => ({ x0, y0, k })),
    [{ x0: 1, y0: 1, k: 2 }],
  );
  pumpkin(s, 3, 1); // L-ish group of 5 → not square
  assert.equal(findGiantPumpkins(s).length, 0);
  W.tileAt(s, 3, 1).entity.progress = 0.5; // unripe neighbour doesn't join the group
  assert.equal(findGiantPumpkins(s).length, 1);
});

test("demo farm: 8×8, all unlocks, a 3×3 and a 2×2 giant pumpkin, drone mid-board", () => {
  const s = createDemoGame();
  assert.equal(s.size, 8);
  assert.equal(s.tiles.length, 64);
  assert.ok(Object.keys(s.unlocks).every((id) => W.isUnlocked(s, id)));
  const giants = findGiantPumpkins(s)
    .map(({ x0, y0, k }) => `${k}@${x0},${y0}`)
    .sort();
  assert.deepEqual(giants, ["2@0,4", "3@0,0"]);
  assert.deepEqual([s.drone.x, s.drone.y], [4, 4]);
  // survives a save round-trip (but the page never saves it)
  assert.equal(W.deserialize(W.serialize(s)).size, 8);
  assert.equal(isDemoHash("#/farmer?demo=1"), true);
  assert.equal(isDemoHash("#/farmer"), false);
});
