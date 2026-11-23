// BRIEF22: Mazes and Dinosaurs are removed. Saves written before it still load
// (and lose exactly what was removed), nothing left in the game makes or asks
// for Bone, contracts never name a removed item, and programs that still use
// the removed names fail the way any unavailable name always has.
// The fixtures in testdata/ are real exports made by the BRIEF21 engine: a
// farm inside a live maze, and one with a live dinosaur and apples.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "./constants.js";
import * as Ct from "./contracts.js";
import * as W from "./world.js";
import { CONTRACT_BONUS_ITEMS } from "./records.js";
import { buildExport, parseImport } from "./saveData.js";
import { createRuntime } from "./runtime.js";
import { FARMER_GLOBALS, FARMER_LIB } from "./farmerLib.js";
import { EXAMPLES } from "./examples.js";
import { createDemoGame } from "./demo.js";

const fixture = (name) => readFileSync(new URL(`./testdata/pre-brief22-${name}.json`, import.meta.url), "utf8");
const REMOVED_ENTITIES = ["Hedge", "Treasure", "Dinosaur", "Apple"];
const REMOVED_UNLOCKS = ["Mazes", "Dinosaurs"];

function loadOld(name) {
  const parsed = parseImport(fixture(name));
  assert.equal(parsed.ok, true, parsed.error);
  return { raw: parsed.save, state: W.deserialize(parsed.save) };
}

// ---------- saves ----------

test("old save inside a live maze: loads, hedges and treasure become bare ground, Mazes / Dinosaurs levels and Bone are gone, no refund", () => {
  const { raw, state: s } = loadOld("maze");
  assert.ok(raw.maze && raw.unlocks.Mazes === 2 && raw.items.Bone === 567, "the fixture really is an old maze save");
  assert.ok(raw.tiles.some((t) => t.e?.type === "Hedge") && raw.tiles.some((t) => t.e?.type === "Treasure"));
  assert.equal(s.size, 6);
  raw.tiles.forEach((t, i) => {
    const tile = s.tiles[i];
    if (t.e && REMOVED_ENTITIES.includes(t.e.type)) assert.equal(tile.entity, null, `tile ${i}`);
    assert.equal(tile.ground, t.g === "S" ? "Soil" : "Grassland", `tile ${i} keeps its ground`);
    assert.equal(tile.water, t.w, `tile ${i} keeps its water`);
  });
  assert.ok(s.tiles.every((t) => !t.entity || !REMOVED_ENTITIES.includes(t.entity.type)));
  for (const k of ["maze", "dino", "pendingSeed", "pendingDinoSeed"]) assert.equal(k in s, false, k);
  for (const id of REMOVED_UNLOCKS) assert.equal(id in s.unlocks, false, id);
  assert.equal("Bone" in s.items, false);
  // Everything else carries over as it was: no refund for the removed levels.
  for (const [k, v] of Object.entries(raw.items)) if (k !== "Bone") assert.equal(s.items[k], v, k);
  for (const [k, v] of Object.entries(raw.unlocks)) if (!REMOVED_UNLOCKS.includes(k)) assert.equal(s.unlocks[k], v, k);
  assert.equal(s.unlocks.Megafarm, 1, "a Megafarm already bought stays bought");
  assert.deepEqual(s.drones.map((d) => [d.x, d.y]), raw.drones, "both bots, where they stood");
  assert.deepEqual(s.weather, raw.weather);
  assert.equal(s.clock, raw.clock);
});

test("old save with a live dinosaur and apples: segments and apples become bare ground, the crops around them stay", () => {
  const { raw, state: s } = loadOld("dino");
  assert.equal(raw.dino.body.length, 3, "the fixture really has a dinosaur");
  assert.ok(raw.tiles.filter((t) => t.e?.type === "Apple").length >= 1);
  raw.tiles.forEach((t, i) => {
    const e = s.tiles[i].entity;
    if (!t.e) assert.equal(e, null);
    else if (REMOVED_ENTITIES.includes(t.e.type)) assert.equal(e, null, `tile ${i} (${t.e.type})`);
    else assert.deepEqual(e, t.e, `tile ${i} (${t.e.type}) as saved`);
  });
  for (const type of ["Pumpkin", "Carrot", "Cactus", "Grass"]) assert.ok(s.tiles.some((t) => t.entity?.type === type), type);
  // A bare Grassland tile grows grass again (the usual 0.5 s), as on any empty tile.
  const bare = raw.tiles.findIndex((t) => t.e?.type === "Dinosaur" && t.g === "G");
  assert.ok(bare >= 0);
  W.tick(s, 0.6);
  assert.equal(s.tiles[bare].entity?.type, "Grass");
});

test("old saves: the records keep only the contract count; writing the save back has the old shape minus the removed fields", () => {
  const fresh = W.serialize(W.createGame());
  for (const name of ["maze", "dino"]) {
    const { raw, state: s } = loadOld(name);
    assert.ok(raw.records.mazes["2"] && raw.records.dino.bone === 64 && raw.pendingSeed === 424242, "old records and seeds are in the file");
    assert.deepEqual(Object.keys(s.records), ["contracts"]);
    assert.equal(s.records.contracts.completed, raw.records.contracts.completed);
    assert.deepEqual(s.records.contracts.bonus, Object.fromEntries(CONTRACT_BONUS_ITEMS.map((k) => [k, 0])), "the old Gold / Bone bonus is not counted in the new items");
    const out = W.serialize(s);
    assert.deepEqual(Object.keys(out), Object.keys(fresh), "same keys as a save written today");
    const removed = Object.keys(raw).filter((k) => !(k in out));
    assert.deepEqual(removed.sort(), ["dino", "maze", "pendingDinoSeed", "pendingSeed"]);
    assert.deepEqual(Object.keys(out.items), C.ITEM_ORDER);
    assert.deepEqual(Object.keys(out.unlocks), C.UNLOCKS.map((u) => u.id));
    // The Save Data file round-trips from here on.
    const again = parseImport(JSON.stringify(buildExport({ save: out, files: null })));
    assert.deepEqual(W.serialize(W.deserialize(again.save)), out);
  }
});

test("old saves: today's contracts carry over; one for Gold or Bone is dropped, the others now pay Pumpkins / Cactus", () => {
  const { raw, state: s } = loadOld("maze");
  const old = raw.contracts.contracts;
  assert.ok(old.every((c) => ["Gold", "Bone"].includes(c.rewardItem)), "they all paid Gold or Bone");
  const kept = old.filter((c) => !["Gold", "Bone"].includes(c.item));
  assert.equal(s.contracts.date, raw.contracts.date, "the day is not rolled again (no fresh set to re-earn)");
  assert.deepEqual(s.contracts.contracts.map((c) => [c.id, c.item, c.amount, c.status, c.deadlineTick]), kept.map((c) => [c.id, c.item, c.amount, c.status, c.deadlineTick]));
  for (const c of s.contracts.contracts) {
    assert.equal(c.rewardItem, Ct.CONTRACT_ITEMS[c.item].reward);
    assert.equal(c.reward, Ct.contractReward(c.item, c.amount), "priced like a fresh one");
  }
  // A save holding a Gold or a Bone contract (Mazes / Dinosaurs farms had them).
  const withGold = { ...raw, contracts: { date: raw.contracts.date, contracts: [{ ...old[0], id: `${raw.contracts.date}#9`, item: "Gold", rewardItem: "Bone" }, old[1]] } };
  assert.deepEqual(W.deserialize(withGold).contracts.contracts.map((c) => c.item), [old[1].item]);
});

test("old saves: the arena rating and history and the Gold balance are untouched; the demo farm is unaffected", () => {
  const { raw, state: s } = loadOld("maze");
  assert.deepEqual(s.arena, raw.arena);
  assert.equal(s.items.Gold, raw.items.Gold, "Gold stays: selling Rice still makes it, Flooded Paddy 2 still costs it");
  const demo = createDemoGame();
  assert.equal(demo.demo, true);
  assert.equal("Bone" in demo.items, false);
  assert.ok(demo.tiles.every((t) => !t.entity || !REMOVED_ENTITIES.includes(t.entity.type)));
  assert.deepEqual(W.serialize(demo).contracts, null);
});

// ---------- economy ----------

test("nothing produces or consumes Bone any more; Gold is still made and spent (so it stays)", () => {
  assert.equal(C.Items.Bone, undefined);
  assert.ok(!C.ITEM_ORDER.includes("Bone") && !("Bone" in C.ITEM_ICONS));
  const costs = C.UNLOCKS.flatMap((u) => Array.from({ length: u.maxLevel }, (_, l) => u.cost(l)));
  const seeds = Object.values(C.ENTITY_INFO).map((e) => e.cost || {});
  const trades = Object.values(W.TRADES).flatMap((t) => [t.cost, t.gives]);
  const contracts = Object.entries(Ct.CONTRACT_ITEMS).flatMap(([item, c]) => [{ [item]: 1 }, { [c.reward]: 1 }]);
  const mentions = (item) => [...costs, ...seeds, ...trades, ...contracts].filter((bag) => item in bag).length;
  assert.equal(mentions("Bone"), 0);
  assert.ok(mentions("Gold") >= 2, "made by trade(Rice), spent on Rice level 2");
  assert.deepEqual(W.TRADES.Rice.gives, { Gold: C.RICE_GOLD });
  assert.deepEqual(C.UNLOCK_BY_ID.Rice.cost(1), { Pumpkin: 4200, Gold: 260 }, "Rice unchanged");
  // Fertilizer stays: instant growth is its use outside mazes, and it is still a Pumpkins-era unlock.
  assert.deepEqual([C.UNLOCK_BY_ID.Fertilizer.requires, C.UNLOCK_BY_ID.Fertilizer.cost(0), C.FERTILIZER_SECONDS], ["Pumpkins", { Pumpkin: 180 }, 3]);
  const s = W.createGame();
  Object.assign(s.unlocks, { Plant: 1, Fertilizer: 1 });
  s.items.Fertilizer = 1;
  W.droneTile(s).entity = W.makeEntity("Bush");
  assert.equal(W.useItem(s, "Fertilizer").ok, true);
  assert.ok(W.droneTile(s).entity.progress > 0.4, "3 s of a 6 s bush");
  // …and a full-grown Bush is just a full-grown Bush now.
  s.items.Fertilizer = 1;
  W.droneTile(s).entity.progress = 1;
  assert.match(W.useItem(s, "Fertilizer").msg, /Nothing growing/);
  assert.equal(s.items.Fertilizer, 1);
});

test("contracts never require or reward a removed item, whatever the unlocks, the day or the farm size", () => {
  const items = new Set(Object.keys(Ct.CONTRACT_ITEMS));
  assert.deepEqual([...items], ["Hay", "Wood", "Carrot", "Pumpkin", "Rice", "Cactus"]);
  assert.deepEqual(Ct.REWARD_ITEMS, CONTRACT_BONUS_ITEMS);
  for (const v of Object.values(Ct.CONTRACT_ITEMS)) assert.ok(Ct.REWARD_ITEMS.includes(v.reward));
  // Every unlock combination that matters, plus a hand-made state with the old ids switched on.
  const combos = [{}, { Carrots: 1 }, { Carrots: 1, Pumpkins: 1 }, { Carrots: 1, Pumpkins: 1, Rice: 1 }, { Carrots: 1, Pumpkins: 1, Cactus: 1 }, { Carrots: 1, Pumpkins: 1, Rice: 1, Cactus: 1, Mazes: 3, Dinosaurs: 3 }];
  const days = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const seen = new Set();
  for (const unlocks of combos) {
    for (const size of [1, 6, 12]) {
      const s = W.createGame();
      Object.assign(s.unlocks, unlocks);
      s.size = size;
      for (const d of days) {
        for (const c of Ct.generateContracts(s, d)) {
          assert.ok(items.has(c.item) && Ct.REWARD_ITEMS.includes(c.rewardItem), JSON.stringify(c));
          assert.ok(c.reward >= 1);
          seen.add(`${c.item}→${c.rewardItem}`);
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["Cactus→Cactus", "Carrot→Pumpkin", "Hay→Pumpkin", "Pumpkin→Pumpkin", "Rice→Pumpkin", "Wood→Pumpkin"]);
  // The top tier is the premium one: the most reward per unit delivered, in the highest crop.
  const top = Object.entries(Ct.CONTRACT_ITEMS).sort((a, b) => b[1].tier - a[1].tier)[0];
  assert.deepEqual([top[0], top[1].reward], ["Cactus", "Cactus"]);
});

// ---------- programs ----------

/** Run `code` on `s` in virtual time; → { status, logs }. */
async function run(s, code) {
  let t = 0;
  const logs = [];
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: (ms) => ((t += ms), new Promise((r) => setImmediate(r))),
    yieldFn: () => new Promise((r) => setImmediate(r)),
    wallClock: () => 0,
  });
  const status = await rt.run(code);
  return { status, logs: logs.map((l) => `${l.kind}: ${l.text}`) };
}

const everything = () => {
  const s = W.createGame();
  for (const u of C.UNLOCKS) s.unlocks[u.id] = u.maxLevel;
  s.unlocks.Expand = 3;
  s.size = 4;
  s.tiles = Array.from({ length: 16 }, W.newTile);
  for (const k of Object.keys(s.items)) s.items[k] = 1000;
  return s;
};

test("programs that use a removed name fail exactly like one that uses a name that never existed", async () => {
  for (const name of REMOVED_ENTITIES) assert.equal(C.Entities[name], undefined, name);
  for (const name of REMOVED_UNLOCKS) assert.equal(C.Unlocks[name], undefined, name);
  const pairs = [
    ["print(plant(Entities.Dinosaur));", "print(plant(Entities.Unicorn));"],
    ["print(num_items(Items.Bone));", "print(num_items(Items.Unobtainium));"],
    ["print(unlock(Unlocks.Mazes));", "print(unlock(Unlocks.Teleporter));"],
    ["print(unlock(Unlocks.Dinosaurs), num_unlocked(Unlocks.Dinosaurs), get_cost(Unlocks.Dinosaurs));", "print(unlock(Unlocks.X), num_unlocked(Unlocks.X), get_cost(Unlocks.X));"],
    ["print(get_entity_type() === Entities.Hedge, get_cost(Entities.Dinosaur));", "print(get_entity_type() === Entities.Moat, get_cost(Entities.Moat));"],
    ["print(num_unlocked(Entities.Apple), num_unlocked(Entities.Treasure));", "print(num_unlocked(Entities.Pear), num_unlocked(Entities.Chest));"],
    ['print(plant("Dinosaur"), num_items("Bone"), unlock("Mazes"));', 'print(plant("Unicorn"), num_items("Unobtainium"), unlock("Teleporter"));'],
  ];
  for (const [removed, never] of pairs) {
    const a = await run(everything(), removed);
    const b = await run(everything(), never);
    const norm = (x) => x.logs.map((l) => l.replace(/"(Dinosaur|Unicorn|Bone|Unobtainium|Mazes|Teleporter)"/g, '"?"').replace(/\b(Dinosaur|Unicorn|Mazes|Teleporter)\b/g, "?"));
    assert.deepEqual([a.status, norm(a)], [b.status, norm(b)], removed);
  }
  // Fertilizer on a ripe Bush, the old maze trigger, is just "nothing growing" now.
  const s = everything();
  W.droneTile(s).entity = { type: "Bush", progress: 1 };
  const r = await run(s, "print(use_item(Items.Fertilizer), num_items(Items.Fertilizer));");
  assert.equal(r.logs.at(-1), "print: false 1000");
  assert.ok(s.tiles.every((t) => !t.entity || t.entity.type === "Bush" || t.entity.type === "Grass"));
});

test("the editor and the Guide know nothing of the removed features; the examples run on what is left", () => {
  for (const name of [...REMOVED_ENTITIES, ...REMOVED_UNLOCKS, "Bone"]) assert.doesNotMatch(FARMER_LIB, new RegExp(`\\b${name}: "${name}"`), name);
  assert.doesNotMatch(FARMER_LIB, /maze|dinosaur|hedge|treasure|apple/i);
  assert.equal(FARMER_GLOBALS.measure, "readonly", "measure() stays: petals and cactus sizes");
  assert.deepEqual(EXAMPLES.map((e) => e.id), ["first-harvest", "snake", "bushes", "carrots", "pumpkins", "cactus", "megafarm", "rice"]);
  for (const e of EXAMPLES) {
    for (const need of e.needs) assert.ok(C.UNLOCK_BY_ID[need], `${e.id} needs ${need}`);
    assert.doesNotMatch(e.code, /Hedge|Treasure|Dinosaur|Apple|Bone|Mazes/, e.id);
  }
  assert.deepEqual(EXAMPLES.map((e) => e.name.split(".")[0]), ["1", "2", "3", "4", "5", "6", "7", "8"]);
});
