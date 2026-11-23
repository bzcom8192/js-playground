// The progression curve (BRIEF21 item 3): the whole price list, what must not move
// with it (order, requirements, level counts, tick counting), and that the curve
// holds together. The old → new table is in RESULT21.md. BRIEF22 removed Mazes
// and Dinosaurs and re-chained / re-priced Megafarm (RESULT22.md).
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "./constants.js";
import * as W from "./world.js";
import { BONUS_FACTOR, CONTRACT_ITEMS } from "./contracts.js";
import { EXAMPLES } from "./examples.js";
import { mulberry32 } from "./rng.js";
import { ACTION_TICKS, FLIP_TICKS, SENSE_TICKS, createRuntime } from "./runtime.js";

const costs = (id) => Array.from({ length: C.UNLOCK_BY_ID[id].maxLevel }, (_, l) => C.UNLOCK_BY_ID[id].cost(l));

test("price list: every level of every upgrade", () => {
  assert.deepEqual(Object.fromEntries(C.UNLOCKS.map((u) => [u.id, costs(u.id)])), {
    Speed: [{ Hay: 24 }, { Hay: 90 }, { Hay: 280 }, { Hay: 800 }, { Hay: 2200 }],
    Expand: [
      { Hay: 45 },
      { Wood: 36 },
      { Wood: 70, Carrot: 40 },
      { Wood: 140, Carrot: 90 },
      { Wood: 260, Carrot: 180 },
      { Wood: 480, Pumpkin: 220 },
      { Wood: 850, Pumpkin: 650 },
      { Wood: 1600, Pumpkin: 1800 },
      { Wood: 3200, Pumpkin: 4200, Cactus: 360 },
    ],
    Plant: [{ Hay: 16 }],
    Senses: [{ Hay: 28 }],
    Grass: [{ Hay: 60 }, { Hay: 170 }, { Hay: 480 }, { Hay: 1300 }, { Hay: 3500 }],
    Carrots: [{ Wood: 70 }, { Wood: 160, Carrot: 90 }, { Wood: 420, Carrot: 260 }, { Wood: 1150, Carrot: 700 }, { Wood: 3000, Carrot: 1900 }],
    Trees: [{ Hay: 150, Wood: 90 }, { Wood: 320, Carrot: 80 }, { Wood: 900, Carrot: 220 }, { Wood: 2400, Carrot: 600 }, { Wood: 6500, Carrot: 1600 }],
    Watering: [{ Wood: 130, Carrot: 70 }, { Wood: 380, Carrot: 240 }, { Wood: 1200, Carrot: 800 }],
    Pumpkins: [{ Carrot: 260 }, { Carrot: 420, Pumpkin: 160 }, { Carrot: 1100, Pumpkin: 550 }, { Carrot: 3000, Pumpkin: 1700 }, { Carrot: 8000, Pumpkin: 5200 }],
    Sunflowers: [{ Pumpkin: 140 }],
    Fertilizer: [{ Pumpkin: 180 }],
    Rice: [{ Pumpkin: 1800, Carrot: 800 }, { Pumpkin: 4200, Gold: 260 }],
    Cactus: [{ Pumpkin: 320 }, { Pumpkin: 900, Cactus: 160 }, { Pumpkin: 2600, Cactus: 700 }],
    Megafarm: [{ Pumpkin: 40000, Cactus: 30000 }],
  });
});

test("the retune moved numbers only: order, requirements, level counts, farm sizes and tick costs are as before (BRIEF22: minus Mazes / Dinosaurs)", () => {
  assert.deepEqual(
    C.UNLOCKS.map((u) => `${u.id}:${u.requires}:${u.maxLevel}`),
    ["Speed:null:5", "Expand:null:9", "Plant:null:1", "Senses:null:1", "Grass:Plant:5", "Carrots:Plant:5", "Trees:Carrots:5", "Watering:Carrots:3", "Pumpkins:Carrots:5",
      "Sunflowers:Pumpkins:1", "Fertilizer:Pumpkins:1", "Rice:Pumpkins:2", "Cactus:Pumpkins:3", "Megafarm:Cactus:1"],
  );
  assert.deepEqual(C.WORLD_SIZES, [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]);
  assert.deepEqual([ACTION_TICKS, FLIP_TICKS, SENSE_TICKS], [200, 600, 1]);
});

test("curve: every level costs more than the last and no level pays less; every price can be earned by then", () => {
  for (const u of C.UNLOCKS) {
    const list = costs(u.id);
    for (let l = 1; l < list.length; l++) {
      for (const [item, n] of Object.entries(list[l])) if (item in list[l - 1]) assert.ok(n > list[l - 1][item], `${u.id} ${l + 1}: ${item}`);
    }
  }
  for (const t of [C.HAY_YIELD, C.BUSH_YIELD, C.TREE_YIELD, C.CARROT_YIELD, C.PUMPKIN_FACTOR, C.CACTUS_FACTOR, C.RICE_YIELD]) {
    for (let l = 1; l < t.length; l++) assert.ok(t[l] >= t[l - 1], String(t));
    assert.ok(t.at(-1) > t[1]);
    assert.deepEqual([C.byLevel(t, -1), C.byLevel(t, 99)], [t[0], t.at(-1)]);
  }
  for (const [table, id] of [[C.HAY_YIELD, "Grass"], [C.TREE_YIELD, "Trees"], [C.CARROT_YIELD, "Carrots"], [C.PUMPKIN_FACTOR, "Pumpkins"], [C.CACTUS_FACTOR, "Cactus"], [C.RICE_YIELD, "Rice"]]) {
    assert.equal(table.length, C.UNLOCK_BY_ID[id].maxLevel + 1, id);
  }
  // Level 1 of an upgrade is paid in what its requirements (and no later upgrade) give.
  const makes = { Hay: null, Wood: "Plant", Carrot: "Carrots", Pumpkin: "Pumpkins", Cactus: "Cactus", Gold: "Rice" };
  const needs = (id, seen = new Set()) => {
    for (let r = C.UNLOCK_BY_ID[id].requires; r; r = C.UNLOCK_BY_ID[r].requires) seen.add(r);
    return seen;
  };
  for (const u of C.UNLOCKS) {
    const have = needs(u.id);
    const first = u.cost(0);
    for (const item of Object.keys(first)) assert.ok(makes[item] === null || have.has(makes[item]), `${u.id} asks for ${item}`);
  }
});

test("economy: seeds pay back, buying beats nothing for free, contracts beat the market", () => {
  // The smallest fused block pays more pumpkins than it took, and a sorted 3×3 bench more cacti than pumpkins.
  assert.ok(8 * C.PUMPKIN_FACTOR[1] > 4 && 81 * C.CACTUS_FACTOR[1] > 9 * C.ENTITY_INFO.Cactus.cost.Pumpkin);
  assert.ok(C.RICE_YIELD[1] * C.RICE_GOLD > C.ENTITY_INFO.Rice.cost.Carrot / 2);
  assert.equal(BONUS_FACTOR, 2);
  // A rice contract pays more (in Pumpkins, 4 to the Gold at the table's own rates) than selling it.
  assert.ok((CONTRACT_ITEMS.Rice.value * BONUS_FACTOR) / 4 > C.RICE_GOLD);
  // Gold is still made (selling Rice) and still spent (Flooded Paddy level 2), so it stays.
  assert.deepEqual([W.TRADES.Rice.gives, C.UNLOCK_BY_ID.Rice.cost(1).Gold], [{ Gold: C.RICE_GOLD }, 260]);
});

/** Run `code` on `s` in virtual time until `done()` → seconds of farm time. */
async function play(s, code, done, rng) {
  let t = 0;
  let grid = 0;
  let seq = 0;
  let timers = [];
  const sleep = (ms) => new Promise((r) => timers.push({ at: t + Math.max(0, ms), seq: seq++, r }));
  const errors = [];
  const rt = createRuntime({ getState: () => s, now: () => t, sleep, yieldFn: () => sleep(0), rng, mathRandom: rng, wallClock: () => 0, today: () => "2000-01-01", onLog: (e) => e.kind === "error" && errors.push(e.text) });
  void rt.run(code);
  while (!done() && t < 600_000) {
    await new Promise((r) => setImmediate(r));
    if (!rt.isRunning()) break;
    const next = Math.min(...timers.map((x) => x.at));
    for (; grid + 100 <= next; grid += 100) W.tick(s, 0.1, rng);
    t = Math.max(t, next);
    const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq);
    timers = timers.filter((x) => x.at > t);
    for (const x of due) x.r();
  }
  rt.stop(true);
  assert.deepEqual(errors, []);
  return t / 1000;
}

test("playthrough: a plain player gets from the first tile to pumpkins in about ten minutes, no step over four", async () => {
  const rng = mulberry32(1);
  const s = W.createGame();
  const sweep = (body) => `const n = get_world_size();\nwhile (true) { for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) { ${body} move(North); } move(East); } }`;
  const programs = {
    Hay: () => sweep(W.level(s, "Senses") ? "if (can_harvest()) harvest();" : "harvest();"),
    Wood: () =>
      W.level(s, "Trees")
        ? sweep("const want = (x + y) % 2 === 0 ? Entities.Tree : Entities.Bush; if (can_harvest()) harvest(); if (get_entity_type() !== want) plant(want);")
        : sweep("if (can_harvest()) harvest(); if (get_entity_type() !== Entities.Bush) plant(Entities.Bush);"),
    Carrot: () => EXAMPLES.find((e) => e.id === "carrots").code,
    Pumpkin: () => EXAMPLES.find((e) => e.id === "pumpkins").code,
  };
  let total = 0;
  let last = null;
  const earn = async (item, amount) => {
    for (let k = 0; s.items[item] < amount; k++) {
      assert.ok(k < 40, `stuck on ${item}`);
      const seed = item === "Carrot" || item === "Pumpkin" ? C.ENTITY_INFO[item].cost : {};
      const field = Math.ceil(s.size * s.size * (item === "Pumpkin" ? 1.8 : 1));
      for (const [sitem, n] of Object.entries(seed)) if (s.items[sitem] < n * field) await earn(sitem, n * field * 2);
      if (last !== item) {
        W.clearFarm(s);
        last = item;
      }
      const out = () => Object.entries(seed).some(([sitem, n]) => s.items[sitem] < n);
      total += await play(s, programs[item](), () => s.items[item] >= amount || out(), rng);
    }
  };
  const order = "Plant Expand Senses Expand Speed Carrots Grass Speed Expand Trees Expand Speed Pumpkins".split(" ");
  for (const id of order) {
    const before = total;
    const cost = W.unlockCost(s, id);
    for (let k = 0; k < 5 && !W.canAfford(s, cost); k++) for (const [item, n] of Object.entries(cost)) await earn(item, n);
    assert.equal(W.buyUnlock(s, id).ok, true, id);
    if (id === "Expand") last = null;
    assert.ok(total - before < 240, `${id} ${W.level(s, id)} took ${Math.round(total - before)} s`);
  }
  assert.ok(total > 300 && total < 900, `${Math.round(total)} s`);
  // And the patch works: a fused block pays the first pumpkin prices.
  await earn("Pumpkin", 140);
  assert.ok(total < 1200, `${Math.round(total)} s to the first pumpkin upgrade`);
});
