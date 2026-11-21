// Dinosaurs (v2 phase 2): unlock, hatching, autonomous movement, apples,
// Bone harvest, blocked actions, maze interaction, persistence, the Bone Farm
// example, info strip and 3D models.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import {
  APPLE_SPAWN_SECONDS,
  DINO_STEP_SECONDS,
  ENTITY_INFO,
  ENTITY_UNLOCK,
  Entities,
  FUTURE_UNLOCKS,
  ITEM_ICONS,
  Items,
  UNLOCKS,
  UNLOCK_BY_ID,
  Unlocks,
  appleCap,
} from "./constants.js";
import { createRuntime } from "./runtime.js";
import { EXAMPLES } from "./examples.js";
import { FARMER_LIB } from "./farmerLib.js";
import { stripFields } from "./statusStrip.js";
import { createDemoGame } from "./demo.js";
import { createModelKit, countTriangles } from "./board3d/models.js";
import { FarmScene, dinoPartFor, dinoYaw } from "./board3d/FarmScene.js";

function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = ["North", "East", "South", "West"];
const UP_TO_DINOS = ["Plant", "Senses", "Carrots", "Pumpkins", "Fertilizer", "Cactus", "Mazes", "Dinosaurs"];

/** A rich game with everything up to Dinosaurs unlocked, expanded `expands` times. */
function dinoGame(expands = 4, { dinos = true } = {}) {
  const s = W.createGame();
  for (const k of Object.keys(s.items)) s.items[k] = 1_000_000;
  for (const id of UP_TO_DINOS) {
    if (id === "Dinosaurs" && !dinos) continue;
    assert.equal(W.buyUnlock(s, id).ok, true, id);
  }
  for (let i = 0; i < expands; i++) assert.equal(W.buyUnlock(s, "Expand").ok, true);
  s.items.Bone = 0;
  return s;
}

/** Put a dinosaur with this exact body (head first) on the farm. */
function placeDino(s, cells, dir = "East") {
  for (const [x, y] of cells) W.tileAt(s, x, y).entity = { type: "Dinosaur", progress: 1 };
  s.dino = { body: cells.map(([x, y]) => ({ x, y })), dir, stepTimer: 0, appleTimer: 0 };
}

const types = (s) => s.tiles.map((t) => t.entity?.type ?? null);
const count = (s, type) => s.tiles.filter((t) => t.entity?.type === type).length;
const snap = (s) => JSON.stringify(W.serialize(s));

/** Body is in bounds, unique, contiguous (no wrap) and exactly matches the Dinosaur tiles. */
function checkChain(s) {
  const n = s.size;
  const body = s.dino.body;
  const seen = new Set();
  body.forEach((p, i) => {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x < n && p.y < n, "in bounds");
    const k = p.y * n + p.x;
    assert.ok(!seen.has(k), "no segment overlaps another");
    seen.add(k);
    if (i > 0) assert.equal(Math.abs(p.x - body[i - 1].x) + Math.abs(p.y - body[i - 1].y), 1, "contiguous");
  });
  s.tiles.forEach((t, k) => assert.equal(t.entity?.type === "Dinosaur", seen.has(k), `tile ${k} ↔ body`));
}

// ---------- unlock & content ----------

test("Dinosaurs is a real unlock after Mazes; Megafarm stays future; new constants", () => {
  const ids = UNLOCKS.map((u) => u.id);
  assert.equal(ids.indexOf("Dinosaurs"), ids.indexOf("Mazes") + 1);
  assert.equal(UNLOCK_BY_ID.Dinosaurs.requires, "Mazes");
  assert.equal(UNLOCK_BY_ID.Dinosaurs.maxLevel, 3);
  assert.deepEqual(UNLOCK_BY_ID.Dinosaurs.cost(0), { Gold: 600, Cactus: 6000 });
  assert.deepEqual(UNLOCK_BY_ID.Dinosaurs.cost(1), { Gold: 1800, Bone: 1000 });
  assert.deepEqual(UNLOCK_BY_ID.Dinosaurs.cost(2), { Gold: 5400, Bone: 3000 });
  assert.deepEqual(
    FUTURE_UNLOCKS.map((u) => u.id),
    ["Megafarm"],
  );
  assert.equal(Entities.Dinosaur, "Dinosaur");
  assert.equal(Entities.Apple, "Apple");
  assert.equal(Items.Bone, "Bone");
  assert.equal(Unlocks.Dinosaurs, "Dinosaurs");
  assert.equal(ITEM_ICONS.Bone, "🦴");
  assert.equal(ENTITY_INFO.Dinosaur.icon, "🦖");
  assert.equal(ENTITY_INFO.Apple.icon, "🍎");
  assert.equal(ENTITY_UNLOCK.Dinosaur, "Dinosaurs");
  for (const re of [/Dinosaur: "Dinosaur";/, /Apple: "Apple";/, /Bone: "Bone";/, /Dinosaurs: "Dinosaurs";/]) {
    assert.match(FARMER_LIB, re);
  }

  const s = dinoGame(4, { dinos: false });
  assert.equal(s.items.Bone, 0, "new games have a Bone slot");
  const locked = W.plant(s, "Dinosaur");
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, "Dinosaurs");
  const fresh = W.createGame();
  for (const k of Object.keys(fresh.items)) fresh.items[k] = 1_000_000;
  assert.equal(W.buyUnlock(fresh, "Dinosaurs").locked, "Mazes", "needs Mazes first");
  assert.equal(W.buyUnlock(s, "Dinosaurs").ok, true);
  assert.equal(W.plant(s, "Apple").ok, false, "apples can't be planted");
});

// ---------- spawn ----------

test("plant(Dinosaur): empty/grass tile only, pays 10 Gold, length 1, one per farm", () => {
  const s = dinoGame(4);
  W.tick(s, 1); // grass everywhere
  assert.equal(W.droneTile(s).entity.type, "Grass");
  s.items.Gold = 25;
  assert.equal(W.plant(s, "Dinosaur").ok, true, "over grass");
  assert.equal(s.items.Gold, 15);
  assert.deepEqual(s.dino.body, [{ x: 0, y: 0 }]);
  assert.equal(W.droneTile(s).entity.type, "Dinosaur");
  assert.equal(W.isGrown(W.droneTile(s).entity), true);
  // One at a time, wherever you try.
  W.moveDrone(s, "East");
  W.moveDrone(s, "East");
  const second = W.plant(s, "Dinosaur");
  assert.equal(second.ok, false);
  assert.match(second.msg, /one dinosaur/);
  assert.equal(s.items.Gold, 15, "nothing paid for a failed plant");
  assert.equal(count(s, "Dinosaur"), 1);

  // Not on a crop; not without Gold; not inside a maze.
  const t = dinoGame(4);
  W.harvest(t);
  W.plant(t, "Bush");
  assert.match(W.plant(t, "Dinosaur").msg, /already has Bush/);
  W.moveDrone(t, "North");
  t.items.Gold = 9;
  assert.match(W.plant(t, "Dinosaur").msg, /Not enough/);
  assert.equal(t.dino, null);
  t.items.Gold = 10;
  assert.equal(W.plant(t, "Dinosaur").ok, true, "on an empty tile");
  assert.equal(t.items.Gold, 0);
  // Runtime: get_cost / num_unlocked know the dinosaur.
  const logs = [];
  const rt = createRuntime({ getState: () => t, onLog: (e) => logs.push(e), sleep: () => Promise.resolve(), yieldFn: () => Promise.resolve() });
  return rt
    .run("print(get_cost(Entities.Dinosaur).Gold, num_unlocked(Entities.Dinosaur), get_entity_type(), can_harvest());")
    .then(() => assert.equal(logs[0].text, "10 1 Dinosaur true"));
});

// ---------- movement ----------

test("one step per 0.3 s of game time; the head moves one tile", () => {
  const s = dinoGame(4); // 5×5
  W.clearFarm(s);
  s.drone.x = 2;
  s.drone.y = 2;
  assert.equal(W.plant(s, "Dinosaur").ok, true);
  const rng = seeded(1);
  W.tick(s, DINO_STEP_SECONDS - 0.01, rng);
  assert.deepEqual(s.dino.body, [{ x: 2, y: 2 }], "not yet");
  W.tick(s, 0.02, rng);
  const h = s.dino.body[0];
  assert.equal(Math.abs(h.x - 2) + Math.abs(h.y - 2), 1, "one step");
  assert.equal(W.tileAt(s, 2, 2).entity, null, "the tail left the old tile");
  // A long frame catches up: 1 s → 3 more steps (with 0.01 s carried over).
  let steps = 0;
  for (let i = 0; i < 100; i++) {
    const b = JSON.stringify(s.dino.body);
    W.tick(s, 0.01, rng);
    if (JSON.stringify(s.dino.body) !== b) steps++;
  }
  assert.equal(steps, 3, `steps in 1 s = ${steps}`);
});

test("autonomous movement never enters its body, a hedge or a crop, and never wraps", () => {
  for (const [expands, seed] of [
    [2, 1], // 3×3: gets boxed in a lot
    [4, 2],
    [6, 3],
    [9, 4], // 12×12
  ]) {
    const s = dinoGame(expands);
    W.clearFarm(s);
    const n = s.size;
    const rng = seeded(seed);
    // Scatter walls and crops (hedges outside a maze are fine for this rule test).
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rng() * n);
      const y = Math.floor(rng() * n);
      if (x === 0 && y === 0) continue;
      W.tileAt(s, x, y).entity = i % 2 ? { type: "Hedge", progress: 1 } : W.makeEntity("Bush", rng, 1);
    }
    const blocked = new Set(s.tiles.map((t, k) => (t.entity && t.entity.type !== "Grass" ? k : -1)).filter((k) => k >= 0));
    assert.equal(W.plant(s, "Dinosaur").ok, true);
    let moved = 0;
    let grew = 0;
    for (let step = 0; step < 1500; step++) {
      const prev = s.dino.body.map((p) => ({ ...p }));
      const prevKeys = new Set(prev.map((p) => p.y * n + p.x));
      const moves = W.dinoMoves(s);
      for (const m of moves) {
        assert.ok(!prevKeys.has(m.y * n + m.x), "no move into the body");
        assert.ok(!blocked.has(m.y * n + m.x), "no move into a hedge/crop");
      }
      W.tick(s, 0.1, rng);
      if (!s.dino) break;
      checkChain(s);
      const h = s.dino.body[0];
      const dist = Math.abs(h.x - prev[0].x) + Math.abs(h.y - prev[0].y);
      assert.ok(dist <= 1, `no wrap / teleport (${dist})`);
      if (dist === 1) {
        moved++;
        assert.ok(!prevKeys.has(h.y * n + h.x), "head never enters its own body");
        assert.ok(!blocked.has(h.y * n + h.x), "head never enters a hedge or crop");
        assert.equal(s.dino.dir, DIRS.find((d) => {
          const p = W.neighbor(s, prev[0].x, prev[0].y, d, false);
          return p && p.x === h.x && p.y === h.y;
        }));
      }
      if (s.dino.body.length > prev.length) grew++;
      for (const k of blocked) assert.notEqual(s.tiles[k].entity?.type, "Dinosaur");
    }
    // Tiny farms box the dinosaur in quickly (it then waits); bigger ones keep it roaming.
    assert.ok(moved > (n > 3 ? 20 : 0), `${n}×${n}: moved ${moved}`);
    assert.ok(grew >= 1, `${n}×${n}: grew ${grew}`);
  }
});

test("boxed in → the dinosaur stays put", () => {
  const s = dinoGame(4);
  W.clearFarm(s);
  // A U of hedges around (0, 0)…(0, 1) with the corner as the only exit, then close it.
  placeDino(s, [
    [0, 0],
    [1, 0],
  ]);
  W.tileAt(s, 0, 1).entity = { type: "Hedge", progress: 1 };
  W.tileAt(s, 1, 1).entity = W.makeEntity("Tree", Math.random, 1);
  W.tileAt(s, 2, 0).entity = { type: "Hedge", progress: 1 };
  assert.deepEqual(W.dinoMoves(s), []);
  const before = JSON.stringify(s.dino.body);
  for (let i = 0; i < 20; i++) W.tick(s, 0.5, seeded(i));
  assert.equal(JSON.stringify(s.dino.body), before);
  assert.equal(W.dinoStep(s, Math.random), false);
});

// ---------- apples ----------

test("apples: one per 1.5 s while a dinosaur lives, capped at size²/16", () => {
  assert.equal(appleCap(1), 1);
  assert.equal(appleCap(5), 1);
  assert.equal(appleCap(8), 4);
  assert.equal(appleCap(12), 9);
  const s = dinoGame(9); // 12×12
  W.clearFarm(s);
  const rng = seeded(9);
  for (let i = 0; i < 40; i++) W.tick(s, 0.1, rng);
  assert.equal(count(s, "Apple"), 0, "no apples without a dinosaur");
  // A boxed-in dinosaur can't eat, so apples just pile up to the cap.
  placeDino(s, [[0, 0]]);
  W.tileAt(s, 1, 0).entity = { type: "Hedge", progress: 1 };
  W.tileAt(s, 0, 1).entity = { type: "Hedge", progress: 1 };
  W.tick(s, APPLE_SPAWN_SECONDS - 0.01, rng);
  assert.equal(count(s, "Apple"), 0);
  W.tick(s, 0.02, rng);
  assert.equal(count(s, "Apple"), 1);
  for (let k = 2; k <= 12; k++) {
    W.tick(s, APPLE_SPAWN_SECONDS, rng);
    assert.equal(count(s, "Apple"), Math.min(9, k));
  }
  // Apples only replace empty ground or grass.
  assert.equal(count(s, "Hedge"), 2);
  assert.equal(count(s, "Dinosaur"), 1);
});

test("eating an apple grows the body by 1 (the tail stays)", () => {
  const s = dinoGame(4);
  W.clearFarm(s);
  placeDino(s, [
    [1, 0],
    [0, 0],
  ]);
  // Only way out: East onto the apple.
  W.tileAt(s, 1, 1).entity = { type: "Hedge", progress: 1 };
  W.tileAt(s, 2, 0).entity = { type: "Apple", progress: 1 };
  assert.deepEqual(W.dinoMoves(s), [{ dir: "East", x: 2, y: 0, eat: true }]);
  assert.equal(W.dinoStep(s, seeded(1)), true);
  assert.deepEqual(s.dino.body, [
    { x: 2, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.equal(count(s, "Apple"), 0, "eaten");
  checkChain(s);
  // A normal step afterwards keeps the length.
  W.dinoStep(s, seeded(2));
  assert.equal(s.dino.body.length, 3);
  assert.equal(W.tileAt(s, 0, 0).entity, null);
  checkChain(s);
});

// ---------- harvest ----------

test("harvest pays (segments cut off)² × level Bone and shortens / removes the dinosaur", () => {
  const s = dinoGame(4);
  W.clearFarm(s);
  const cells = [
    [4, 0],
    [3, 0],
    [2, 0],
    [1, 0],
    [0, 0],
  ];
  placeDino(s, cells);
  W.tileAt(s, 4, 4).entity = { type: "Apple", progress: 1 };
  // Tail tip: 1 segment → 1 Bone.
  s.drone.x = 0;
  assert.equal(W.harvest(s), true);
  assert.equal(s.items.Bone, 1);
  assert.equal(s.dino.body.length, 4);
  assert.equal(W.tileAt(s, 0, 0).entity, null);
  checkChain(s);
  // Middle segment (index 1 of 4): it and the 2 behind it → 3² = 9.
  s.drone.x = 3;
  W.harvest(s);
  assert.equal(s.items.Bone, 10);
  assert.deepEqual(s.dino.body, [{ x: 4, y: 0 }]);
  assert.equal(count(s, "Dinosaur"), 1);
  // Head: the whole (1-long) dinosaur; apples go with it; a new one can hatch.
  s.drone.x = 4;
  W.harvest(s);
  assert.equal(s.items.Bone, 11);
  assert.equal(s.dino, null);
  assert.equal(count(s, "Dinosaur") + count(s, "Apple"), 0);
  assert.equal(W.plant(s, "Dinosaur").ok, true);

  // Head of a 5-long dinosaur at Dinosaurs level 2: 5² × 2 = 50.
  const t = dinoGame(4);
  W.clearFarm(t);
  t.items.Bone = 1000; // level 2 costs 1,800 Gold + 1,000 Bone
  assert.equal(W.buyUnlock(t, "Dinosaurs").ok, true);
  assert.equal(t.unlocks.Dinosaurs, 2);
  assert.equal(t.items.Bone, 0);
  placeDino(t, cells);
  t.drone.x = 4;
  W.harvest(t);
  assert.equal(t.items.Bone, 50);
  assert.equal(W.boneFor(t, 3), 18);
  assert.equal(t.dino, null);
});

test("apples can't be harvested, planted on, tilled or swapped; nor can the dinosaur", async () => {
  const s = dinoGame(4);
  W.clearFarm(s);
  placeDino(s, [
    [1, 0],
    [0, 0],
  ]);
  W.tileAt(s, 1, 1).entity = { type: "Apple", progress: 1 };
  W.tileAt(s, 2, 1).entity = W.makeEntity("Bush", Math.random, 1);
  const before = snap(s);
  const tries = [
    () => W.plant(s, "Bush"),
    () => W.plant(s, "Grass"),
    () => W.till(s),
    () => W.swap(s, "North"),
    () => W.swap(s, "East"),
    () => W.swap(s, "South"),
  ];
  // On the dinosaur (0, 0) and its neighbourhood…
  for (const f of tries) assert.equal(f().ok, false);
  // …and on the apple (1, 1).
  s.drone.x = 1;
  s.drone.y = 1;
  for (const f of [...tries, () => W.harvest(s)]) {
    const r = f();
    assert.equal(r === true || r?.ok === true, false);
  }
  s.drone.x = 0;
  s.drone.y = 0;
  assert.equal(snap(s), before, "nothing changed");
  // Swapping between two ordinary tiles still works.
  s.drone.x = 2;
  s.drone.y = 1;
  assert.equal(W.swap(s, "North").ok, true);
  // Runtime: can_harvest() is false on an apple; get_entity_type names it.
  s.drone.x = 1;
  s.drone.y = 1;
  const logs = [];
  const rt = createRuntime({ getState: () => s, onLog: (e) => logs.push(e), sleep: () => Promise.resolve(), yieldFn: () => Promise.resolve() });
  await rt.run("print(get_entity_type(), can_harvest(), harvest(), measure());");
  assert.equal(logs.find((l) => l.kind === "print").text, "Apple false false null");
  assert.ok(logs.some((l) => l.kind === "warn" && /apples are for the dinosaur/.test(l.text)));
});

// ---------- maze interaction ----------

test("spawning a maze removes the dinosaur and apples; no dinosaur inside a maze; clear() removes it", () => {
  const s = dinoGame(4);
  W.clearFarm(s);
  s.drone.x = 3;
  s.drone.y = 3;
  assert.equal(W.plant(s, "Dinosaur").ok, true);
  const rng = seeded(4);
  for (let i = 0; i < 60; i++) W.tick(s, 0.1, rng);
  assert.ok(count(s, "Apple") >= 1);
  // Grow a bush where the dinosaur isn't and turn it into a maze.
  s.drone.x = 0;
  s.drone.y = 0;
  while (W.dinoSegment(s, 0, 0) >= 0 || W.droneTile(s).entity?.type === "Apple") W.tick(s, 0.1, rng);
  W.harvest(s);
  assert.equal(W.plant(s, "Bush").ok, true);
  W.droneTile(s).entity.progress = 1;
  assert.equal(W.useItem(s, "Fertilizer", 1, rng).ok, true);
  assert.ok(s.maze);
  assert.equal(s.dino, null);
  assert.equal(count(s, "Dinosaur") + count(s, "Apple"), 0);
  // Inside the maze: no dinosaur, and time passing spawns no apples.
  assert.match(W.plant(s, "Dinosaur").msg, /maze/);
  for (let i = 0; i < 40; i++) W.tick(s, 0.1, rng);
  assert.equal(count(s, "Apple"), 0);
  // After the treasure: plant again.
  const { x, y } = s.maze.treasure;
  s.drone.x = x;
  s.drone.y = y;
  W.harvest(s);
  assert.equal(s.maze, null);
  assert.equal(W.plant(s, "Dinosaur").ok, true);
  // clear() / Expand remove it.
  W.clearFarm(s);
  assert.equal(s.dino, null);
  assert.equal(count(s, "Dinosaur"), 0);
  W.plant(s, "Dinosaur");
  W.buyUnlock(s, "Expand");
  assert.equal(s.dino, null);
});

// ---------- persistence ----------

test("save/load round trip with a live dinosaur + apples is exact and keeps simulating identically", () => {
  const s = dinoGame(6); // 7×7
  W.clearFarm(s);
  s.drone.x = 3;
  s.drone.y = 3;
  assert.equal(W.plant(s, "Dinosaur").ok, true);
  const rng = seeded(11);
  for (let i = 0; i < 5000 && s.dino.body.length < 4; i++) W.tick(s, 0.07, rng);
  assert.ok(s.dino.body.length >= 3, `grew to ${s.dino.body.length}`);
  W.tick(s, 0.05, rng); // leave both timers mid-way
  assert.ok(count(s, "Apple") >= 1);
  assert.ok(s.dino.stepTimer > 0 && s.dino.appleTimer > 0);

  const data = JSON.parse(JSON.stringify(W.serialize(s)));
  const t = W.deserialize(data);
  assert.deepEqual(t.dino, s.dino, "body, dir and timers exactly");
  assert.deepEqual(types(t), types(s), "segments and apples on the same tiles");
  assert.equal(snap(t), snap(s));
  checkChain(t);
  // Both copies evolve identically from here with the same random stream.
  const r1 = seeded(99);
  const r2 = seeded(99);
  for (let i = 0; i < 100; i++) {
    W.tick(s, 0.1, r1);
    W.tick(t, 0.1, r2);
  }
  assert.equal(snap(t), snap(s));
  // And the loaded dinosaur pays out.
  const h = t.dino.body[0];
  t.drone.x = h.x;
  t.drone.y = h.y;
  const len = t.dino.body.length;
  W.harvest(t);
  assert.equal(t.items.Bone, len * len);
});

test("old saves load fine; inconsistent dinosaur data is dropped cleanly", () => {
  const s = dinoGame(4);
  W.clearFarm(s);
  placeDino(s, [
    [2, 2],
    [2, 1],
    [1, 1],
  ]);
  W.tileAt(s, 4, 4).entity = { type: "Apple", progress: 1 };
  const good = JSON.parse(JSON.stringify(W.serialize(s)));

  // A save from before this phase: no dino field, no Bone / Dinosaurs.
  const old = JSON.parse(JSON.stringify(good));
  delete old.dino;
  delete old.items.Bone;
  delete old.unlocks.Dinosaurs;
  for (const t of old.tiles) t.e = null;
  const o = W.deserialize(old);
  assert.equal(o.dino, null);
  assert.equal(o.items.Bone, 0);
  assert.equal(o.unlocks.Dinosaurs, 0);
  assert.equal(o.size, 5);

  const bad = (mutate) => {
    const d = JSON.parse(JSON.stringify(good));
    mutate(d);
    const r = W.deserialize(d);
    assert.equal(r.dino, null);
    assert.equal(count(r, "Dinosaur") + count(r, "Apple"), 0, "no stray segments/apples");
    return r;
  };
  bad((d) => delete d.dino); // segments + apple without a dinosaur
  bad((d) => (d.dino.body = [[2, 2], [1, 1]])); // not contiguous
  bad((d) => (d.dino.body = [[2, 2], [2, 1], [2, 2]])); // overlapping
  bad((d) => (d.dino.body = [[2, 2], [2, 1], [1, 1], [1, 0]])); // (1,0) isn't a Dinosaur tile
  bad((d) => (d.dino.body = [[9, 9]])); // out of bounds
  bad((d) => (d.dino.body = "x"));
  // A stray extra Dinosaur tile is stripped, the real one kept.
  const d = JSON.parse(JSON.stringify(good));
  d.tiles[0].e = { type: "Dinosaur", progress: 1 };
  d.dino.st = "nope";
  const r = W.deserialize(d);
  assert.equal(r.dino.body.length, 3);
  assert.equal(r.dino.stepTimer, 0, "bad timer → 0");
  assert.equal(count(r, "Dinosaur"), 3);
  assert.equal(count(r, "Apple"), 1);
});

// ---------- the example, end to end (demo farm) ----------

test("Bone Farm example runs end-to-end on the demo farm", async () => {
  const s = createDemoGame(); // all unlocks maxed, 8×8 full of crops, 1,440 Gold
  assert.equal(s.unlocks.Dinosaurs, 3);
  s.items.Bone = 0;
  const gold = s.items.Gold;
  let t = 0;
  const rng = seeded(42);
  const logs = [];
  let hatched = 0;
  let alive = false;
  let maxLen = 0;
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    onChange: () => {
      if (s.dino && !alive) hatched++;
      alive = !!s.dino;
    },
    now: () => t,
    rng,
    yieldFn: () => new Promise((r) => setImmediate(r)),
    sleep: async (ms) => {
      let left = ms;
      while (left > 0) {
        const step = Math.min(100, left);
        W.tick(s, step / 1000, rng);
        if (s.dino) maxLen = Math.max(maxLen, s.dino.body.length);
        t += step;
        left -= step;
      }
      await new Promise((r) => setImmediate(r));
    },
  });
  const code = EXAMPLES.find((e) => e.id === "dinosaur").code;
  let finished = null;
  rt.run(code).then((r) => (finished = r));
  while (t < 600_000 && finished === null && hatched < 3) {
    await new Promise((r) => setImmediate(r));
  }
  rt.stop();
  await new Promise((r) => setImmediate(r));
  const bones = logs.filter((l) => l.text.startsWith("Bone:")).map((l) => Number(l.text.slice(5)));
  assert.ok(bones.length >= 2, JSON.stringify(logs.slice(-5)));
  assert.ok(bones.every((b, i) => i === 0 || b > bones[i - 1]), `Bone grows: ${bones}`);
  assert.equal(bones.at(-1), s.items.Bone);
  assert.ok(hatched >= 3, `dinosaurs hatched: ${hatched}`);
  assert.ok(maxLen >= 3, `the dinosaur grew to ${maxLen}`);
  assert.equal(s.items.Gold, gold - 10 * hatched);
  assert.ok(!logs.some((l) => l.kind === "error"), JSON.stringify(logs.filter((l) => l.kind === "error")));
});

// ---------- presentation ----------

test("info strip names the dinosaur segment and apples via the tile-info path", () => {
  const stats = { running: true, ticks: 1, actions: 0, elapsed: 0, lastMeasure: null };
  const s = dinoGame(4);
  W.clearFarm(s);
  placeDino(s, [
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  W.tileAt(s, 0, 1).entity = { type: "Apple", progress: 1 };
  const what = () => stripFields(s, stats, "running", false).what;
  assert.equal(what(), "🦖 Dinosaur head 1/3 / Grassland");
  s.drone.x = 1;
  assert.equal(what(), "🦖 Dinosaur 2/3 / Grassland");
  s.drone.x = 2;
  assert.equal(what(), "🦖 Dinosaur tail 3/3 / Grassland");
  s.drone.x = 0;
  s.drone.y = 1;
  assert.equal(what(), "🍎 Apple / Grassland");
});

test("3D: dinosaur segment + apple models; the chain follows the body", () => {
  const kit = createModelKit();
  const box = (o) => {
    o.updateMatrixWorld(true);
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      ["x", "y", "z"].forEach((k, i) => {
        b.min[i] = Math.min(b.min[i], bb.min[k]);
        b.max[i] = Math.max(b.max[i], bb.max[k]);
      });
    });
    return b;
  };
  for (const part of ["head", "body", "legs", "tail"]) {
    const seg = kit.buildDinoSegment(part);
    assert.ok(countTriangles(seg) > 50, `${part} has geometry`);
    const b = box(seg);
    assert.ok(b.max[0] - b.min[0] > 0.35 && b.max[0] - b.min[0] < 1, `${part} fits its tile`);
    assert.ok(b.max[1] > 0.35 && b.max[1] < 0.8, `${part} height`);
    if (part !== "head") assert.ok(b.max[2] > 0.55, `${part} bridges to the segment ahead`);
  }
  const head = box(kit.buildDinoSegment("head"));
  assert.ok(head.max[2] > 0.3, "snout points forward (+z)");
  const apple = kit.buildEntity({ type: "Apple", progress: 1 }, 0);
  assert.ok(countTriangles(apple) > 50);
  const ab = box(apple);
  assert.ok(ab.max[0] - ab.min[0] < 0.45, "apple is small");
  assert.ok(kit.buildEntity({ type: "Dinosaur", progress: 1 }, 0), "a lone segment model exists");
  const seg = kit.buildDinoSegment("tail");
  const g = seg.children[0].geometry;
  kit.setDinoPart(seg, "body");
  assert.notEqual(seg.children[0].geometry, g);
  kit.dispose();

  assert.deepEqual([0, 1, 2, 3, 4].map((i) => dinoPartFor(i, 5)), ["head", "legs", "body", "legs", "tail"]);
  assert.equal(dinoPartFor(0, 1), "head");
  const body = [
    { x: 1, y: 1 },
    { x: 1, y: 0 },
  ];
  assert.equal(dinoYaw(body, 0, "North"), Math.PI, "heading North = away from the camera (−z)");
  assert.equal(dinoYaw([{ x: 2, y: 0 }, { x: 1, y: 0 }], 1, "East"), Math.PI / 2);
  assert.equal(dinoYaw([{ x: 0, y: 0 }], 0, "South"), 0);

  const s = dinoGame(4);
  W.clearFarm(s);
  placeDino(s, [
    [2, 2],
    [2, 1],
    [1, 1],
  ]);
  W.tileAt(s, 4, 4).entity = { type: "Apple", progress: 1 };
  W.tileAt(s, 3, 3).entity = W.makeEntity("Bush", Math.random, 1);
  const fs = new FarmScene();
  fs.sync(s);
  assert.equal(fs.dinoSegs.length, 3);
  assert.equal(fs.tiles.filter((r) => r.model).length, 2, "apple + bush get tile models; dinosaur tiles don't");
  assert.equal(fs.dinoSegs[0].obj.userData.part, "head");
  assert.equal(fs.dinoSegs[2].obj.userData.part, "tail");
  // A step: segment targets follow the body, positions glide there.
  W.tileAt(s, 2, 3).entity = { type: "Apple", progress: 1 };
  W.tileAt(s, 3, 2).entity = { type: "Hedge", progress: 1 };
  W.tileAt(s, 1, 2).entity = { type: "Hedge", progress: 1 };
  assert.equal(W.dinoStep(s, () => 0), true); // only move: North onto the apple
  fs.sync(s);
  assert.equal(fs.dinoSegs.length, 4, "grew");
  assert.equal(fs.dinoSegs[2].obj.userData.part, "body", "old tail became body");
  assert.equal(fs.dinoSegs[3].obj.userData.part, "tail");
  for (let i = 0; i < 60; i++) fs.update(1 / 30);
  s.dino.body.forEach((p, i) => {
    const seg = fs.dinoSegs[i];
    assert.ok(Math.abs(seg.obj.position.x - (p.x - 2)) < 1e-3 && Math.abs(seg.obj.position.z - (2 - p.y)) < 1e-3, `segment ${i} on its tile`);
  });
  // Harvest the head: every segment pops away.
  s.drone.x = 2;
  s.drone.y = 3;
  W.harvest(s);
  fs.sync(s);
  assert.equal(fs.dinoSegs.length, 0);
  assert.ok(fs.dying.length >= 4);
  fs.dispose();
});
