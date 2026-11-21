// Mazes (v2 phase 1): generation, spawn trigger, movement, measure(), gold,
// persistence, the maze-runner example, info strip and 3D models.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { generateMaze, pathDistances, treasureDirection } from "./maze.js";
import { UNLOCK_BY_ID, FUTURE_UNLOCKS, UNLOCKS, WORLD_SIZES, Items, Entities, ITEM_ICONS } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { EXAMPLES } from "./examples.js";
import { FARMER_LIB } from "./farmerLib.js";
import { stripFields } from "./statusStrip.js";
import { createModelKit, countTriangles } from "./board3d/models.js";
import { FarmScene } from "./board3d/FarmScene.js";

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

/** Path tiles, number of path-to-path adjacencies and BFS reachability. */
function analyse(n, walls, sx, sy) {
  let nodes = 0;
  let edges = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (walls[y * n + x]) continue;
      nodes++;
      if (x + 1 < n && !walls[y * n + x + 1]) edges++;
      if (y + 1 < n && !walls[(y + 1) * n + x]) edges++;
    }
  }
  const dist = pathDistances(n, walls, sx, sy);
  const reached = dist.filter((d) => d >= 0).length;
  return { nodes, edges, reached, dist };
}

/** A rich game with everything up to Mazes unlocked, expanded to `expands` levels. */
function mazeGame(expands = 4) {
  const s = W.createGame();
  for (const k of Object.keys(s.items)) s.items[k] = 1_000_000;
  for (const id of ["Plant", "Senses", "Carrots", "Pumpkins", "Fertilizer", "Cactus", "Mazes"]) {
    assert.equal(W.buyUnlock(s, id).ok, true, id);
  }
  for (let i = 0; i < expands; i++) assert.equal(W.buyUnlock(s, "Expand").ok, true);
  return s;
}

/** Grow a bush under the drone to full size. */
function grownBush(s) {
  W.harvest(s);
  assert.equal(W.plant(s, "Bush").ok, true);
  for (let i = 0; i < 100; i++) W.tick(s, 0.1);
  assert.equal(W.isGrown(W.droneTile(s).entity), true);
}

function spawn(s, seed = 7) {
  grownBush(s);
  const f = s.items.Fertilizer;
  assert.equal(W.useItem(s, "Fertilizer", 1, seeded(seed)).ok, true);
  assert.equal(s.items.Fertilizer, f - 1);
  assert.ok(s.maze);
}

// ---------- unlock & content ----------

test("Mazes is a real unlock after Cactus; Megafarm stays future", () => {
  const ids = UNLOCKS.map((u) => u.id);
  assert.equal(ids.indexOf("Mazes"), ids.indexOf("Cactus") + 1);
  assert.equal(UNLOCK_BY_ID.Mazes.requires, "Cactus");
  assert.deepEqual(
    FUTURE_UNLOCKS.map((u) => u.id),
    ["Megafarm"], // Dinosaurs became a real unlock in v2 phase 2 (BRIEF7)
  );
  assert.equal(Items.Gold, "Gold");
  assert.equal(ITEM_ICONS.Gold, "🪙");
  assert.equal(Entities.Hedge, "Hedge");
  assert.equal(Entities.Treasure, "Treasure");
  assert.match(FARMER_LIB, /Gold: "Gold";/);
  assert.match(FARMER_LIB, /Hedge: "Hedge";/);
  assert.match(FARMER_LIB, /Treasure: "Treasure";/);
  assert.match(FARMER_LIB, /Mazes: "Mazes";/);

  const s = W.createGame();
  for (const k of Object.keys(s.items)) s.items[k] = 1_000_000;
  assert.equal(s.items.Gold, 1_000_000, "new games have a Gold slot");
  assert.equal(W.buyUnlock(s, "Mazes").locked, "Cactus");
  assert.equal(W.plant(s, "Hedge").ok, false, "maze entities can't be planted");
  assert.equal(W.plant(s, "Treasure").ok, false);
});

// ---------- generation ----------

test("generated mazes are perfect at every farm size and start", () => {
  for (const n of WORLD_SIZES) {
    const starts = [
      [0, 0],
      [n - 1, n - 1],
      [Math.floor(n / 2), Math.floor(n / 3)],
      [n - 1, 0],
    ];
    for (const [sx, sy] of starts) {
      for (const seed of [1, 2, 3]) {
        const { walls, treasure } = generateMaze(n, sx, sy, seeded(seed * 100 + n));
        assert.equal(walls.length, n * n);
        assert.equal(walls[sy * n + sx], false, `start is a path tile (${n} @${sx},${sy})`);
        const { nodes, edges, reached, dist } = analyse(n, walls, sx, sy);
        assert.equal(reached, nodes, `connected (${n} @${sx},${sy})`);
        assert.equal(edges, nodes - 1, `acyclic (${n} @${sx},${sy})`);
        const far = Math.max(...dist);
        assert.equal(dist[treasure.y * n + treasure.x], far, "treasure on the farthest path tile");
        if (n >= 4) assert.ok(nodes >= 4, `${n}×${n} maze has some room`);
      }
    }
  }
});

test("bigger farms make bigger mazes; same seed → same maze", () => {
  const a = generateMaze(12, 0, 0, seeded(5));
  const b = generateMaze(12, 0, 0, seeded(5));
  assert.deepEqual(a, b);
  const { nodes } = analyse(12, a.walls, 0, 0);
  assert.ok(nodes > 50, `12×12 path tiles = ${nodes}`);
  assert.ok(a.treasure.x !== 0 || a.treasure.y !== 0);
});

// ---------- spawn trigger ----------

test("fertilizer on a grown bush with Mazes unlocked spawns a maze", () => {
  const s = mazeGame(4); // 5×5
  W.moveDrone(s, "East");
  W.moveDrone(s, "North"); // (1, 1)
  spawn(s);
  const n = s.size;
  const walls = s.tiles.map((t) => t.entity?.type === "Hedge");
  const { nodes, edges, reached } = analyse(n, walls, 1, 1);
  assert.equal(reached, nodes);
  assert.equal(edges, nodes - 1);
  assert.deepEqual([s.drone.x, s.drone.y], [1, 1], "drone stays on its cell");
  assert.equal(W.droneTile(s).entity, null, "drone's tile is an empty path tile");
  const { x, y } = s.maze.treasure;
  assert.equal(W.tileAt(s, x, y).entity.type, "Treasure");
  assert.equal(s.tiles.filter((t) => t.entity?.type === "Treasure").length, 1);
  assert.ok(s.tiles.every((t) => t.ground === "Grassland" && t.water === 0));
  assert.ok(s.tiles.every((t) => !t.entity || t.entity.type === "Hedge" || t.entity.type === "Treasure"));
});

test("no maze without Mazes, a grown bush or fertilizer — and no fertilizer is used", () => {
  // Mazes locked: grown bush → existing behaviour ("Nothing growing here").
  const s = mazeGame(2);
  s.unlocks.Mazes = 0;
  grownBush(s);
  const f = s.items.Fertilizer;
  assert.equal(W.useItem(s, "Fertilizer").ok, false);
  assert.equal(s.items.Fertilizer, f);
  assert.equal(s.maze, null);
  assert.equal(W.droneTile(s).entity.type, "Bush");

  // Mazes unlocked, but the drone stands on grown grass / a grown tree / nothing.
  const g = mazeGame(2);
  for (let i = 0; i < 30; i++) W.tick(g, 0.1);
  assert.equal(W.droneTile(g).entity.type, "Grass");
  assert.equal(W.isGrown(W.droneTile(g).entity), true);
  const before = g.items.Fertilizer;
  assert.equal(W.useItem(g, "Fertilizer").ok, false);
  W.harvest(g);
  assert.equal(W.useItem(g, "Fertilizer").ok, false); // empty tile
  W.plant(g, "Tree");
  for (let i = 0; i < 200; i++) W.tick(g, 0.1);
  assert.equal(W.useItem(g, "Fertilizer").ok, false);
  assert.equal(g.items.Fertilizer, before);
  assert.equal(g.maze, null);

  // Unripe bush: fertilizer keeps speeding growth up (consumed), no maze.
  const u = mazeGame(2);
  W.harvest(u);
  W.plant(u, "Bush");
  const p0 = W.droneTile(u).entity.progress;
  assert.equal(W.useItem(u, "Fertilizer").ok, true);
  assert.ok(W.droneTile(u).entity.progress > p0);
  assert.equal(u.maze, null);

  // Grown bush, Mazes unlocked, but no fertilizer.
  const z = mazeGame(2);
  grownBush(z);
  z.items.Fertilizer = 0;
  assert.equal(W.useItem(z, "Fertilizer").ok, false);
  assert.equal(z.maze, null);
  // Fertilizer unlock missing: still locked as before.
  z.items.Fertilizer = 5;
  z.unlocks.Fertilizer = 0;
  assert.equal(W.useItem(z, "Fertilizer").locked, "Fertilizer");
  assert.equal(z.items.Fertilizer, 5);
  assert.equal(z.maze, null);
});

// ---------- movement / measure ----------

test("hedges block move(); the maze edge does not wrap; can_move agrees", () => {
  const s = mazeGame(5); // 6×6
  spawn(s, 11);
  const n = s.size;
  let blocked = 0;
  let moved = 0;
  // Random walk: every attempt must match the walls exactly.
  const r = seeded(3);
  for (let i = 0; i < 400; i++) {
    const dir = DIRS[Math.floor(r() * 4)];
    const { x, y } = s.drone;
    const nb = W.neighbor(s, x, y, dir, false);
    const open = !!nb && W.tileAt(s, nb.x, nb.y).entity?.type !== "Hedge";
    assert.equal(W.canMove(s, dir), open);
    assert.equal(W.moveDrone(s, dir), open);
    if (open) {
      moved++;
      assert.deepEqual([s.drone.x, s.drone.y], [nb.x, nb.y]);
    } else {
      blocked++;
      assert.deepEqual([s.drone.x, s.drone.y], [x, y], "drone stays");
    }
    assert.notEqual(W.droneTile(s).entity?.type, "Hedge");
    assert.ok(s.drone.x >= 0 && s.drone.x < n && s.drone.y >= 0 && s.drone.y < n);
  }
  assert.ok(blocked > 0 && moved > 0);

  // Edge: from (0,0) West/South would wrap outside a maze; here it's a wall.
  const e = mazeGame(4);
  spawn(e, 2);
  assert.deepEqual([e.drone.x, e.drone.y], [0, 0]);
  assert.equal(W.moveDrone(e, "West"), false);
  assert.equal(W.moveDrone(e, "South"), false);
  assert.deepEqual([e.drone.x, e.drone.y], [0, 0]);
});

test("measure(): treasure direction in a maze (dominant axis), unchanged outside", () => {
  assert.equal(treasureDirection(0, 0, 4, 1), "East");
  assert.equal(treasureDirection(4, 1, 0, 0), "West");
  assert.equal(treasureDirection(0, 0, 1, 4), "North");
  assert.equal(treasureDirection(1, 4, 0, 0), "South");
  assert.equal(treasureDirection(0, 0, 3, 3), "East", "ties go to East/West");
  assert.equal(treasureDirection(3, 3, 0, 0), "West");
  assert.equal(treasureDirection(2, 2, 2, 2), null);

  const s = mazeGame(6); // 7×7
  spawn(s, 4);
  const t = s.maze.treasure;
  for (let y = 0; y < s.size; y++) {
    for (let x = 0; x < s.size; x++) {
      if (W.tileAt(s, x, y).entity?.type === "Hedge") continue;
      s.drone.x = x;
      s.drone.y = y;
      assert.equal(W.measure(s), treasureDirection(x, y, t.x, t.y));
      for (const d of DIRS) {
        const nb = W.neighbor(s, x, y, d, false);
        assert.equal(W.measure(s, d), nb ? treasureDirection(nb.x, nb.y, t.x, t.y) : null);
      }
    }
  }
  s.drone.x = t.x;
  s.drone.y = t.y;
  assert.equal(W.measure(s), null, "null on the treasure");

  // Outside a maze: sunflower petals as before.
  const o = mazeGame(1);
  assert.equal(W.buyUnlock(o, "Sunflowers").ok, true);
  W.harvest(o);
  W.till(o);
  W.plant(o, "Sunflower", () => 0.5);
  assert.equal(W.measure(o), W.droneTile(o).entity.petals);
  W.moveDrone(o, "East");
  assert.equal(W.measure(o), null);
  assert.equal(W.measure(o, "West"), W.tileAt(o, 0, 0).entity.petals);
  assert.equal(W.canMove(o, "West"), true, "open field: always movable (wraps)");
});

// ---------- goal & interactions ----------

test("harvesting the treasure pays Gold (size² × level) and restores grassland", () => {
  const s = mazeGame(4); // 5×5
  spawn(s, 9);
  for (let i = 0; i < 50; i++) W.tick(s, 0.1);
  assert.ok(
    s.tiles.every((t) => !t.entity || t.entity.type === "Hedge" || t.entity.type === "Treasure"),
    "no grass grows on maze paths",
  );
  const gold = s.items.Gold;
  // Harvest on an empty path tile does nothing.
  assert.equal(W.harvest(s), false);
  assert.equal(s.items.Gold, gold);
  s.drone.x = s.maze.treasure.x;
  s.drone.y = s.maze.treasure.y;
  const pos = [s.drone.x, s.drone.y];
  assert.equal(W.harvest(s), true);
  assert.equal(s.items.Gold, gold + 25);
  assert.equal(W.mazeGold(s), 25);
  assert.equal(s.maze, null);
  assert.deepEqual([s.drone.x, s.drone.y], pos);
  assert.ok(s.tiles.every((t) => t.entity === null && t.ground === "Grassland"));
  // Back to a normal farm: grass regrows, movement wraps again.
  for (let i = 0; i < 10; i++) W.tick(s, 0.1);
  assert.ok(s.tiles.every((t) => t.entity?.type === "Grass"));

  // Level 2 doubles it.
  const l2 = mazeGame(4);
  assert.equal(W.buyUnlock(l2, "Mazes").ok, true);
  spawn(l2, 9);
  l2.drone.x = l2.maze.treasure.x;
  l2.drone.y = l2.maze.treasure.y;
  const g2 = l2.items.Gold;
  W.harvest(l2);
  assert.equal(l2.items.Gold, g2 + 50);
});

test("plant / till / swap / trade fail cleanly inside a maze", () => {
  const s = mazeGame(4);
  spawn(s, 5);
  const snap = JSON.stringify(W.serialize(s));
  assert.equal(W.plant(s, "Bush").ok, false);
  assert.equal(W.till(s).ok, false);
  for (const d of DIRS) assert.equal(W.swap(s, d).ok, false);
  assert.equal(W.trade(s, "Fertilizer").ok, false);
  assert.equal(W.trade(s, "Water").ok, false);
  assert.equal(W.useItem(s, "Fertilizer").ok, false, "nothing growing on a path tile");
  assert.equal(JSON.stringify(W.serialize(s)), snap, "no state change");
});

test("clear() and Expand remove an active maze", () => {
  const s = mazeGame(4);
  spawn(s);
  W.clearFarm(s);
  assert.equal(s.maze, null);
  assert.ok(s.tiles.every((t) => t.entity === null && t.ground === "Grassland"));
  assert.equal(W.moveDrone(s, "West"), true, "wraps again");

  const e = mazeGame(4);
  spawn(e);
  assert.equal(W.buyUnlock(e, "Expand").ok, true);
  assert.equal(e.maze, null);
  assert.ok(e.tiles.every((t) => t.entity === null));
});

// ---------- persistence ----------

test("save/load round-trip keeps an active maze exactly", () => {
  const s = mazeGame(7); // 8×8
  W.moveDrone(s, "East");
  spawn(s, 21);
  // Walk somewhere first so the drone isn't on its start cell.
  for (const d of DIRS) if (W.moveDrone(s, d)) break;
  const copy = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  assert.deepEqual(copy.maze, s.maze);
  assert.deepEqual(copy.drone, { x: s.drone.x, y: s.drone.y, flips: 0 });
  assert.deepEqual(
    copy.tiles.map((t) => t.entity?.type ?? null),
    s.tiles.map((t) => t.entity?.type ?? null),
  );
  assert.deepEqual(copy.items, s.items);
  // The loaded maze behaves like the original.
  for (const d of DIRS) assert.equal(W.canMove(copy, d), W.canMove(s, d));
  assert.equal(W.measure(copy), W.measure(s));
  copy.drone.x = copy.maze.treasure.x;
  copy.drone.y = copy.maze.treasure.y;
  const g = copy.items.Gold;
  assert.equal(W.harvest(copy), true);
  assert.equal(copy.items.Gold, g + 64);
});

test("old saves (no maze / Gold / Mazes fields) load fine; a broken maze is dropped", () => {
  const s = mazeGame(2);
  const data = JSON.parse(JSON.stringify(W.serialize(s)));
  delete data.maze;
  delete data.items.Gold;
  delete data.unlocks.Mazes;
  const old = W.deserialize(data);
  assert.equal(old.maze, null);
  assert.equal(old.items.Gold, 0);
  assert.equal(old.unlocks.Mazes, 0);
  assert.equal(old.size, 3);

  // Maze field pointing at a tile without the treasure → no maze, walls stripped.
  const m = mazeGame(4);
  spawn(m, 8);
  const bad = JSON.parse(JSON.stringify(W.serialize(m)));
  bad.maze = { tx: m.drone.x, ty: m.drone.y };
  const fixed = W.deserialize(bad);
  assert.equal(fixed.maze, null);
  assert.ok(fixed.tiles.every((t) => !t.entity || (t.entity.type !== "Hedge" && t.entity.type !== "Treasure")));
  // Maze entities without a maze field → stripped too.
  const noField = JSON.parse(JSON.stringify(W.serialize(m)));
  delete noField.maze;
  assert.ok(W.deserialize(noField).tiles.every((t) => !t.entity));
});

// ---------- the example, end to end ----------

test("Maze Runner example spawns and solves mazes end-to-end", async () => {
  const s = W.createGame();
  for (const k of Object.keys(s.items)) s.items[k] = 1_000_000;
  for (const id of ["Plant", "Senses", "Carrots", "Pumpkins", "Fertilizer", "Cactus", "Mazes"]) W.buyUnlock(s, id);
  for (let i = 0; i < 5; i++) W.buyUnlock(s, "Expand"); // 6×6
  s.items.Gold = 0;
  s.items.Fertilizer = 0; // the example trades for it
  let t = 0;
  const rng = seeded(42);
  const logs = [];
  let mazes = 0;
  let sawMaze = false;
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    onChange: () => {
      if (s.maze && !sawMaze) mazes++;
      sawMaze = !!s.maze;
    },
    now: () => t,
    rng,
    yieldFn: () => new Promise((r) => setImmediate(r)),
    sleep: async (ms) => {
      let left = ms;
      while (left > 0) {
        const step = Math.min(100, left);
        W.tick(s, step / 1000, rng);
        t += step;
        left -= step;
      }
      await new Promise((r) => setImmediate(r));
    },
  });
  const code = EXAMPLES.find((e) => e.id === "maze").code;
  let finished = null;
  rt.run(code).then((r) => (finished = r));
  while (t < 1200_000 && finished === null && logs.filter((l) => l.text.startsWith("Gold:")).length < 2) {
    await new Promise((r) => setImmediate(r));
  }
  rt.stop();
  await new Promise((r) => setImmediate(r));
  const golds = logs.filter((l) => l.text.startsWith("Gold:"));
  assert.ok(golds.length >= 2, JSON.stringify(logs.slice(-5)));
  assert.equal(golds[0].text, "Gold: 36");
  assert.equal(golds[1].text, "Gold: 72");
  assert.ok(mazes >= 2, `mazes spawned: ${mazes}`);
  assert.ok(!logs.some((l) => l.kind === "error"), JSON.stringify(logs.filter((l) => l.kind === "error")));
});

test("runtime: can_move and measure see the maze", async () => {
  const s = mazeGame(4);
  spawn(s, 3);
  const logs = [];
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    sleep: () => Promise.resolve(),
    yieldFn: () => Promise.resolve(),
  });
  await rt.run("print(can_move(North), can_move(East), can_move(South), can_move(West), measure());");
  const expect = [...DIRS.map((d) => W.canMove(s, d)), W.measure(s)].map(String).join(" ");
  assert.equal(logs[0].text, expect);
  assert.match(logs[0].text, /false/, "the edge at (0,0) is a wall");
});

// ---------- presentation ----------

test("info strip names Hedge / Treasure on and around the drone in a maze", () => {
  const stats = { running: true, ticks: 1, actions: 0, elapsed: 0, lastMeasure: null };
  const s = mazeGame(4);
  spawn(s, 6);
  const f = stripFields(s, stats, "running", false);
  assert.match(f.what, /^Grassland · /);
  assert.match(f.what, /🟩 Hedge (N|E|S|W)/);
  assert.match(f.what, /Hedge[^·]*\bS\b/, "the South edge counts as a wall at y = 0");
  s.drone.x = s.maze.treasure.x;
  s.drone.y = s.maze.treasure.y;
  assert.match(stripFields(s, stats, "running", false).what, /^💰 Treasure \/ Grassland · /);
  // Next to the treasure: it is named too.
  const t = s.maze.treasure;
  const nb = DIRS.map((d) => W.neighbor(s, t.x, t.y, d, false)).find(
    (p) => p && W.tileAt(s, p.x, p.y).entity?.type !== "Hedge",
  );
  s.drone.x = nb.x;
  s.drone.y = nb.y;
  assert.match(stripFields(s, stats, "running", false).what, /💰 Treasure [NESW]/);
  // Outside a maze nothing changes.
  W.clearFarm(s);
  W.tick(s, 1);
  assert.equal(stripFields(s, stats, "running", false).what.includes("·"), false);
});

test("3D: hedge and treasure chest models; a maze syncs onto the board", () => {
  const kit = createModelKit();
  const hedge = kit.buildEntity({ type: "Hedge", progress: 1 }, 0);
  const chest = kit.buildEntity({ type: "Treasure", progress: 1 }, 0);
  for (const [name, obj] of [
    ["Hedge", hedge],
    ["Treasure", chest],
  ]) {
    assert.ok(obj, name);
    assert.ok(countTriangles(obj) > 10, `${name} has geometry`);
  }
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
  const hb = box(hedge);
  assert.ok(hb.max[0] - hb.min[0] > 0.9 && hb.max[0] - hb.min[0] <= 1.1, "hedge fills the tile");
  assert.ok(hb.max[1] > 0.5, "hedge is tall enough to read as a wall");
  const cb = box(chest);
  assert.ok(cb.max[0] - cb.min[0] > 0.55 && cb.max[0] - cb.min[0] < 1.05, "chest reads at tile size (and stays on its tile)");
  kit.dispose();

  const s = mazeGame(4);
  spawn(s, 6);
  const fs = new FarmScene();
  fs.sync(s);
  const hedges = s.tiles.filter((t) => t.entity?.type === "Hedge").length;
  const shown = fs.tiles.filter((r) => r.model).length;
  assert.equal(shown, hedges + 1, "every hedge plus the chest has a model");
  fs.dispose?.();
});
