// Semicolon Acres — pure world logic (no DOM, no timers). Unit-tested in node.
//
// Coordinates: x grows East, y grows North. tiles[y * size + x].
// Every mutating function returns either `true`/`false` (simple success) or a
// result object `{ ok, msg?, locked? }` so the runtime can log helpful hints.

import {
  BUSH_YIELD,
  CACTUS_FACTOR,
  CARROT_YIELD,
  DEAD_PUMPKIN_CHANCE,
  DIR_DELTA,
  ENTITY_INFO,
  FERTILIZER_PRICE,
  FERTILIZER_SECONDS,
  GRASS_REGROW_DELAY,
  HAY_YIELD,
  ITEM_ORDER,
  PUMPKIN_FACTOR,
  RICE_DRY_WATER,
  RICE_GOLD,
  RICE_L2_GROWTH,
  RICE_PLANT_WATER,
  RICE_TICKS_PER_SEC,
  RICE_WITHER_TICKS,
  RICE_YIELD,
  SUNFLOWER_BONUS,
  SUNFLOWER_MIN,
  SUNFLOWER_POWER,
  TREE_YIELD,
  UNLOCKS,
  UNLOCK_BY_ID,
  WATER_BASE_INTERVAL,
  WATER_DECAY_PER_SEC,
  WATER_PER_USE,
  WATER_PRICE,
  WORLD_SIZES,
  byLevel,
  maxDrones,
  priceText,
} from "./constants.js";
import { emptyRecords, sanitizeRecords } from "./records.js";
import { farmClock, sanitizeContracts } from "./contracts.js";
import { emptyArena, sanitizeArena } from "./arenaRating.js";
import * as WX from "./weather.js";

const ok = { ok: true };

// ---------- events ----------
// Weather moments (a change of weather, a lightning strike) are reported to
// whoever wraps the world call in withEvents (the page, around tick()). World
// calls are synchronous, so one module-level sink is enough; outside
// withEvents the events are simply dropped.
let eventSink = null;
const emit = (ev) => {
  if (eventSink) eventSink.push(ev);
};

/** Run `fn()` and collect the world events it emits → [result, events]. */
export function withEvents(fn) {
  const prev = eventSink;
  const events = [];
  eventSink = events;
  try {
    return [fn(), events];
  } finally {
    eventSink = prev;
  }
}
const fail = (msg, locked = null) => ({ ok: false, msg, locked });

// ---------- creation ----------

export function newTile() {
  return { ground: "Grassland", entity: null, water: 0, regrow: 0 };
}

export function makeEntity(type, rng = Math.random, progress = 0) {
  const e = { type, progress };
  // Petals / size are rolled at planting time (readable with measure()).
  if (type === "Sunflower") e.petals = 7 + Math.floor(rng() * 9); // 7..15
  if (type === "Cactus") e.size = Math.floor(rng() * 10); // 0..9
  if (type === "Rice") e.dry = 0; // consecutive dry world ticks (see simulate)
  return e;
}

export const newDrone = (x = 0, y = 0) => ({ x, y, flips: 0 });

export function createGame() {
  const drone = newDrone();
  const state = {
    size: 1,
    tiles: [newTile()],
    // `drone` is always drones[0], the original drone: the info strip, the
    // UI buttons and every single-drone code path use it. Megafarm adds more
    // drones to `drones`; while a world function runs on behalf of drone k,
    // `drone` temporarily points at drones[k] (see withDrone).
    drone,
    drones: [drone],
    items: Object.fromEntries(ITEM_ORDER.map((k) => [k, 0])),
    unlocks: Object.fromEntries(UNLOCKS.map((u) => [u.id, 0])),
    waterTimer: 0,
    // Save-level stats (see records.js: the contract totals).
    records: emptyRecords(),
    // v3 phase 2: the farm clock in ticks (every run adds its run clock; see
    // contracts.js) and today's daily contracts ({ date, contracts } or null
    // until contracts.ensureContracts generates them).
    clock: 0,
    contracts: null,
    // v3 phase 3: the arena rating + last matches (see arenaRating.js).
    arena: emptyArena(),
    // v3 phase 4: { seed, time } (see weather.js) or null = no weather. A
    // plain createGame() world is weatherless (tests, arena worlds); the page
    // creates its saves with newFarm(), which draws the weather seed once.
    weather: null,
  };
  // A new farm: a single grassland tile with grass on it.
  state.tiles[0].entity = makeEntity("Grass", Math.random, 1);
  return state;
}

/** A new player save: createGame() + its weather seed (drawn once, here). */
export function newFarm(rng = Math.random) {
  const state = createGame();
  state.weather = WX.newWeather(rng);
  return state;
}

/** Give a weatherless player save its weather seed (no-op if it has one). */
export function ensureWeather(state, rng = Math.random) {
  if (!state.weather) state.weather = WX.newWeather(rng);
  return state.weather;
}

// ---------- helpers ----------

export const level = (state, id) => state.unlocks[id] || 0;
export const isUnlocked = (state, id) => level(state, id) >= 1;
export const idx = (state, x, y) => y * state.size + x;
export const tileAt = (state, x, y) => state.tiles[idx(state, x, y)];
export const droneTile = (state) => tileAt(state, state.drone.x, state.drone.y);
/** Every drone (drone 0 first). Tolerates hand-made states without a `drones` list. */
export const allDrones = (state) => (Array.isArray(state.drones) && state.drones.length ? state.drones : [state.drone]);
export const isGrown = (e) => !!e && e.progress >= 1;
export const speedMultiplier = (state) => 2 ** level(state, "Speed");
export const waterCap = (state) => 5 + 5 * level(state, "Watering");

const wrap = (v, n) => ((v % n) + n) % n;

export function neighbor(state, x, y, dir, wrapAround = true) {
  const d = DIR_DELTA[dir];
  if (!d) return null;
  let nx = x + d[0];
  let ny = y + d[1];
  if (wrapAround) {
    nx = wrap(nx, state.size);
    ny = wrap(ny, state.size);
  } else if (nx < 0 || ny < 0 || nx >= state.size || ny >= state.size) {
    return null;
  }
  return { x: nx, y: ny };
}

function orthoNeighbors(state, x, y) {
  const out = [];
  for (const dir of ["North", "East", "South", "West"]) {
    const n = neighbor(state, x, y, dir, false);
    if (n) out.push(n);
  }
  return out;
}

export function canAfford(state, cost) {
  if (!cost) return false;
  return Object.entries(cost).every(([k, v]) => (state.items[k] || 0) >= v);
}

function pay(state, cost) {
  for (const [k, v] of Object.entries(cost)) state.items[k] -= v;
}

function add(state, item, n) {
  state.items[item] = (state.items[item] || 0) + n;
}

// Effective grow time of the entity on (x, y): trees grow 2× slower for
// each orthogonally adjacent tree (no wrap), so a checkerboard is optimal.
export function effectiveGrowTime(state, x, y) {
  const e = tileAt(state, x, y).entity;
  if (!e) return 0;
  const base = ENTITY_INFO[e.type]?.growTime ?? 1;
  if (e.type === "Rice") return level(state, "Rice") >= 2 ? base / RICE_L2_GROWTH : base;
  if (e.type !== "Tree") return base;
  let adj = 0;
  for (const n of orthoNeighbors(state, x, y)) {
    if (tileAt(state, n.x, n.y).entity?.type === "Tree") adj++;
  }
  return base * 2 ** adj;
}

function mature(tile, rng) {
  const e = tile.entity;
  e.progress = 1;
  if (e.type === "Pumpkin" && rng() < DEAD_PUMPKIN_CHANCE) {
    tile.entity = { type: "Dead_Pumpkin", progress: 1 };
  }
  if (e.type === "Rice") delete e.dry; // ripe rice no longer needs water
}

/** Rice that stayed dry too long: like Dead_Pumpkin, harvest() just clears it. */
function witherRice(tile) {
  tile.entity = { type: "Dead_Rice", progress: 1 };
}

// ---------- real-time simulation ----------

// Advance the world by dt seconds. Growth multiplier = 1 + 4 × water (1×…5×),
// times the weather's growth factor. Without weather (state.weather null:
// arena worlds, hand-made test states) this is exactly the pre-weather tick.
//
// With weather (see weather.js) the step is cut at every weather event inside
// it — a segment boundary or a storm's strike moment — so each piece runs
// under one weather state and strikes happen at their exact tick, whatever
// dt the caller uses. The water model is the same one: weather only scales
// its evaporation and adds rain to Soil.
export function tick(state, dt, rng = Math.random) {
  const w = state.weather;
  if (!w) {
    simulate(state, dt, rng, WX.NO_WEATHER);
    return;
  }
  let left = dt * WX.WEATHER_TICKS_PER_SEC; // world ticks still to run
  while (left > 1e-9) {
    const t = w.time;
    const seg = WX.segmentOf(Math.floor(t));
    const segEnd = (seg + 1) * WX.SEGMENT_TICKS;
    const weather = WX.segmentWeather(w.seed, seg);
    const moments = weather === "Storm" ? WX.strikeMoments(w.seed, seg) : [];
    const k = moments.findIndex((m) => m > t);
    const boundary = k >= 0 ? moments[k] : segEnd;
    const step = Math.min(left, boundary - t);
    simulate(state, step / WX.WEATHER_TICKS_PER_SEC, rng, WX.WEATHER_EFFECTS[weather]);
    left -= step;
    if (step >= boundary - t) {
      w.time = boundary;
      if (boundary === segEnd) {
        const next = WX.segmentWeather(w.seed, seg + 1);
        if (next !== weather) emit({ type: "weather", from: weather, to: next, tick: segEnd });
      } else {
        lightning(state, seg, k);
      }
    } else {
      w.time = t + step;
    }
  }
}

/** Only the weather clock moves (the frozen demo farm: weather runs, the farm doesn't). */
export function advanceWeatherClock(state, dt) {
  if (state.weather) state.weather.time += dt * WX.WEATHER_TICKS_PER_SEC;
}

/** Current weather state, or null on a weatherless world (the arena). */
export const currentWeather = (state) => (state.weather ? WX.weatherAt(state.weather.seed, state.weather.time) : null);

/** get_forecast(): { next, inTicks } (approximate; see weather.js), or null without weather. */
export const weatherForecast = (state) => (state.weather ? WX.forecast(state.weather.seed, state.weather.time) : null);

// Storm strike k of segment `seg`: destroy a few crops (the ground and its
// water stay), and report which ones.
function lightning(state, seg, k) {
  const crops = [];
  state.tiles.forEach((t, i) => {
    if (t.entity && WX.STRIKABLE.has(t.entity.type)) crops.push(i);
  });
  if (!crops.length) return;
  const hits = WX.strikeTargets(state.weather.seed, seg, k, crops).map((i) => {
    const type = state.tiles[i].entity.type;
    removeEntity(state.tiles[i]);
    return { x: i % state.size, y: Math.floor(i / state.size), type };
  });
  emit({ type: "strike", hits, tick: state.weather.time });
}

function simulate(state, dt, rng, fx) {
  const n = state.size;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tile = tileAt(state, x, y);
      const e = tile.entity;
      // Growing rice (v3 phase 5) needs its paddy wet: on a dry tile
      // (water < RICE_DRY_WATER at the start of the step) it doesn't grow and
      // counts dry world ticks; more than RICE_WITHER_TICKS in a row and it
      // withers. Any wet step resets the count. Same water model as every
      // crop — rain / drought reach it through tile.water, nothing special.
      if (e && e.type === "Rice" && e.progress < 1 && tile.water < RICE_DRY_WATER) {
        e.dry = (e.dry || 0) + dt * RICE_TICKS_PER_SEC;
        if (e.dry > RICE_WITHER_TICKS + 1e-9) witherRice(tile);
      } else if (e && e.progress < 1) {
        if (e.type === "Rice") e.dry = 0;
        let rate = 1 + 4 * tile.water;
        if (fx !== WX.NO_WEATHER) rate *= fx.growth * (tile.water >= WX.DROUGHT_WET_WATER ? 1 : fx.dryGrowth);
        const gt = effectiveGrowTime(state, x, y) || 1;
        e.progress += (dt * rate) / gt;
        if (e.progress >= 1) mature(tile, rng);
      } else if (!e && tile.ground === "Grassland") {
        tile.regrow += dt;
        if (tile.regrow >= GRASS_REGROW_DELAY) {
          tile.regrow = 0;
          tile.entity = makeEntity("Grass", rng);
        }
      }
      if (tile.water > 0) {
        tile.water = Math.max(0, tile.water - WATER_DECAY_PER_SEC * fx.evaporation * dt);
      }
      if (fx.rain > 0 && tile.ground === "Soil") {
        tile.water = Math.min(1, tile.water + fx.rain * dt);
      }
    }
  }
  const wl = level(state, "Watering");
  if (wl > 0) {
    const interval = WATER_BASE_INTERVAL / wl;
    state.waterTimer += dt;
    while (state.waterTimer >= interval) {
      state.waterTimer -= interval;
      if (state.items.Water < waterCap(state)) state.items.Water += 1;
    }
  }
}

// ---------- drone actions ----------

// Where move(dir) would take the drone (the farm wraps at its edges), or null
// for something that is not a direction.
const moveTarget = (state, dir) => neighbor(state, state.drone.x, state.drone.y, dir);

export const canMove = (state, dir) => !!moveTarget(state, dir);

export function moveDrone(state, dir) {
  const n = moveTarget(state, dir);
  if (!n) return false;
  state.drone.x = n.x;
  state.drone.y = n.y;
  return true;
}

function removeEntity(tile) {
  tile.entity = null;
  tile.regrow = 0;
}

// Connected (4-neighbour, no wrap) group of fully grown, living pumpkins.
export function pumpkinGroup(state, x, y) {
  const seen = new Set();
  const group = [];
  const stack = [{ x, y }];
  while (stack.length) {
    const p = stack.pop();
    const k = idx(state, p.x, p.y);
    if (seen.has(k)) continue;
    seen.add(k);
    const e = state.tiles[k].entity;
    if (!e || e.type !== "Pumpkin" || !isGrown(e)) continue;
    group.push(p);
    for (const nb of orthoNeighbors(state, p.x, p.y)) stack.push(nb);
  }
  return group;
}

// Pumpkin rule: harvesting a grown pumpkin clears its whole connected group of
// grown pumpkins. If the group is a solid k×k square the yield is k³,
// otherwise it is the number of pumpkins in the group. × the level's factor.
export function pumpkinYield(group) {
  if (!group.length) return 0;
  const xs = group.map((p) => p.x);
  const ys = group.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  if (w === h && group.length === w * h) return w ** 3;
  return group.length;
}

// Cactus rule (one clear rule, see Docs panel):
//  harvest() on a fully grown cactus harvests EVERY cactus on the farm.
//  n = number of fully grown cacti. The farm is "sorted" when, for every pair
//  of orthogonally adjacent grown cacti (no wrap), size(West) ≤ size(East)
//  and size(South) ≤ size(North). Sorted → n² Cactus, otherwise → n.
//  Ungrown cacti are destroyed without yield. × the level's factor.
export function cactusSorted(state) {
  const n = state.size;
  const sizeAt = (x, y) => {
    const e = tileAt(state, x, y).entity;
    return e && e.type === "Cactus" && isGrown(e) ? e.size : null;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = sizeAt(x, y);
      if (s === null) continue;
      if (x + 1 < n) {
        const e = sizeAt(x + 1, y);
        if (e !== null && s > e) return false;
      }
      if (y + 1 < n) {
        const nn = sizeAt(x, y + 1);
        if (nn !== null && s > nn) return false;
      }
    }
  }
  return true;
}

export function harvest(state) {
  const { x, y } = state.drone;
  const tile = tileAt(state, x, y);
  const e = tile.entity;
  if (!e) return false;
  if (!isGrown(e)) {
    // Deviation: unripe Grass is left alone (returns false) so the very first
    // `while (true) { harvest(); }` program works at any speed.
    if (e.type === "Grass") return false;
    // Harvesting any other unripe plant just destroys it.
    removeEntity(tile);
    return true;
  }
  switch (e.type) {
    case "Grass":
      add(state, "Hay", byLevel(HAY_YIELD, level(state, "Grass")));
      break;
    case "Bush":
      add(state, "Wood", byLevel(BUSH_YIELD, level(state, "Trees")));
      break;
    case "Tree":
      add(state, "Wood", byLevel(TREE_YIELD, level(state, "Trees")));
      break;
    case "Carrot":
      add(state, "Carrot", byLevel(CARROT_YIELD, level(state, "Carrots")));
      break;
    case "Pumpkin": {
      const group = pumpkinGroup(state, x, y);
      add(state, "Pumpkin", pumpkinYield(group) * byLevel(PUMPKIN_FACTOR, level(state, "Pumpkins")));
      for (const p of group) removeEntity(tileAt(state, p.x, p.y));
      break;
    }
    case "Sunflower": {
      const flowers = state.tiles
        .map((t) => t.entity)
        .filter((f) => f && f.type === "Sunflower");
      let power = SUNFLOWER_POWER * Math.floor(Math.sqrt(flowers.length));
      const maxPetals = Math.max(...flowers.map((f) => f.petals || 0));
      if (flowers.length >= SUNFLOWER_MIN && e.petals === maxPetals) power *= SUNFLOWER_BONUS;
      add(state, "Power", power * Math.max(1, level(state, "Sunflowers")));
      break;
    }
    case "Rice":
      // A single-tile crop: no groups, no giants.
      add(state, "Rice", RICE_YIELD[Math.min(RICE_YIELD.length - 1, Math.max(1, level(state, "Rice")))]);
      break;
    case "Cactus": {
      let grown = 0;
      for (const t of state.tiles) {
        if (t.entity?.type === "Cactus" && isGrown(t.entity)) grown++;
      }
      const amount = cactusSorted(state) ? grown * grown : grown;
      add(state, "Cactus", amount * byLevel(CACTUS_FACTOR, level(state, "Cactus")));
      for (const t of state.tiles) if (t.entity?.type === "Cactus") removeEntity(t);
      break;
    }
    default: // Dead_Pumpkin, Dead_Rice and anything else: just cleared
      break;
  }
  if (tile.entity === e) removeEntity(tile);
  return true;
}

export function plant(state, type, rng = Math.random) {
  const info = ENTITY_INFO[type];
  if (!info || info.cost === null) return fail(`Can't plant ${String(type)}`);
  if (!isUnlocked(state, "Plant")) return fail("plant() is locked", "Plant");
  if (info.unlock && !isUnlocked(state, info.unlock)) {
    return fail(`${type} is locked`, info.unlock);
  }
  const tile = droneTile(state);
  if (tile.entity && tile.entity.type !== "Grass") {
    return fail(`Tile already has ${tile.entity.type}`);
  }
  if (info.soil && tile.ground !== "Soil") return fail(`${type} needs Soil — till() first`);
  if (type === "Rice" && !(tile.water >= RICE_PLANT_WATER)) {
    return fail(`Rice needs a wet paddy: water ≥ ${RICE_PLANT_WATER} (this tile has ${tile.water.toFixed(2)}) — use_item(Items.Water) or wait for rain`);
  }
  if (!canAfford(state, info.cost)) {
    return fail(`Not enough items for ${type} seed (${costText(info.cost)})`);
  }
  pay(state, info.cost);
  tile.entity = makeEntity(type, rng);
  return ok;
}

export function till(state) {
  if (!isUnlocked(state, "Carrots")) return fail("till() is locked", "Carrots");
  const tile = droneTile(state);
  tile.ground = tile.ground === "Soil" ? "Grassland" : "Soil";
  removeEntity(tile);
  return ok;
}

// swap() does NOT wrap around edges (returns false there).
export function swap(state, dir) {
  if (!isUnlocked(state, "Cactus")) return fail("swap() is locked", "Cactus");
  const { x, y } = state.drone;
  const n = neighbor(state, x, y, dir, false);
  if (!n) return fail("swap() can't cross the farm edge");
  const a = tileAt(state, x, y);
  const b = tileAt(state, n.x, n.y);
  [a.entity, b.entity] = [b.entity, a.entity];
  a.regrow = 0;
  b.regrow = 0;
  return ok;
}

export function clearFarm(state) {
  state.tiles = Array.from({ length: state.size * state.size }, newTile);
  state.drone.x = 0;
  state.drone.y = 0;
}

export function useItem(state, item, n = 1, rng = Math.random) {
  n = Math.max(1, Math.floor(n));
  const tile = droneTile(state);
  if (item === "Water") {
    if (!isUnlocked(state, "Watering")) return fail("Water is locked", "Watering");
    if (state.items.Water < n) return fail("Not enough Water");
    state.items.Water -= n;
    tile.water = Math.min(1, tile.water + WATER_PER_USE * n);
    return ok;
  }
  if (item === "Fertilizer") {
    if (!isUnlocked(state, "Fertilizer")) return fail("Fertilizer is locked", "Fertilizer");
    if (state.items.Fertilizer < n) return fail("Not enough Fertilizer");
    const e = tile.entity;
    if (!e || isGrown(e)) return fail("Nothing growing here");
    state.items.Fertilizer -= n;
    const gt = effectiveGrowTime(state, state.drone.x, state.drone.y) || 1;
    e.progress += (FERTILIZER_SECONDS * n) / gt;
    if (e.progress >= 1) mature(tile, rng);
    return ok;
  }
  return fail(`Can't use ${String(item)}`);
}

// trade(item, n): pay `cost` × n, get `gives` × n. Fertilizer and Water are
// bought (you get the item); Rice is sold (you pay the Rice, get Gold).
export const TRADES = {
  Fertilizer: { cost: FERTILIZER_PRICE, gives: { Fertilizer: 1 }, unlock: "Fertilizer" },
  Water: { cost: WATER_PRICE, gives: { Water: 1 }, unlock: "Watering" },
  Rice: { cost: { Rice: 1 }, gives: { Gold: RICE_GOLD }, unlock: "Rice" },
};

const times = (bag, n) => Object.fromEntries(Object.entries(bag).map(([k, v]) => [k, v * n]));

export function trade(state, item, n = 1) {
  n = Math.max(1, Math.floor(n));
  const t = Object.hasOwn(TRADES, item) ? TRADES[item] : null;
  if (!t) return fail(`Can't trade ${String(item)} (only ${Object.keys(TRADES).join(", ")})`);
  if (!isUnlocked(state, t.unlock)) return fail(`${item} is locked`, t.unlock);
  const cost = times(t.cost, n);
  if (!canAfford(state, cost)) return fail(`Not enough items (${costText(cost)})`);
  pay(state, cost);
  for (const [k, v] of Object.entries(times(t.gives, n))) add(state, k, v);
  return ok;
}

// ---------- unlocks ----------

export function unlockCost(state, id) {
  const u = UNLOCK_BY_ID[id];
  if (!u) return null;
  const l = level(state, id);
  if (l >= u.maxLevel) return null;
  return u.cost(l);
}

export function unlockStatus(state, id) {
  const u = UNLOCK_BY_ID[id];
  const l = level(state, id);
  if (l >= u.maxLevel) return "maxed";
  if (u.requires && !isUnlocked(state, u.requires)) return "blocked";
  return canAfford(state, u.cost(l)) ? "affordable" : "expensive";
}

export function buyUnlock(state, id) {
  const u = UNLOCK_BY_ID[id];
  if (!u) return fail(`Unknown unlock ${String(id)}`);
  const status = unlockStatus(state, id);
  if (status === "maxed") return fail(`${u.name} is maxed`);
  if (status === "blocked") return fail(`${u.name} needs ${UNLOCK_BY_ID[u.requires].name} first`, u.requires);
  const cost = u.cost(level(state, id));
  if (!canAfford(state, cost)) return fail(`Not enough items for ${u.name} (${costText(cost)})`);
  pay(state, cost);
  state.unlocks[id] = level(state, id) + 1;
  if (id === "Expand") {
    state.size = WORLD_SIZES[state.unlocks.Expand];
    clearFarm(state); // expanding clears the farm
  }
  return ok;
}

export const costText = (cost) => priceText(cost || {});

// ---------- senses ----------

// A Sunflower's petals or a Cactus's size, here or on the neighbour in `dir`
// (wrapping like move()); null for anything else.
export function measure(state, dir) {
  let { x, y } = state.drone;
  if (dir !== undefined && dir !== null) {
    const n = neighbor(state, x, y, dir);
    if (!n) return null;
    ({ x, y } = n);
  }
  const e = tileAt(state, x, y).entity;
  if (!e) return null;
  if (e.type === "Sunflower") return e.petals;
  if (e.type === "Cactus") return e.size;
  return null;
}

// ---------- drones (Megafarm) ----------

/**
 * Run `fn(state)` with `state.drone` pointing at `drone` (the drone that
 * called the API), so every world function acts on the caller's tile without
 * knowing about multiple drones. World functions are synchronous, so the swap
 * can't leak. `drone` 0 / null → plain call.
 */
export function withDrone(state, drone, fn) {
  const home = state.drone;
  if (!drone || drone === home) return fn(state);
  state.drone = drone;
  try {
    return fn(state);
  } finally {
    state.drone = home;
  }
}

/** Megafarm drone cap for this farm (see maxDrones in constants.js). */
export const droneCap = (state) => maxDrones(state.size);

/**
 * Add a drone on the tile of `state.drone` (the caller, under withDrone).
 * Returns { ok, drone, index } or a failure (locked / at the cap).
 */
export function spawnDrone(state) {
  if (!isUnlocked(state, "Megafarm")) return fail("spawn_bot() is locked", "Megafarm");
  const drones = ensureDrones(state);
  const cap = droneCap(state);
  if (drones.length >= cap) return fail(`already ${drones.length} bots — the cap is ${cap} on a ${state.size}×${state.size} farm`);
  const d = newDrone(state.drone.x, state.drone.y);
  drones.push(d);
  return { ok: true, drone: d, index: drones.length - 1 };
}

/** Dismiss every drone except drone 0 (a new Run starts with one drone). */
export function resetDrones(state) {
  state.drones = [state.drones?.[0] ?? state.drone];
  state.drone = state.drones[0];
}

function ensureDrones(state) {
  if (!Array.isArray(state.drones) || !state.drones.length) state.drones = [state.drone];
  return state.drones;
}

// ---------- persistence ----------

export function serialize(state) {
  return {
    v: 1,
    size: state.size,
    drone: { x: state.drone.x, y: state.drone.y },
    // Megafarm: every drone's position, drone 0 first (`drone` above is kept
    // for older readers). Programs never persist, so drones load idle.
    drones: allDrones(state).map((d) => [d.x, d.y]),
    items: { ...state.items },
    unlocks: { ...state.unlocks },
    waterTimer: state.waterTimer,
    // v3: save-level stats (the contract totals; see records.js). BRIEF22:
    // the maze / dinosaur records and the replay seeds are gone.
    records: sanitizeRecords(state.records),
    // v3 phase 2: farm clock + today's contracts. A demo farm's contracts are
    // only for show and never persisted (the demo is never saved anyway).
    clock: Math.floor(farmClock(state)),
    contracts: state.demo ? null : sanitizeContracts(state.contracts),
    // v3 phase 3: arena rating + match history (own section, not in records).
    arena: state.demo ? null : sanitizeArena(state.arena),
    // v3 phase 4: weather seed + clock. The demo's weather is not persisted.
    weather: state.demo ? null : WX.sanitizeWeather(state.weather),
    // progress (0..1) is stored directly, so growth survives a reload.
    tiles: state.tiles.map((t) => ({
      g: t.ground === "Soil" ? "S" : "G",
      w: Math.round(t.water * 1000) / 1000,
      e: t.entity ? { ...t.entity } : null,
    })),
  };
}

// BRIEF22 (Mazes and Dinosaurs removed): a save written before it loads like
// any other; whatever it holds of them is simply not read back. The Mazes /
// Dinosaurs levels and the Bone in the store room are dropped (only today's
// unlocks and items are read), so are the maze / dinosaur records and the
// replay seeds (records.js), and the save's `maze` / `dino` sections. A tile
// with a Hedge, the Treasure, a dinosaur segment or an Apple loads as bare
// ground (its ground and water as saved; Grassland grows grass again).
// Nothing is refunded. Unknown entity types have always loaded this way.
export function deserialize(data) {
  const base = createGame();
  // Weather is save-level too; a garbage / missing save is a new save.
  base.weather = restoreWeather(data);
  if (!data || data.v !== 1) return base;
  // Records, the farm clock and contracts survive even if the farm part of
  // the save is unusable (they are save-level, like the records).
  base.records = sanitizeRecords(data.records);
  base.clock = Math.floor(farmClock(data));
  base.contracts = sanitizeContracts(data.contracts);
  base.arena = sanitizeArena(data.arena);
  const size = Number(data.size);
  if (!WORLD_SIZES.includes(size)) return base;
  if (!Array.isArray(data.tiles) || data.tiles.length !== size * size) return base;
  const state = base;
  for (const k of Object.keys(state.items)) {
    const v = Number(data.items?.[k]);
    state.items[k] = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }
  for (const u of UNLOCKS) {
    const v = Number(data.unlocks?.[u.id]);
    state.unlocks[u.id] = Number.isFinite(v) ? Math.max(0, Math.min(u.maxLevel, Math.floor(v))) : 0;
  }
  // The farm size always follows the Expand level.
  state.size = WORLD_SIZES[state.unlocks.Expand];
  if (state.size !== size) {
    state.tiles = Array.from({ length: state.size * state.size }, newTile);
  } else {
    state.tiles = data.tiles.map((t) => {
      const tile = newTile();
      tile.ground = t?.g === "S" ? "Soil" : "Grassland";
      tile.water = Math.max(0, Math.min(1, Number(t?.w) || 0));
      if (t?.e && Object.hasOwn(ENTITY_INFO, t.e.type)) {
        tile.entity = { ...t.e, progress: Math.max(0, Math.min(1, Number(t.e.progress) || 0)) };
        if (tile.entity.type === "Rice") restoreRice(tile.entity);
      }
      return tile;
    });
  }
  const dx = Number(data.drone?.x);
  const dy = Number(data.drone?.y);
  state.drone.x = Number.isInteger(dx) && dx >= 0 && dx < state.size ? dx : 0;
  state.drone.y = Number.isInteger(dy) && dy >= 0 && dy < state.size ? dy : 0;
  restoreDrones(state, data.drones);
  state.waterTimer = Number(data.waterTimer) || 0;
  return state;
}

// A saved growing rice plant keeps its dry-tick count (clamped; junk → 0).
// Ripe rice has none. Saves from before Rice simply have no rice tiles.
function restoreRice(e) {
  const d = Number(e.dry);
  if (e.progress >= 1) delete e.dry;
  else e.dry = Number.isFinite(d) && d >= 0 ? Math.min(d, RICE_WITHER_TICKS) : 0;
}

// The save's weather section. A save written before weather has no
// `weather` key (and garbage / missing data is a new save): it gets its seed
// now, on first load, and keeps it from then on. An explicit `weather: null`
// (a weatherless world serialized on purpose) stays weatherless.
function restoreWeather(data) {
  if (data && typeof data === "object" && data.weather === null) return null;
  return WX.sanitizeWeather(data?.weather) ?? WX.newWeather();
}

// Extra drones from `drones: [[x, y], …]` (entry 0 is drone 0, already loaded
// from `drone`). Out-of-bounds or malformed entries are dropped, and the list
// is cut to the farm's drone cap. Old saves have no list → one drone.
function restoreDrones(state, list) {
  state.drones = [state.drone];
  if (!Array.isArray(list)) return;
  const inside = (v) => Number.isInteger(v) && v >= 0 && v < state.size;
  const cap = droneCap(state);
  for (const p of list.slice(1)) {
    if (state.drones.length >= cap) break;
    const x = Number(p?.[0]);
    const y = Number(p?.[1]);
    if (inside(x) && inside(y)) state.drones.push(newDrone(x, y));
  }
}
