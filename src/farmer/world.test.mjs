// Pure world-logic tests. Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";

const rich = () => {
  const s = W.createGame();
  for (const k of Object.keys(s.items)) s.items[k] = 10_000;
  return s;
};
const unlockAll = (s, ...ids) => ids.forEach((id) => assert.equal(W.buyUnlock(s, id).ok, true, id));
const grow = (s, seconds = 60) => {
  for (let i = 0; i < seconds * 10; i++) W.tick(s, 0.1, () => 0.99); // rng 0.99: no dead pumpkins
};

test("new game: 1×1 grassland with ripe grass, drone at (0,0)", () => {
  const s = W.createGame();
  assert.equal(s.size, 1);
  assert.equal(s.tiles[0].ground, "Grassland");
  assert.equal(s.tiles[0].entity.type, "Grass");
  assert.deepEqual([s.drone.x, s.drone.y], [0, 0]);
});

test("harvesting grass gives Hay and grass regrows", () => {
  const s = W.createGame();
  assert.equal(W.harvest(s), true);
  assert.equal(s.items.Hay, 2);
  assert.equal(s.tiles[0].entity, null);
  grow(s, 2.1);
  assert.equal(W.isGrown(s.tiles[0].entity), true);
  W.harvest(s);
  assert.equal(s.items.Hay, 4);
});

test("unripe plants are destroyed by harvest (except grass)", () => {
  const s = rich();
  unlockAll(s, "Plant");
  W.harvest(s);
  assert.equal(W.plant(s, "Bush").ok, true);
  assert.equal(W.harvest(s), true);
  assert.equal(s.tiles[0].entity, null);
  assert.equal(s.items.Wood, 10_000);
});

test("plant bush → wood", () => {
  const s = W.createGame();
  s.items.Hay = 16;
  unlockAll(s, "Plant");
  assert.equal(W.plant(s, "Bush").ok, true); // replaces the grass
  grow(s, 6.1);
  W.harvest(s);
  assert.equal(s.items.Wood, 2);
});

test("locked plant fails with an unlock hint", () => {
  const s = W.createGame();
  const r = W.plant(s, "Bush");
  assert.equal(r.ok, false);
  assert.equal(r.locked, "Plant");
});

test("till + carrot flow deducts seed cost and needs soil", () => {
  const s = W.createGame();
  s.items.Hay = 100;
  s.items.Wood = 80;
  unlockAll(s, "Plant", "Carrots");
  assert.equal(s.items.Wood, 10);
  assert.equal(W.plant(s, "Carrot").ok, false); // grassland
  assert.equal(W.till(s).ok, true);
  assert.equal(s.tiles[0].ground, "Soil");
  assert.equal(W.plant(s, "Carrot").ok, true);
  assert.equal(s.items.Wood, 9);
  assert.equal(s.items.Hay, 100 - 16 - 2);
  grow(s, 8.1);
  W.harvest(s);
  assert.equal(s.items.Carrot, 2);
  W.till(s);
  assert.equal(s.tiles[0].ground, "Grassland");
});

test("pumpkin 2×2 square yields 8 and clears the whole group", () => {
  const s = rich();
  unlockAll(s, "Plant", "Carrots", "Pumpkins", "Expand", "Expand"); // 3×3
  assert.equal(s.size, 3);
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    s.drone.x = x;
    s.drone.y = y;
    W.till(s);
    assert.equal(W.plant(s, "Pumpkin").ok, true);
  }
  grow(s, 5.1);
  const before = s.items.Pumpkin;
  s.drone.x = 1;
  s.drone.y = 1;
  W.harvest(s);
  assert.equal(s.items.Pumpkin - before, 8);
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.equal(W.tileAt(s, x, y).entity, null);
});

test("pumpkin non-square group yields its size; dead pumpkins yield nothing", () => {
  assert.equal(W.pumpkinYield([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), 3);
  assert.equal(W.pumpkinYield([{ x: 0, y: 0 }]), 1);
  const s = rich();
  unlockAll(s, "Plant", "Carrots", "Pumpkins");
  W.till(s);
  W.plant(s, "Pumpkin");
  for (let i = 0; i < 55; i++) W.tick(s, 0.1, () => 0); // rng 0 → always dies
  assert.equal(s.tiles[0].entity.type, "Dead_Pumpkin");
  const before = s.items.Pumpkin;
  W.harvest(s);
  assert.equal(s.items.Pumpkin, before);
  assert.equal(s.tiles[0].entity, null);
});

test("trees grow 2× slower per adjacent tree", () => {
  const s = rich();
  unlockAll(s, "Plant", "Carrots", "Trees", "Expand", "Expand");
  W.plant(s, "Tree");
  assert.equal(W.effectiveGrowTime(s, 0, 0), 10);
  s.drone.x = 1;
  W.plant(s, "Tree");
  assert.equal(W.effectiveGrowTime(s, 0, 0), 20);
});

test("cactus: sorted farm yields n², unsorted yields n", () => {
  const setup = (sizes) => {
    const s = rich();
    unlockAll(s, "Plant", "Carrots", "Pumpkins", "Cactus", "Expand"); // 2×2
    sizes.forEach((sz, i) => {
      const t = s.tiles[i];
      t.ground = "Soil";
      t.entity = { type: "Cactus", progress: 1, size: sz };
    });
    return s;
  };
  // tiles index = y*2+x → [ (0,0), (1,0), (0,1), (1,1) ]
  const sorted = setup([1, 2, 3, 4]);
  const before = sorted.items.Cactus;
  assert.equal(W.cactusSorted(sorted), true);
  W.harvest(sorted);
  assert.equal(sorted.items.Cactus - before, 16);
  assert.ok(sorted.tiles.every((t) => t.entity === null));

  const unsorted = setup([2, 1, 3, 4]);
  assert.equal(W.cactusSorted(unsorted), false);
  W.harvest(unsorted);
  assert.equal(unsorted.items.Cactus - before, 4);
});

test("swap moves entities with their data and refuses to cross edges", () => {
  const s = rich();
  unlockAll(s, "Plant", "Carrots", "Pumpkins", "Cactus", "Expand");
  s.tiles[0].entity = { type: "Cactus", progress: 0.5, size: 7 };
  s.tiles[1].entity = null;
  assert.equal(W.swap(s, "East").ok, true);
  assert.equal(s.tiles[1].entity.size, 7);
  assert.equal(s.tiles[1].entity.progress, 0.5);
  assert.equal(W.swap(s, "West").ok, false);
});

test("sunflowers give power; measure reads petals", () => {
  const s = rich();
  unlockAll(s, "Plant", "Carrots", "Pumpkins", "Sunflowers");
  W.till(s);
  W.plant(s, "Sunflower", () => 0.5);
  const petals = W.measure(s);
  assert.ok(petals >= 7 && petals <= 15);
  grow(s, 7.1);
  const before = s.items.Power;
  W.harvest(s);
  assert.equal(s.items.Power - before, 2);
});

test("water speeds growth and decays; tank refills over time", () => {
  const s = W.createGame();
  s.items.Wood = 1000;
  s.items.Carrot = 1000;
  s.items.Hay = 1000;
  unlockAll(s, "Plant", "Carrots", "Watering");
  s.items.Water = 0;
  grow(s, 8.5); // +1 Water every 8 s at Watering level 1
  assert.equal(s.items.Water, 1);
  assert.equal(W.useItem(s, "Water").ok, true);
  assert.equal(s.tiles[0].water, 0.25);
  W.tick(s, 1);
  assert.ok(s.tiles[0].water < 0.25);
});

test("fertilizer via trade skips growth", () => {
  const s = rich();
  unlockAll(s, "Plant", "Carrots", "Pumpkins", "Fertilizer");
  const p = s.items.Pumpkin;
  assert.equal(W.trade(s, "Fertilizer", 2).ok, true);
  assert.equal(s.items.Pumpkin, p - 2 * 3);
  W.harvest(s);
  W.plant(s, "Bush"); // 6 s
  W.useItem(s, "Fertilizer", 2);
  assert.equal(W.isGrown(s.tiles[0].entity), true);
});

test("expand increases size and clears the farm", () => {
  const s = W.createGame();
  s.items.Hay = 45;
  assert.equal(W.buyUnlock(s, "Expand").ok, true);
  assert.equal(s.size, 2);
  assert.equal(s.tiles.length, 4);
  assert.ok(s.tiles.every((t) => t.entity === null && t.ground === "Grassland"));
  assert.equal(s.items.Hay, 0);
  assert.equal(W.buyUnlock(s, "Expand").ok, false); // needs 36 Wood now
});

test("unlock prerequisites and max levels", () => {
  const s = rich();
  assert.equal(W.buyUnlock(s, "Carrots").locked, "Plant");
  unlockAll(s, "Plant");
  assert.equal(W.buyUnlock(s, "Plant").ok, false); // maxed
  assert.equal(W.unlockCost(s, "Speed").Hay, 24);
  unlockAll(s, "Speed");
  assert.equal(W.unlockCost(s, "Speed").Hay, 90);
  assert.equal(W.speedMultiplier(s), 2);
});

test("movement wraps around the edges", () => {
  const s = rich();
  unlockAll(s, "Expand", "Expand"); // 3×3
  W.moveDrone(s, "West");
  assert.deepEqual([s.drone.x, s.drone.y], [2, 0]);
  W.moveDrone(s, "South");
  assert.deepEqual([s.drone.x, s.drone.y], [2, 2]);
  W.moveDrone(s, "North");
  assert.deepEqual([s.drone.x, s.drone.y], [2, 0]);
});

test("serialize / deserialize round-trip keeps growth progress", () => {
  const s = rich();
  unlockAll(s, "Plant", "Expand");
  W.plant(s, "Bush");
  W.tick(s, 1);
  const copy = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  assert.equal(copy.size, 2);
  assert.equal(copy.tiles[0].entity.type, "Bush");
  assert.equal(copy.tiles[0].entity.progress, s.tiles[0].entity.progress);
  assert.deepEqual(copy.items, s.items);
  assert.deepEqual(copy.unlocks, s.unlocks);
  assert.equal(W.deserialize({ v: 99 }).size, 1); // garbage → new game
});
