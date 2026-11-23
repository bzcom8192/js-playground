// v3 phase 4: weather — seeded schedule, effects, get_weather / get_forecast.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as WX from "./weather.js";
import { WATER_DECAY_PER_SEC, WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { createDemoGame } from "./demo.js";
import { arenaWorld } from "./arena.js";
import { FARMER_GLOBALS, FARMER_LIB } from "./farmerLib.js";
import { stripFields, weatherFields } from "./statusStrip.js";

const { SEGMENT_TICKS } = WX;
const TPS = WX.WEATHER_TICKS_PER_SEC;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** The smallest seed whose segment `seg` has weather `w` (and optionally `next` after it). */
function seedWith(w, seg = 0, next = null) {
  for (let s = 0; s < 100_000; s++) {
    if (WX.segmentWeather(s, seg) === w && (!next || WX.segmentWeather(s, seg + 1) === next)) return s;
  }
  throw new Error(`no seed with ${w}`);
}

/** n×n farm with weather { seed, time }. Every tile Soil + a Carrot unless `empty`. */
function farm(n, seed, { time = 0, crops = "Carrot", ground = "Soil", unlocks = {} } = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, () => {
    const t = W.newTile();
    t.ground = ground;
    if (crops) t.entity = { type: crops, progress: 0 };
    return t;
  });
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, ...unlocks });
  s.weather = seed === null ? null : { seed, time };
  return s;
}

/** Tick `seconds` in 0.1 s steps (the page's step); returns the world events. */
function run(s, seconds, rng = () => 0.99) {
  const [, events] = W.withEvents(() => {
    for (let i = 0; i < Math.round(seconds * 10); i++) W.tick(s, 0.1, rng);
  });
  return events;
}

function runtime(s, opts = {}) {
  const logs = [];
  let t = 0;
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
    wallClock: () => 1_700_000_000_000,
    ...opts,
  });
  return { rt, logs };
}

// ---------- schedule ----------

test("weather is a pure function of (seed, tick) — golden values pin the derivation", () => {
  // These exact values are the cross-machine contract (hash32 + mulberry32).
  assert.equal(WX.hash32(0, 0), WX.hash32(0, 0));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => WX.segmentWeather(12, i)), ["Rain", "Sunny", "Storm", "Sunny", "Storm", "Sunny"]);
  assert.deepEqual([0, 1, 2, 3].map((i) => WX.segmentWeather(0, i)), ["Rain", "Drought", "Storm", "Rain"]);
  assert.equal(WX.DEMO_WEATHER_SEED, 12);
  for (const seed of [0, 1, 7, 123456789, 0xffffffff]) {
    for (const tick of [0, 1, 599, 1199, 1200, 5000, 1e6]) {
      assert.equal(WX.weatherAt(seed, tick), WX.weatherAt(seed, tick));
      assert.equal(WX.weatherAt(seed, tick), WX.segmentWeather(seed, Math.floor(tick / SEGMENT_TICKS)));
      assert.ok(WX.WEATHER_STATES.includes(WX.weatherAt(seed, tick)));
    }
  }
  // Every state appears, roughly at its weight.
  const count = {};
  for (let i = 0; i < 20_000; i++) count[WX.segmentWeather(99, i)] = (count[WX.segmentWeather(99, i)] || 0) + 1;
  for (const w of WX.WEATHER_STATES) assert.ok(Math.abs(count[w] / 20_000 - WX.WEATHER_WEIGHTS[w]) < 0.02, `${w}: ${count[w]}`);
});

test("segment boundaries: weather holds for 1,200 ticks and changes exactly at the boundary", () => {
  assert.equal(SEGMENT_TICKS, 1200);
  const seed = seedWith("Rain", 0, "Drought");
  assert.equal(WX.weatherAt(seed, 0), "Rain");
  assert.equal(WX.weatherAt(seed, 1199), "Rain");
  assert.equal(WX.weatherAt(seed, 1199.99), "Rain");
  assert.equal(WX.weatherAt(seed, 1200), "Drought");
  assert.equal(WX.ticksToChange(0), 1200);
  assert.equal(WX.ticksToChange(1199), 1);
  assert.equal(WX.ticksToChange(1200), 1200);

  // In the world: 1,200 world ticks = 120 s of farm time (10 ticks / s).
  const s = farm(1, seed, { crops: null, ground: "Grassland" });
  assert.equal(W.currentWeather(s), "Rain");
  let events = run(s, 119.9);
  assert.equal(W.currentWeather(s), "Rain");
  assert.ok(near(s.weather.time, 1199));
  assert.deepEqual(events.filter((e) => e.type === "weather"), []);
  events = run(s, 0.1);
  assert.equal(s.weather.time, 1200);
  assert.equal(W.currentWeather(s), "Drought");
  assert.deepEqual(events.filter((e) => e.type === "weather"), [{ type: "weather", from: "Rain", to: "Drought", tick: 1200 }]);
  assert.deepEqual(WX.tickEventLines(events), [["info", "Weather: 🏜 Drought (was 🌧 Rain)"]]);
});

test("one big tick = many small ticks (the step is cut at every weather event)", () => {
  const seed = seedWith("Rain", 0, "Drought");
  const a = farm(2, seed, { crops: null });
  const b = farm(2, seed, { crops: null });
  a.tiles[0].water = 0.3;
  b.tiles[0].water = 0.3;
  W.tick(a, 150); // 1,500 ticks: 1,200 of Rain then 300 of Drought, in one call
  for (let i = 0; i < 1500; i++) W.tick(b, 0.1);
  assert.ok(near(a.weather.time, 1500, 1e-6) && near(b.weather.time, 1500, 1e-6));
  for (let i = 0; i < 4; i++) assert.ok(near(a.tiles[i].water, b.tiles[i].water, 1e-6), `${a.tiles[i].water} vs ${b.tiles[i].water}`);
});

test("determinism across save / load: same seed + tick → same weather, and it continues identically", () => {
  const seed = 987654321;
  const s = farm(3, seed);
  run(s, 333.3); // mid-segment 2
  const data = JSON.parse(JSON.stringify(W.serialize(s)));
  assert.deepEqual(data.weather, { seed, time: s.weather.time });
  const back = W.deserialize(data);
  assert.deepEqual(back.weather, s.weather);
  assert.equal(W.currentWeather(back), W.currentWeather(s));
  assert.deepEqual(W.weatherForecast(back), W.weatherForecast(s));
  // Both copies keep producing the same weather (and the same farm).
  for (let k = 0; k < 6; k++) {
    run(s, 50);
    run(back, 50);
    assert.equal(W.currentWeather(back), W.currentWeather(s));
    assert.ok(near(back.weather.time, s.weather.time, 1e-6));
  }
  assert.deepEqual(back.tiles.map((t) => t.entity?.type ?? null), s.tiles.map((t) => t.entity?.type ?? null));
  assert.deepEqual(W.serialize(W.deserialize(W.serialize(back))), W.serialize(back), "stable");
});

// ---------- effects ----------

test("Sunny is the baseline: exactly the weatherless tick", () => {
  const seed = seedWith("Sunny");
  const a = farm(3, seed);
  const b = farm(3, null);
  a.tiles.forEach((t, i) => (t.water = (i % 4) / 4));
  b.tiles.forEach((t, i) => (t.water = (i % 4) / 4));
  run(a, 30);
  run(b, 30);
  assert.deepEqual(a.tiles, b.tiles);
});

test("Rain: every Soil tile gains water slowly over time (Grassland doesn't)", () => {
  const seed = seedWith("Rain");
  const s = farm(2, seed, { crops: null });
  s.tiles[3].ground = "Grassland";
  s.tiles[1].water = 0.995;
  run(s, 1);
  // 0.1 s steps: +0.03/s rain, −0.02/s evaporation (once water > 0).
  const first = WX.RAIN_WATER_PER_SEC * 0.1;
  const net = (WX.RAIN_WATER_PER_SEC - WATER_DECAY_PER_SEC) * 0.9;
  assert.ok(near(s.tiles[0].water, first + net, 1e-9), String(s.tiles[0].water));
  assert.ok(s.tiles[0].water < 0.05, "slowly — like light watering, not a flood");
  assert.equal(s.tiles[1].water, 1, "capped at 1");
  assert.equal(s.tiles[3].water, 0, "Grassland stays dry");
  run(s, 60);
  // 61 s in total: 0.003 for the first step, then +0.001 per 0.1 s step.
  assert.ok(near(s.tiles[0].water, 0.003 + 0.001 * 609, 1e-6), String(s.tiles[0].water));
  // Composes with the water model: the wet tile grows a carrot faster.
  const dry = farm(1, seedWith("Sunny"));
  const wet = farm(1, seed);
  run(dry, 3);
  run(wet, 3);
  assert.ok(wet.tiles[0].entity.progress > dry.tiles[0].entity.progress);
  // Growth itself is normal: at the same water, Rain = Sunny for one step.
  const r = farm(1, seed);
  const n = farm(1, seedWith("Sunny"));
  r.tiles[0].water = n.tiles[0].water = 0.5;
  W.tick(r, 0.1);
  W.tick(n, 0.1);
  assert.equal(r.tiles[0].entity.progress, n.tiles[0].entity.progress);
});

test("Drought: water evaporates 3× faster; dry crops grow at half speed, wet (≥ 0.5) ones normally", () => {
  const seed = seedWith("Drought");
  const sun = seedWith("Sunny");
  const d = farm(1, seed, { crops: null });
  const n = farm(1, sun, { crops: null });
  d.tiles[0].water = n.tiles[0].water = 0.8;
  run(d, 1);
  run(n, 1);
  assert.ok(near(0.8 - d.tiles[0].water, 3 * (0.8 - n.tiles[0].water), 1e-9));
  assert.ok(near(d.tiles[0].water, 0.8 - 3 * WATER_DECAY_PER_SEC, 1e-9));

  // Dry (water 0): half growth. Carrot grow time 8 s.
  const dry = farm(1, seed);
  W.tick(dry, 0.1);
  assert.ok(near(dry.tiles[0].entity.progress, (0.1 * 0.5) / 8));
  // Wet (water ≥ 0.5 at the step): full rate 1 + 4w.
  const wet = farm(1, seed);
  wet.tiles[0].water = 0.5;
  W.tick(wet, 0.1);
  assert.ok(near(wet.tiles[0].entity.progress, (0.1 * 3) / 8));
  const almost = farm(1, seed);
  almost.tiles[0].water = 0.49;
  W.tick(almost, 0.1);
  assert.ok(near(almost.tiles[0].entity.progress, (0.1 * (1 + 4 * 0.49) * 0.5) / 8));
  // A dry carrot takes twice as long as under the sun.
  const slow = farm(1, seed);
  const fast = farm(1, sun);
  run(slow, 8.5);
  run(fast, 8.5);
  assert.equal(fast.tiles[0].entity.progress, 1);
  assert.ok(slow.tiles[0].entity.progress < 0.6 && slow.tiles[0].entity.progress > 0.5);
});

test("Storm: growth ×1.5", () => {
  const seed = seedWith("Storm");
  const s = farm(1, seed);
  W.tick(s, 0.1);
  assert.ok(near(s.tiles[0].entity.progress, (0.1 * 1.5) / 8));
  const w = farm(1, seed);
  w.tiles[0].water = 1;
  W.tick(w, 0.1);
  assert.ok(near(w.tiles[0].entity.progress, (0.1 * 5 * 1.5) / 8));
});

test("Storm: seeded lightning strikes destroy a few crops at seeded moments (ground stays), logged", () => {
  const seed = seedWith("Storm");
  const moments = WX.strikeMoments(seed, 0);
  assert.equal(moments.length, WX.STORM_STRIKES);
  assert.deepEqual(moments, WX.strikeMoments(seed, 0), "seeded");
  for (const m of moments) assert.ok(m > 0 && m < SEGMENT_TICKS);
  assert.deepEqual(WX.strikeMoments(seedWith("Sunny"), 0), [], "only storms strike");

  // 6×6 of trees (maturing doesn't change a tree's type) + one grass tile.
  const make = () => {
    const s = farm(6, seed, { crops: "Tree" });
    s.tiles[0].entity = { type: "Grass", progress: 0 }; // grass is spared
    return s;
  };
  const s = make();
  const types = () => s.tiles.map((t) => t.entity?.type ?? null);
  const before = types();
  // Up to just before the first strike: nothing destroyed.
  run(s, (moments[0] - 1) / TPS);
  assert.deepEqual(types(), before);
  const events = run(s, 0.1);
  const strikes = events.filter((e) => e.type === "strike");
  assert.equal(strikes.length, 1);
  const hits = strikes[0].hits;
  assert.ok(hits.length >= 1 && hits.length <= WX.STORM_MAX_TILES);
  assert.equal(strikes[0].tick, moments[0]);
  for (const h of hits) {
    const t = W.tileAt(s, h.x, h.y);
    assert.equal(h.type, "Tree");
    assert.equal(t.entity, null, "crop destroyed");
    assert.equal(t.ground, "Soil", "tile keeps its ground");
  }
  assert.equal(types().filter((x) => x === null).length, hits.length, "only the struck tiles");
  assert.equal(s.tiles[0].entity?.type, "Grass");
  const lines = WX.tickEventLines(events);
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], "warn");
  assert.match(lines[0][1], /^⚡ Lightning struck (a crop|\d crops): Tree \(\d, \d\)/);

  // The whole storm: 3 strikes; an identical farm loses the identical tiles.
  run(s, (SEGMENT_TICKS - moments[0] - 1) / TPS);
  const t2 = make();
  const all = run(t2, (SEGMENT_TICKS - 1) / TPS).filter((e) => e.type === "strike");
  assert.equal(all.length, WX.STORM_STRIKES);
  assert.deepEqual(all.map((e) => e.tick), moments);
  assert.deepEqual(t2.tiles.map((t) => t.entity?.type ?? null), types());
  // A save/load in the middle of the storm doesn't change who gets struck.
  const u = make();
  run(u, (moments[0] + 5) / TPS);
  const v = W.deserialize(JSON.parse(JSON.stringify(W.serialize(u))));
  run(v, (SEGMENT_TICKS - 1 - moments[0] - 5) / TPS);
  assert.deepEqual(v.tiles.map((t) => t.entity?.type ?? null), types());
});

test("Storm: no crops → nothing struck, no event", () => {
  const seed = seedWith("Storm");
  const s = farm(3, seed, { crops: null, ground: "Grassland" });
  const events = run(s, SEGMENT_TICKS / TPS - 0.1);
  assert.deepEqual(events.filter((e) => e.type === "strike"), []);
});

// ---------- API ----------

test("get_weather(): the current state, 1 op, no Senses needed; null on a weatherless world", async () => {
  const seed = seedWith("Drought");
  const s = farm(1, seed, { unlocks: { Senses: 0 } });
  const { rt, logs } = runtime(s);
  assert.equal(await rt.run("print(get_weather())"), "done");
  assert.equal(logs.at(-1).text, "Drought");
  assert.equal(rt.stats().ops, 2);
  const none = farm(1, null);
  const r2 = runtime(none);
  await r2.rt.run("print(get_weather(), get_forecast())");
  assert.equal(r2.logs.at(-1).text, "null null");
});

test("get_forecast(): true next weather, inTicks within ±20% and never exact, costs 25 ops", async () => {
  assert.equal(WX.FORECAST_OPS, 25);
  const seed = seedWith("Sunny", 0, "Storm");
  const s = farm(1, seed, { time: 300 });
  const { rt, logs } = runtime(s);
  assert.equal(await rt.run("print(JSON.stringify(get_forecast()))"), "done");
  const f = JSON.parse(logs.at(-1).text);
  assert.equal(f.next, "Storm");
  assert.notEqual(f.inTicks, 900);
  assert.ok(Math.abs(f.inTicks - 900) <= 0.2 * 900);
  assert.equal(rt.stats().ops, 1 + 25, "print + get_forecast");
  await rt.run("get_forecast(); get_forecast(); get_weather();");
  assert.equal(rt.stats().ops, 51);
  assert.equal(rt.stats().ticks, 3, "still an instant sense (1 tick each)");

  // Exhaustively over whole segments of several seeds.
  for (const sd of [seed, 1, 42, 0xdeadbeef]) {
    let off = 0;
    const errs = new Set();
    for (let t = 0; t < 2 * SEGMENT_TICKS; t++) {
      const { next, inTicks } = WX.forecast(sd, t);
      const truth = WX.ticksToChange(t);
      assert.equal(next, WX.segmentWeather(sd, Math.floor(t / SEGMENT_TICKS) + 1));
      assert.ok(Number.isInteger(inTicks) && inTicks >= 1);
      assert.notEqual(inTicks, truth, `exact at t=${t}`);
      if (truth >= 5) assert.ok(Math.abs(inTicks - truth) <= 0.2 * truth, `t=${t}: ${inTicks} vs ${truth}`);
      else assert.equal(Math.abs(inTicks - truth), 1);
      if (inTicks > truth) off++;
      errs.add(inTicks - truth);
      assert.deepEqual(WX.forecast(sd, t), { next, inTicks }, "seeded: same tick, same answer");
    }
    assert.ok(off > 0.35 * 2 * SEGMENT_TICKS && off < 0.65 * 2 * SEGMENT_TICKS, "errors both ways");
    assert.ok(errs.size > 50, "not a constant offset");
  }
});

test("both functions join the TS lib declarations and the lint globals", () => {
  assert.equal(FARMER_GLOBALS.get_weather, "readonly");
  assert.equal(FARMER_GLOBALS.get_forecast, "readonly");
  assert.match(FARMER_LIB, /declare function get_weather\(\): WeatherType \| null;/);
  assert.match(FARMER_LIB, /declare function get_forecast\(\): \{ next: WeatherType; inTicks: number \} \| null;/);
  assert.match(FARMER_LIB, /25 ops/);
});

// ---------- saves, arena, demo, UI ----------

test("old save loads and gains a weather seed (kept from then on)", () => {
  const old = JSON.parse(JSON.stringify(W.serialize(farm(2, null))));
  delete old.weather; // written before weather existed
  const a = W.deserialize(old);
  assert.ok(Number.isInteger(a.weather.seed) && a.weather.seed >= 0 && a.weather.seed <= 0xffffffff);
  assert.equal(a.weather.time, 0);
  assert.ok(WX.WEATHER_STATES.includes(W.currentWeather(a)));
  const again = W.deserialize(JSON.parse(JSON.stringify(W.serialize(a))));
  assert.deepEqual(again.weather, a.weather, "the seed is drawn once");
  // Junk weather → a fresh section; garbage saves are new saves with weather.
  for (const junk of [{ seed: -1 }, { seed: 1.5 }, { seed: "x" }, "rain", 7]) {
    const r = W.deserialize({ ...old, weather: junk });
    assert.ok(Number.isInteger(r.weather.seed), JSON.stringify(junk));
  }
  assert.deepEqual(W.deserialize({ ...old, weather: { seed: 5, time: -3 } }).weather, { seed: 5, time: 0 });
  assert.ok(W.deserialize({ v: 99 }).weather);
  // The weather is save-level: it survives a rejected farm part.
  assert.deepEqual(W.deserialize({ ...old, weather: { seed: 9, time: 77 }, size: 999 }).weather, { seed: 9, time: 77 });
  // A world serialized without weather on purpose stays weatherless.
  assert.equal(W.deserialize(W.serialize(farm(1, null))).weather, null);
});

test("new player saves draw a weather seed once; plain createGame() worlds are weatherless", () => {
  assert.equal(W.createGame().weather, null);
  const f = W.newFarm(() => 0.5);
  assert.deepEqual(f.weather, { seed: 2147483648, time: 0 });
  const g = W.createGame();
  W.ensureWeather(g, () => 0.25);
  assert.deepEqual(g.weather, { seed: 1073741824, time: 0 });
  W.ensureWeather(g, () => 0.75);
  assert.equal(g.weather.seed, 1073741824, "never redrawn");
});

test("arena worlds stay weatherless", () => {
  const { state } = arenaWorld(5);
  assert.equal(state.weather, null);
  assert.equal(W.currentWeather(state), null);
  assert.equal(W.weatherForecast(state), null);
});

test("demo: weather runs from the fixed demo seed but is never persisted", () => {
  const d = createDemoGame();
  assert.deepEqual(d.weather, { seed: WX.DEMO_WEATHER_SEED, time: 0 });
  assert.equal(W.currentWeather(d), "Rain");
  assert.equal(W.serialize(d).weather, null);
  const tiles = JSON.stringify(d.tiles);
  W.advanceWeatherClock(d, 120); // the page's demo loop: only the weather clock moves
  assert.equal(d.weather.time, 1200);
  assert.equal(W.currentWeather(d), "Sunny");
  assert.equal(JSON.stringify(d.tiles), tiles, "the showcase farm stays frozen");
});

test("info strip shows the weather icon + name; the Weather section shows get_forecast's data", () => {
  const seed = seedWith("Storm", 0, "Rain");
  const s = farm(1, seed, { time: 600 });
  const stats = { running: false, ticks: 0, actions: 0, elapsed: 0, lastMeasure: null };
  assert.equal(stripFields(s, stats, "idle", false).weather, "⛈ Storm");
  assert.equal("weather" in stripFields(farm(1, null), stats, "idle", false), false, "absent without weather");
  const f = weatherFields(s);
  const g = W.weatherForecast(s);
  assert.deepEqual(f, { now: "Storm", next: "Rain", inTicks: g.inTicks, approxSeconds: Math.round(g.inTicks / 10) });
  assert.notEqual(f.inTicks, 600, "approximate, like get_forecast");
  assert.equal(weatherFields(farm(1, null)), null);
});

test("contracts / records are unaffected: the farm clock does not move with the weather", () => {
  const s = farm(2, 3);
  const clock = s.clock;
  run(s, 200);
  assert.equal(s.clock, clock);
  assert.equal(s.contracts, null);
});
