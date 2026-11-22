// v3 phase 5: Rice — unlock, paddy planting, withering, yield, growth, trade,
// contracts, saves, weather interplay, presentation, the example program.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as C from "./contracts.js";
import * as WX from "./weather.js";
import {
  ENTITY_INFO,
  ENTITY_UNLOCK,
  Entities,
  FUTURE_UNLOCKS,
  ITEM_ICONS,
  ITEM_ORDER,
  Items,
  RICE_DRY_WATER,
  RICE_GOLD,
  RICE_PLANT_WATER,
  RICE_WITHER_TICKS,
  RICE_YIELD,
  UNLOCKS,
  UNLOCK_BY_ID,
  Unlocks,
  WORLD_SIZES,
} from "./constants.js";
import { createRuntime } from "./runtime.js";
import { EXAMPLES } from "./examples.js";
import { FARMER_LIB } from "./farmerLib.js";
import { stripFields } from "./statusStrip.js";
import { growthScale, modelKey } from "./board3d/layout.js";
import { createModelKit } from "./board3d/models.js";
import { FarmScene } from "./board3d/FarmScene.js";

const DAY = "2026-11-21";

/** n×n weatherless farm (Expand level to match) with the given unlocks. */
function farm(n = 3, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Plant: 1, Senses: 1, Carrots: 1, Pumpkins: 1, ...unlocks });
  s.items.Carrot = 100;
  return s;
}
const riceFarm = (n = 3, level = 1) => farm(n, { Rice: level });

/** The drone's tile as a paddy: Soil with `water`. */
function paddy(s, water = RICE_PLANT_WATER) {
  const t = W.droneTile(s);
  t.ground = "Soil";
  t.entity = null;
  t.water = water;
  return t;
}

/** Tick in 0.1 s steps (the page's loop), holding the tile's water at `water` if given. */
function steps(s, n, { tile = null, water = null } = {}) {
  for (let i = 0; i < n; i++) {
    if (tile && water !== null) tile.water = water;
    W.tick(s, 0.1);
  }
}

/** Seconds (0.1 s resolution) until the entity on `tile` is ripe. */
function secondsToRipe(s, tile, water) {
  for (let i = 1; i <= 10_000; i++) {
    tile.water = water;
    W.tick(s, 0.1);
    if (W.isGrown(tile.entity)) return i / 10;
  }
  return Infinity;
}

function seedWith(first) {
  for (let seed = 1; seed < 10_000; seed++) if (WX.segmentWeather(seed, 0) === first) return seed;
  throw new Error(`no seed starts with ${first}`);
}

function runtime(s) {
  const logs = [];
  let t = 0;
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: (ms) => {
      let left = ms;
      while (left > 0) {
        const step = Math.min(100, left);
        W.tick(s, step / 1000);
        t += step;
        left -= step;
      }
      return new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
    wallClock: () => 1_700_000_000_000,
    today: () => DAY,
  });
  return { rt, logs, time: () => t };
}

// ---------- unlock & content ----------

test("Rice is a real 2-level unlock after Pumpkins; constants, icons and TS declarations", () => {
  const u = UNLOCK_BY_ID.Rice;
  assert.ok(u, "Rice is in UNLOCKS");
  assert.equal(u.requires, "Pumpkins");
  assert.equal(u.maxLevel, 2);
  assert.deepEqual(u.cost(0), { Pumpkin: 1500, Carrot: 500 });
  assert.deepEqual(u.cost(1), { Pumpkin: 3000, Gold: 150 });
  assert.deepEqual(FUTURE_UNLOCKS, []);
  const ids = UNLOCKS.map((x) => x.id);
  assert.ok(ids.indexOf("Rice") > ids.indexOf("Pumpkins"));
  assert.equal(ids.at(-1), "Megafarm");
  assert.equal(Entities.Rice, "Rice");
  assert.equal(Entities.Dead_Rice, "Dead_Rice");
  assert.equal(Items.Rice, "Rice");
  assert.equal(Unlocks.Rice, "Rice");
  assert.ok(ITEM_ORDER.includes("Rice"));
  assert.equal(ITEM_ICONS.Rice, "🌾");
  assert.equal(ENTITY_INFO.Rice.icon, "🌾");
  assert.equal(ENTITY_INFO.Rice.growTime, ENTITY_INFO.Carrot.growTime * 1.5, "~1.5× carrot");
  assert.equal(ENTITY_INFO.Dead_Rice.cost, null, "dead rice can't be planted");
  assert.equal(ENTITY_UNLOCK.Rice, "Rice");
  for (const re of [/Rice: "Rice";/, /Dead_Rice: "Dead_Rice";/, /Entities\.Rice/, /Items\.Rice/]) assert.match(FARMER_LIB, re);
  // Unlocks block of the .d.ts lists Rice.
  assert.match(FARMER_LIB.slice(FARMER_LIB.indexOf("declare const Unlocks")), /Rice: "Rice";/);
  // A new game has a Rice slot and the unlock at 0.
  const g = W.createGame();
  assert.equal(g.items.Rice, 0);
  assert.equal(g.unlocks.Rice, 0);
});

test("unlock gating: no rice before L1; L1 needs Pumpkins and pays its cost; L2 then maxed", () => {
  const s = farm(3, { Pumpkins: 0 });
  paddy(s);
  const locked = W.plant(s, "Rice");
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, "Rice");
  assert.equal(W.droneTile(s).entity, null);
  assert.equal(s.items.Carrot, 100, "nothing paid");

  s.items.Pumpkin = 4500;
  s.items.Carrot = 600;
  s.items.Gold = 150;
  assert.equal(W.buyUnlock(s, "Rice").locked, "Pumpkins", "needs Pumpkins first");
  s.unlocks.Pumpkins = 1;
  assert.equal(W.buyUnlock(s, "Rice").ok, true);
  assert.equal(s.items.Pumpkin, 3000);
  assert.equal(s.items.Carrot, 100);
  assert.equal(W.plant(s, "Rice").ok, true, "L1 can plant rice");
  assert.equal(s.items.Carrot, 99, "seed: 1 Carrot");
  assert.equal(W.buyUnlock(s, "Rice").ok, true);
  assert.equal(s.items.Pumpkin, 0);
  assert.equal(s.items.Gold, 0);
  assert.equal(W.level(s, "Rice"), 2);
  assert.equal(W.buyUnlock(s, "Rice").ok, false, "max level 2");
  assert.equal(W.unlockStatus(s, "Rice"), "maxed");
});

// ---------- planting ----------

test("plant(Rice) fails on dry soil and on Grassland, succeeds on a wet paddy (water ≥ 0.5)", () => {
  const s = riceFarm();
  // Grassland, even wet: needs Soil.
  const g = W.droneTile(s);
  g.water = 1;
  const onGrass = W.plant(s, "Rice");
  assert.equal(onGrass.ok, false);
  assert.match(onGrass.msg, /Soil/);
  // Dry / not wet enough soil.
  for (const w of [0, 0.2, 0.49, 0.4999]) {
    paddy(s, w);
    const r = W.plant(s, "Rice");
    assert.equal(r.ok, false, `water ${w}`);
    assert.equal(r.locked, null);
    assert.match(r.msg, /water ≥ 0\.5/);
    assert.equal(W.droneTile(s).entity, null);
  }
  assert.equal(s.items.Carrot, 100, "failed plants pay nothing");
  // Wet enough.
  for (const w of [0.5, 0.8, 1]) {
    paddy(s, w);
    assert.equal(W.plant(s, "Rice").ok, true, `water ${w}`);
    const e = W.droneTile(s).entity;
    assert.equal(e.type, "Rice");
    assert.equal(e.progress, 0);
    assert.equal(e.dry, 0);
  }
  assert.equal(s.items.Carrot, 97);
  // Over Grass works like every crop; over a crop it doesn't.
  const t = paddy(s, 0.6);
  t.entity = W.makeEntity("Grass");
  assert.equal(W.plant(s, "Rice").ok, true);
  assert.equal(W.plant(s, "Rice").ok, false, "tile already has rice");
  // No seed → fails.
  s.items.Carrot = 0;
  paddy(s, 0.6);
  assert.equal(W.plant(s, "Rice").ok, false);
});

test("from a program: plant(Entities.Rice) returns false on dry soil (a warning), true on wet", async () => {
  const s = farm(3, { Rice: 1, Watering: 1 });
  s.items.Water = 5;
  paddy(s, 0.1);
  const { rt, logs } = runtime(s);
  const res = await rt.run(`
    print("dry", plant(Entities.Rice));
    use_item(Items.Water, 2);
    print("wet", plant(Entities.Rice));
    print(get_entity_type());
  `);
  assert.equal(res, "done", JSON.stringify(logs));
  const out = logs.filter((l) => l.kind === "print").map((l) => l.text);
  assert.deepEqual(out, ["dry false", "wet true", "Rice"]);
  assert.ok(logs.some((l) => l.kind === "warn" && /wet paddy/.test(l.text)), JSON.stringify(logs));
});

// ---------- withering ----------

test("withering: dry (water < 0.2) for MORE than 200 consecutive world ticks → Dead_Rice; growth stalls meanwhile", () => {
  const s = riceFarm();
  const tile = paddy(s);
  assert.equal(W.plant(s, "Rice").ok, true);
  steps(s, 2, { tile, water: 0.5 }); // grow a little
  const p = tile.entity.progress;
  assert.ok(p > 0 && p < 1);
  steps(s, RICE_WITHER_TICKS, { tile, water: RICE_DRY_WATER - 0.01 });
  assert.equal(tile.entity.type, "Rice", "exactly 200 dry ticks: still alive");
  assert.equal(tile.entity.dry, RICE_WITHER_TICKS);
  assert.equal(tile.entity.progress, p, "no growth while dry");
  steps(s, 1, { tile, water: 0.1 });
  assert.equal(tile.entity.type, "Dead_Rice", "201st dry tick withers it");
  assert.equal(tile.entity.progress, 1);
  assert.equal(W.isGrown(tile.entity), true, "can_harvest() is true on dead rice, like Dead_Pumpkin");
  // Dead rice just sits there (no growth, no regrowth, never revives).
  steps(s, 50, { tile, water: 1 });
  assert.equal(tile.entity.type, "Dead_Rice");
});

test("withering needs CONSECUTIVE dry ticks: one wet step resets the count", () => {
  const s = riceFarm();
  const tile = paddy(s);
  W.plant(s, "Rice");
  steps(s, 150, { tile, water: 0.1 });
  assert.equal(tile.entity.dry, 150);
  steps(s, 1, { tile, water: RICE_DRY_WATER }); // exactly 0.2 is wet enough
  assert.equal(tile.entity.dry, 0);
  steps(s, 150, { tile, water: 0.1 });
  assert.equal(tile.entity.type, "Rice", "150 + 150 with a wet tick between: alive");
  // Any dt: one big 20.1 s dry step withers it too, 20 s doesn't.
  const a = riceFarm();
  const ta = paddy(a);
  W.plant(a, "Rice");
  ta.water = 0;
  W.tick(a, 20);
  assert.equal(ta.entity.type, "Rice");
  W.tick(a, 0.1);
  assert.equal(ta.entity.type, "Dead_Rice");
  // Ripe rice no longer needs water.
  const b = riceFarm();
  const tb = paddy(b, 1);
  W.plant(b, "Rice");
  secondsToRipe(b, tb, 1);
  assert.equal(tb.entity.dry, undefined);
  tb.water = 0;
  W.tick(b, 120);
  assert.equal(tb.entity.type, "Rice");
  assert.equal(W.isGrown(tb.entity), true);
});

test("dead rice harvest gives nothing and clears the tile", () => {
  const s = riceFarm();
  const tile = paddy(s);
  W.plant(s, "Rice");
  tile.water = 0;
  W.tick(s, 25);
  assert.equal(tile.entity.type, "Dead_Rice");
  const before = { ...s.items };
  assert.equal(W.harvest(s), true);
  assert.deepEqual(s.items, before, "no yield");
  assert.equal(tile.entity, null);
  assert.equal(tile.ground, "Soil", "the paddy stays");
  // Unripe rice: harvest destroys it, also without yield (TFWR rule).
  paddy(s, 0.6);
  W.plant(s, "Rice");
  const mid = { ...s.items };
  assert.equal(W.harvest(s), true);
  assert.deepEqual(s.items, mid);
  assert.equal(W.droneTile(s).entity, null);
});

// ---------- yield & growth ----------

test("yield: 3 Rice per ripe plant at L1, 5 at L2 — a single-tile crop (neighbours don't merge)", () => {
  assert.deepEqual(RICE_YIELD.slice(1), [3, 5]);
  for (const [lvl, per] of [
    [1, 3],
    [2, 5],
  ]) {
    const s = riceFarm(3, lvl);
    // A full 3×3 paddy, all ripe.
    for (const t of s.tiles) {
      t.ground = "Soil";
      t.water = 1;
      t.entity = { type: "Rice", progress: 1 };
    }
    assert.equal(W.harvest(s), true);
    assert.equal(s.items.Rice, per, `L${lvl}`);
    assert.equal(s.tiles.filter((t) => t.entity?.type === "Rice").length, 8, "only the harvested tile is cleared");
    W.moveDrone(s, "East");
    W.harvest(s);
    assert.equal(s.items.Rice, 2 * per);
  }
});

test("growth time: ~1.5× carrot at the same water; L2 grows 1.5× faster (9 s → 6 s)", () => {
  const s = riceFarm(3, 1);
  W.tileAt(s, 0, 0).ground = "Soil";
  W.tileAt(s, 1, 0).ground = "Soil";
  W.tileAt(s, 0, 0).water = 0.5;
  W.tileAt(s, 1, 0).water = 0.5;
  assert.equal(W.plant(s, "Rice").ok, true);
  W.moveDrone(s, "East");
  s.items.Wood = 10;
  s.items.Hay = 10;
  assert.equal(W.plant(s, "Carrot").ok, true);
  assert.equal(W.effectiveGrowTime(s, 0, 0), 9);
  assert.equal(W.effectiveGrowTime(s, 1, 0), 6);
  const rice = W.tileAt(s, 0, 0);
  const carrot = W.tileAt(s, 1, 0);
  let tr = null;
  let tc = null;
  for (let i = 1; i <= 200 && (tr === null || tc === null); i++) {
    rice.water = 0.5;
    carrot.water = 0.5;
    W.tick(s, 0.1);
    if (tr === null && W.isGrown(rice.entity)) tr = i / 10;
    if (tc === null && W.isGrown(carrot.entity)) tc = i / 10;
  }
  // rate at water 0.5 = 1 + 4 × 0.5 = 3 → carrot 2 s, rice 3 s.
  assert.ok(Math.abs(tc - 2) <= 0.11, `carrot ${tc}`);
  assert.ok(Math.abs(tr - 3) <= 0.11, `rice ${tr}`);
  assert.ok(Math.abs(tr / tc - 1.5) < 0.1, `ratio ${tr / tc}`);

  const s2 = riceFarm(3, 2);
  assert.equal(W.plant(s2, "Rice").ok, false, "(dry grass tile)");
  const t2 = paddy(s2, 0.5);
  assert.equal(W.plant(s2, "Rice").ok, true);
  assert.equal(W.effectiveGrowTime(s2, 0, 0), 6);
  const l2 = secondsToRipe(s2, t2, 0.5);
  assert.ok(Math.abs(l2 - 2) <= 0.11, `L2 rice ${l2}`);
  // Fertilizer works on rice like any growing crop.
  const s3 = riceFarm(3, 1);
  s3.unlocks.Fertilizer = 1;
  s3.items.Fertilizer = 5;
  paddy(s3, 0.5);
  W.plant(s3, "Rice");
  assert.equal(W.useItem(s3, "Fertilizer", 5).ok, true);
  assert.equal(W.isGrown(W.droneTile(s3).entity), true);
});

// ---------- economy ----------

test("trade(Items.Rice): 1 Rice → 2 Gold, n at a time; gated by the Rice unlock; old trades unchanged", () => {
  assert.equal(RICE_GOLD, 2);
  assert.deepEqual(W.TRADES.Rice, { cost: { Rice: 1 }, gives: { Gold: 2 }, unlock: "Rice" });
  const locked = farm(3);
  locked.items.Rice = 10;
  const r0 = W.trade(locked, "Rice");
  assert.equal(r0.ok, false);
  assert.equal(r0.locked, "Rice");
  assert.equal(locked.items.Rice, 10);

  const s = riceFarm();
  s.items.Rice = 10;
  assert.equal(W.trade(s, "Rice").ok, true);
  assert.equal(s.items.Rice, 9);
  assert.equal(s.items.Gold, 2);
  assert.equal(W.trade(s, "Rice", 4).ok, true);
  assert.equal(s.items.Rice, 5);
  assert.equal(s.items.Gold, 10);
  const short = W.trade(s, "Rice", 6);
  assert.equal(short.ok, false);
  assert.match(short.msg, /6 Rice/);
  assert.equal(s.items.Rice, 5);
  assert.equal(s.items.Gold, 10);
  // Fertilizer / Water are still bought with Pumpkin / Carrot.
  Object.assign(s.unlocks, { Fertilizer: 1, Watering: 1 });
  s.items.Pumpkin = 3;
  assert.equal(W.trade(s, "Fertilizer", 3).ok, true);
  assert.equal(s.items.Fertilizer, 3);
  assert.equal(s.items.Pumpkin, 0);
  const water = s.items.Water;
  assert.equal(W.trade(s, "Water", 2).ok, true);
  assert.equal(s.items.Water, water + 2);
  assert.equal(W.trade(s, "Gold").ok, false, "Gold can't be traded for");
  assert.equal(W.trade(s, "toString").ok, false, "prototype keys aren't trades");
});

test("contracts: Rice joins the pool only with the Rice unlock, tier between Pumpkin and Cactus, pays ≈1.5 Gold per Rice", () => {
  const base = { Carrots: 1, Pumpkins: 1, Cactus: 1 };
  const without = farm(6, base);
  without.unlocks.Rice = 0;
  assert.deepEqual(C.contractPool(without), ["Hay", "Wood", "Carrot", "Pumpkin", "Cactus"]);
  const withRice = farm(6, { ...base, Rice: 1 });
  assert.deepEqual(C.contractPool(withRice), ["Hay", "Wood", "Carrot", "Pumpkin", "Rice", "Cactus"]);
  const info = C.CONTRACT_ITEMS.Rice;
  assert.ok(info.tier > C.CONTRACT_ITEMS.Pumpkin.tier && info.tier < C.CONTRACT_ITEMS.Cactus.tier);
  // v4 phase 2: a rice contract pays 1.5 Gold per Rice (selling pays 2 → the
  // bonus contract is now worth delivering instead of a 0.56 Gold/unit loss).
  assert.equal(info.value * C.BONUS_FACTOR, 1.5);
  assert.equal(C.contractReward("Rice", 100), 150);
  assert.equal(info.reward, "Gold");
  assert.equal(info.needs, "Rice");
  // Over 60 days rice shows up with the unlock and never without it.
  const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const items = (s) => new Set(days.flatMap((d) => C.generateContracts(s, d).map((c) => c.item)));
  assert.equal(items(without).has("Rice"), false);
  assert.equal(items(withRice).has("Rice"), true);
  // A rice contract delivers like any other and survives a save.
  const d = days.find((x) => C.generateContracts(withRice, x).some((c) => c.item === "Rice"));
  C.ensureContracts(withRice, d);
  const c = withRice.contracts.contracts.find((x) => x.item === "Rice");
  assert.equal(c.reward, C.contractReward("Rice", c.amount));
  assert.equal(c.deadlineTick, C.contractBudget("Rice", c.amount));
  const back = W.deserialize(JSON.parse(JSON.stringify(W.serialize(withRice))));
  assert.deepEqual(back.contracts, withRice.contracts);
  withRice.items.Rice = c.amount;
  assert.equal(C.deliverContract(withRice, c.id).ok, true);
  assert.equal(withRice.items.Rice, 0);
  assert.equal(withRice.items.Gold, c.reward);
});

// ---------- weather (emergent, no special cases) ----------

test("weather: Drought dries a fresh paddy until the rice withers; Rain keeps it wet and it ripens", () => {
  const run = (weather) => {
    const s = riceFarm();
    s.weather = { seed: seedWith(weather), time: 0 };
    const t = paddy(s, RICE_PLANT_WATER);
    assert.equal(W.plant(s, "Rice").ok, true);
    for (let i = 0; i < 300; i++) W.tick(s, 0.1); // 30 s, inside segment 0
    assert.equal(W.currentWeather(s), weather);
    return t;
  };
  const drought = run("Drought");
  assert.equal(drought.entity.type, "Dead_Rice", "evaporation ×3 and half growth: it stalls at ~67 % and withers");
  const rain = run("Rain");
  assert.equal(rain.entity.type, "Rice");
  assert.equal(W.isGrown(rain.entity), true);
  assert.ok(rain.water > RICE_PLANT_WATER, `rain raised the paddy: ${rain.water}`);
  const sunny = run("Sunny");
  assert.equal(sunny.entity.type, "Rice", "a normal day: ripe long before the paddy dries");
  assert.equal(W.isGrown(sunny.entity), true);
  // Lightning can strike rice (a crop) but spares dead rice.
  assert.equal(WX.STRIKABLE.has("Rice"), true);
  assert.equal(WX.STRIKABLE.has("Dead_Rice"), false);
});

// ---------- saves ----------

test("saves: rice tiles round-trip (dry count included); old saves without rice load fine", () => {
  const s = riceFarm(3, 2);
  s.items.Rice = 42;
  const t = paddy(s, 0.6);
  W.plant(s, "Rice");
  t.water = 0.05;
  steps(s, 37);
  W.moveDrone(s, "East");
  W.tileAt(s, 1, 0).ground = "Soil";
  W.tileAt(s, 1, 0).entity = { type: "Dead_Rice", progress: 1 };
  const back = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  assert.equal(back.items.Rice, 42);
  assert.equal(back.unlocks.Rice, 2);
  assert.deepEqual(W.tileAt(back, 0, 0).entity, t.entity);
  assert.equal(W.tileAt(back, 0, 0).entity.dry, 37);
  assert.equal(W.tileAt(back, 1, 0).entity.type, "Dead_Rice");
  // Keeps simulating identically: 164 more dry ticks wither both.
  steps(s, 164);
  steps(back, 164);
  assert.equal(W.tileAt(s, 0, 0).entity.type, "Dead_Rice");
  assert.equal(W.tileAt(back, 0, 0).entity.type, "Dead_Rice");

  // Junk dry counts are clamped.
  const raw = JSON.parse(JSON.stringify(W.serialize(riceFarm())));
  raw.tiles[0] = { g: "S", w: 0.1, e: { type: "Rice", progress: 0.4, dry: "lots" } };
  raw.tiles[1] = { g: "S", w: 0.1, e: { type: "Rice", progress: 0.4, dry: 1e9 } };
  raw.tiles[2] = { g: "S", w: 0.1, e: { type: "Rice", progress: 1, dry: 12 } };
  const junk = W.deserialize(raw);
  assert.equal(junk.tiles[0].entity.dry, 0);
  assert.equal(junk.tiles[1].entity.dry, RICE_WITHER_TICKS);
  assert.equal(junk.tiles[2].entity.dry, undefined, "ripe rice has no dry count");

  // An old (pre-Rice) save: no Rice item / unlock keys, no rice anywhere.
  const old = W.serialize(farm(3, { Cactus: 1 }));
  old.items.Pumpkin = 777;
  delete old.items.Rice;
  delete old.unlocks.Rice;
  old.tiles[4] = { g: "S", w: 0.3, e: { type: "Carrot", progress: 0.5 } };
  const loaded = W.deserialize(JSON.parse(JSON.stringify(old)));
  assert.equal(loaded.size, 3);
  assert.equal(loaded.items.Rice, 0);
  assert.equal(loaded.unlocks.Rice, 0);
  assert.equal(loaded.items.Pumpkin, 777);
  assert.equal(loaded.unlocks.Cactus, 1);
  assert.deepEqual(loaded.tiles[4].entity, { type: "Carrot", progress: 0.5 });
  W.tick(loaded, 1);
  assert.equal(C.contractPool(loaded).includes("Rice"), false);
});

// ---------- presentation ----------

test("presentation: info strip shows the dry count; 3D models for Rice / Dead_Rice", () => {
  const stats = { running: true, ticks: 1, actions: 0, elapsed: 0, lastMeasure: null };
  const s = riceFarm();
  const t = paddy(s, 0.5);
  W.plant(s, "Rice");
  assert.equal(stripFields(s, stats, "running", false).what, "🌾 Rice 0% / Soil");
  t.water = 0.1;
  steps(s, 12);
  assert.equal(stripFields(s, stats, "running", false).what, "🌾 Rice 0% / Soil · dry 12/200");
  t.water = 0;
  W.tick(s, 30);
  assert.equal(stripFields(s, stats, "running", false).what, "🌾 Dead Rice / Soil");

  // Growth scale: rice shoots up like wheat; dead rice is fixed.
  const [sx, sy] = growthScale("Rice", 0);
  assert.ok(sy < sx, "seedlings are short");
  assert.deepEqual(growthScale("Rice", 1), [1, 1, 1]);
  assert.deepEqual(growthScale("Dead_Rice", 0.3), [1, 1, 1]);
  assert.equal(modelKey({ type: "Rice", progress: 0.2 }), modelKey({ type: "Rice", progress: 1 }), "growth only rescales / recolours");
  assert.notEqual(modelKey({ type: "Rice", progress: 1 }), modelKey({ type: "Dead_Rice", progress: 1 }));

  const kit = createModelKit();
  for (const type of ["Rice", "Dead_Rice"]) {
    for (const v of [0, 1, 2]) {
      const obj = kit.buildEntity({ type, progress: 1 }, v);
      assert.ok(obj, type);
      let tris = 0;
      obj.traverse((o) => {
        if (o.isMesh) tris += o.geometry.attributes.position.count / 3;
      });
      assert.ok(tris > 50 && tris < 2000, `${type} triangles ${tris}`);
      // Living rice gets its own tint material (green → gold like wheat); dead rice doesn't.
      assert.equal(!!obj.userData.wheatMaterial, type === "Rice");
      kit.release(obj);
    }
  }
  kit.dispose();

  // The scene builds a model per rice tile and keeps it as it grows.
  const fs = new FarmScene();
  const g = riceFarm(3);
  for (const tile of g.tiles) {
    tile.ground = "Soil";
    tile.water = 0.6;
    tile.entity = { type: "Rice", progress: 0.3, dry: 0 };
  }
  g.tiles[4].entity = { type: "Dead_Rice", progress: 1 };
  fs.sync(g);
  assert.equal(fs.builds, 9);
  for (const tile of g.tiles) if (tile.entity.type === "Rice") tile.entity.progress = 0.7;
  fs.sync(g);
  fs.update(1 / 60);
  assert.equal(fs.builds, 9, "growth doesn't rebuild");
});

// ---------- example ----------

test("Rice Paddy example: tills, waters, plants, harvests and sells rice for Gold, no errors", async () => {
  const ex = EXAMPLES.find((e) => e.id === "rice");
  assert.ok(ex, "example exists");
  assert.ok(ex.needs.includes("Rice"));
  const s = farm(3, { Rice: 1, Watering: 1 });
  s.items.Carrot = 500;
  s.items.Wood = 0;
  const { rt, logs, time } = runtime(s);
  let finished = null;
  rt.run(ex.code).then((r) => (finished = r));
  while (finished === null && time() < 240_000 && !logs.some((l) => /^Sold [1-9]/.test(l.text))) {
    await new Promise((r) => setImmediate(r));
  }
  rt.stop();
  await new Promise((r) => setImmediate(r));
  assert.ok(!logs.some((l) => l.kind === "error"), JSON.stringify(logs.filter((l) => l.kind === "error")));
  const sold = logs.find((l) => /^Sold [1-9]/.test(l.text));
  assert.ok(sold, JSON.stringify(logs.slice(-6)));
  const n = Number(sold.text.split(" ")[1]);
  assert.equal(n % 3, 0, "3 Rice per plant at L1");
  assert.ok(s.items.Gold >= 2 * n, `gold ${s.items.Gold}`);
  assert.ok(s.tiles.every((t) => t.ground === "Soil"), "the field became a paddy");
});
