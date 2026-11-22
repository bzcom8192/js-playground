// Semicolon Acres — pure world logic (no DOM, no timers). Unit-tested in node.
//
// Coordinates: x grows East, y grows North. tiles[y * size + x].
// Every mutating function returns either `true`/`false` (simple success) or a
// result object `{ ok, msg?, locked? }` so the runtime can log helpful hints.

import {
  APPLE_SPAWN_SECONDS,
  DEAD_PUMPKIN_CHANCE,
  DINO_STEP_SECONDS,
  DIR_DELTA,
  ENTITY_INFO,
  FERTILIZER_SECONDS,
  GRASS_REGROW_DELAY,
  ITEM_ORDER,
  RICE_DRY_WATER,
  RICE_GOLD,
  RICE_L2_GROWTH,
  RICE_PLANT_WATER,
  RICE_TICKS_PER_SEC,
  RICE_WITHER_TICKS,
  RICE_YIELD,
  UNLOCKS,
  UNLOCK_BY_ID,
  WATER_BASE_INTERVAL,
  WATER_DECAY_PER_SEC,
  WATER_PER_USE,
  WORLD_SIZES,
  appleCap,
  maxDrones,
} from "./constants.js";
import { generateSeededMaze, parseSeed, randomSeed, treasureDirection } from "./maze.js";
import { emptyRecords, sanitizeRecords } from "./records.js";
import { farmClock, sanitizeContracts } from "./contracts.js";
import { emptyArena, sanitizeArena } from "./arenaRating.js";
import * as WX from "./weather.js";

const ok = { ok: true };

// ---------- events ----------
// Score-relevant moments (maze spawned / solved, dinosaur harvested) are
// reported to whoever wraps the world call in withEvents (the runtime, which
// owns the tick/op counters and writes the records). World calls are
// synchronous, so one module-level sink is enough; outside withEvents the
// events are simply dropped.
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
    // Active maze: { treasure: { x, y }, seed, start: { x, y } } or null. Walls
    // are Hedge entities on the tiles. `seed` is null for a maze loaded from a
    // save written before seeded mazes.
    maze: null,
    // The dinosaur: { body: [{x, y}, …] (head first), dir, stepTimer, appleTimer } or null.
    // Every body tile holds a { type: "Dinosaur" } entity; apples are "Apple" entities.
    dino: null,
    // Personal records (see records.js) and the seed the next maze will use
    // (set from the Records window's "replay seed"; null = draw a random one).
    records: emptyRecords(),
    pendingSeed: null,
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
  if (state.maze) return;
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
      } else if (!e && tile.ground === "Grassland" && !state.maze) {
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
  if (state.dino) dinoTick(state, dt, rng);
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

// Where move(dir) would take the drone, or null if it can't go there:
// hedges are walls, and inside a maze the farm edge is a wall too (no wrap).
function moveTarget(state, dir) {
  const n = neighbor(state, state.drone.x, state.drone.y, dir, !state.maze);
  if (!n) return null;
  if (tileAt(state, n.x, n.y).entity?.type === "Hedge") return null;
  return n;
}

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
// otherwise it is the number of pumpkins in the group. × Pumpkins level.
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
//  Ungrown cacti are destroyed without yield. × Cactus level.
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
  if (!e || e.type === "Hedge") return false;
  if (e.type === "Treasure") return harvestTreasure(state);
  if (e.type === "Apple") return fail(APPLE_BLOCKED);
  if (e.type === "Dinosaur") return harvestDino(state, x, y);
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
      add(state, "Hay", 1 + level(state, "Grass"));
      break;
    case "Bush":
      add(state, "Wood", Math.max(1, level(state, "Trees")));
      break;
    case "Tree":
      add(state, "Wood", 5 * Math.max(1, level(state, "Trees")));
      break;
    case "Carrot":
      add(state, "Carrot", Math.max(1, level(state, "Carrots")));
      break;
    case "Pumpkin": {
      const group = pumpkinGroup(state, x, y);
      add(state, "Pumpkin", pumpkinYield(group) * Math.max(1, level(state, "Pumpkins")));
      for (const p of group) removeEntity(tileAt(state, p.x, p.y));
      break;
    }
    case "Sunflower": {
      const flowers = state.tiles
        .map((t) => t.entity)
        .filter((f) => f && f.type === "Sunflower");
      let power = Math.floor(Math.sqrt(flowers.length));
      const maxPetals = Math.max(...flowers.map((f) => f.petals || 0));
      if (flowers.length >= 10 && e.petals === maxPetals) power *= 8;
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
      add(state, "Cactus", amount * Math.max(1, level(state, "Cactus")));
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
  if (state.maze) return fail(MAZE_BLOCKED);
  if (!isUnlocked(state, "Plant")) return fail("plant() is locked", "Plant");
  if (info.unlock && !isUnlocked(state, info.unlock)) {
    return fail(`${type} is locked`, info.unlock);
  }
  const tile = droneTile(state);
  if (tile.entity && tile.entity.type !== "Grass") {
    return fail(`Tile already has ${tile.entity.type}`);
  }
  if (type === "Dinosaur" && state.dino) return fail("only one dinosaur per farm — harvest the old one first");
  if (info.soil && tile.ground !== "Soil") return fail(`${type} needs Soil — till() first`);
  if (type === "Rice" && !(tile.water >= RICE_PLANT_WATER)) {
    return fail(`Rice needs a wet paddy: water ≥ ${RICE_PLANT_WATER} (this tile has ${tile.water.toFixed(2)}) — use_item(Items.Water) or wait for rain`);
  }
  if (!canAfford(state, info.cost)) {
    return fail(`Not enough items for ${type} seed (${costText(info.cost)})`);
  }
  pay(state, info.cost);
  if (type === "Dinosaur") {
    hatchDino(state);
    return ok;
  }
  tile.entity = makeEntity(type, rng);
  return ok;
}

export function till(state) {
  if (!isUnlocked(state, "Carrots")) return fail("till() is locked", "Carrots");
  if (state.maze) return fail(MAZE_BLOCKED);
  const tile = droneTile(state);
  if (isDinoTile(tile)) return fail(DINO_BLOCKED);
  tile.ground = tile.ground === "Soil" ? "Grassland" : "Soil";
  removeEntity(tile);
  return ok;
}

// swap() does NOT wrap around edges (returns false there).
export function swap(state, dir) {
  if (!isUnlocked(state, "Cactus")) return fail("swap() is locked", "Cactus");
  if (state.maze) return fail(MAZE_BLOCKED);
  const { x, y } = state.drone;
  const n = neighbor(state, x, y, dir, false);
  if (!n) return fail("swap() can't cross the farm edge");
  const a = tileAt(state, x, y);
  const b = tileAt(state, n.x, n.y);
  if (isDinoTile(a) || isDinoTile(b)) return fail(DINO_BLOCKED);
  [a.entity, b.entity] = [b.entity, a.entity];
  a.regrow = 0;
  b.regrow = 0;
  return ok;
}

export function clearFarm(state) {
  state.tiles = Array.from({ length: state.size * state.size }, newTile);
  state.maze = null;
  state.dino = null;
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
    if (e?.type === "Bush" && isGrown(e) && isUnlocked(state, "Mazes")) {
      state.items.Fertilizer -= n;
      spawnMaze(state, rng);
      return ok;
    }
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
  Fertilizer: { cost: { Pumpkin: 1 }, gives: { Fertilizer: 1 }, unlock: "Fertilizer" },
  Water: { cost: { Carrot: 1 }, gives: { Water: 1 }, unlock: "Watering" },
  Rice: { cost: { Rice: 1 }, gives: { Gold: RICE_GOLD }, unlock: "Rice" },
};

const times = (bag, n) => Object.fromEntries(Object.entries(bag).map(([k, v]) => [k, v * n]));

export function trade(state, item, n = 1) {
  n = Math.max(1, Math.floor(n));
  const t = Object.hasOwn(TRADES, item) ? TRADES[item] : null;
  if (!t) return fail(`Can't trade ${String(item)} (only ${Object.keys(TRADES).join(", ")})`);
  if (!isUnlocked(state, t.unlock)) return fail(`${item} is locked`, t.unlock);
  if (state.maze) return fail(MAZE_BLOCKED);
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

export function costText(cost) {
  return Object.entries(cost || {})
    .map(([k, v]) => `${v} ${k}`)
    .join(" + ");
}

// ---------- senses ----------

export function measure(state, dir) {
  let { x, y } = state.drone;
  if (dir !== undefined && dir !== null) {
    const n = neighbor(state, x, y, dir, !state.maze);
    if (!n) return null;
    ({ x, y } = n);
  }
  if (state.maze) {
    const t = state.maze.treasure;
    return treasureDirection(x, y, t.x, t.y);
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

// Inside a maze no drone may stand on a hedge (it couldn't be told apart from
// being walled in). Any drone on a hedge moves to `to` (always a path tile).
function liftDronesOffHedges(state, to) {
  for (const d of allDrones(state)) {
    if (tileAt(state, d.x, d.y).entity?.type === "Hedge") {
      d.x = to.x;
      d.y = to.y;
    }
  }
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
    // Active maze (walls/treasure are entities on the tiles below).
    maze: state.maze
      ? {
          tx: state.maze.treasure.x,
          ty: state.maze.treasure.y,
          seed: state.maze.seed ?? null,
          sx: state.maze.start?.x ?? null,
          sy: state.maze.start?.y ?? null,
        }
      : null,
    // The dinosaur's body chain (head first) and its timers; segments and
    // apples are also entities on the tiles below.
    dino: state.dino
      ? {
          body: state.dino.body.map((p) => [p.x, p.y]),
          dir: state.dino.dir,
          st: state.dino.stepTimer,
          at: state.dino.appleTimer,
        }
      : null,
    // v3: personal records + the pending replay seed. Older saves have
    // neither and load with empty records.
    records: sanitizeRecords(state.records),
    pendingSeed: parseSeed(state.pendingSeed),
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
      if (t?.e && ENTITY_INFO[t.e.type]) {
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
  restoreMaze(state, data.maze);
  restoreDino(state, data.dino);
  state.records = sanitizeRecords(data.records);
  state.pendingSeed = parseSeed(data.pendingSeed);
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

// ---------- mazes ----------

const MAZE_BLOCKED = "not possible inside a maze — harvest the treasure (or clear()) first";

/** Mazes level → Gold per treasure: farm tiles (size²) × level. */
export const mazeGold = (state) => state.size * state.size * Math.max(1, level(state, "Mazes"));

/**
 * Turn the whole farm into a perfect hedge maze around the drone's tile.
 * The layout comes from a seed: the pending (replay) seed if one is set —
 * it is used once and cleared — otherwise a fresh random 32-bit seed drawn
 * from `rng`. Same seed + farm size + start tile → the same maze.
 */
export function spawnMaze(state, rng = Math.random) {
  const { x, y } = state.drone;
  const pending = parseSeed(state.pendingSeed);
  const seed = pending ?? randomSeed(rng);
  state.pendingSeed = null;
  const { walls, treasure } = generateSeededMaze(state.size, x, y, seed);
  state.tiles = walls.map((wall) => {
    const t = newTile();
    if (wall) t.entity = { type: "Hedge", progress: 1 };
    return t;
  });
  tileAt(state, treasure.x, treasure.y).entity = { type: "Treasure", progress: 1 };
  state.maze = { treasure: { ...treasure }, seed, start: { x, y } };
  emit({ type: "mazeSpawn", maze: state.maze, seed, replay: pending !== null, size: state.size, start: { x, y } });
  // Other drones (Megafarm) caught on a hedge join the drone that spawned it.
  liftDronesOffHedges(state, { x, y });
  // Simplest rule that can't corrupt either: a maze replaces the whole farm,
  // so the dinosaur and its apples are gone too (like clear()).
  state.dino = null;
}

function harvestTreasure(state) {
  const gold = mazeGold(state);
  add(state, "Gold", gold);
  emit({ type: "mazeSolve", maze: state.maze, level: Math.max(1, level(state, "Mazes")), size: state.size, gold });
  // The maze disappears; the farm is left as empty Grassland (drone stays put).
  state.tiles = Array.from({ length: state.size * state.size }, newTile);
  state.maze = null;
  return true;
}

// Accept a saved maze only if it is consistent with the loaded tiles;
// otherwise drop it and strip any stray maze entities.
function restoreMaze(state, m) {
  state.maze = null;
  const tx = Number(m?.tx);
  const ty = Number(m?.ty);
  const inside = (v) => Number.isInteger(v) && v >= 0 && v < state.size;
  if (m && inside(tx) && inside(ty) && tileAt(state, tx, ty).entity?.type === "Treasure" &&
      droneTile(state).entity?.type !== "Hedge") {
    const sx = Number(m.sx);
    const sy = Number(m.sy);
    state.maze = {
      treasure: { x: tx, y: ty },
      seed: parseSeed(m.seed),
      start: inside(sx) && inside(sy) ? { x: sx, y: sy } : null,
    };
    liftDronesOffHedges(state, state.drone);
    for (let i = 0; i < state.tiles.length; i++) {
      if (i !== idx(state, tx, ty) && state.tiles[i].entity?.type === "Treasure") state.tiles[i].entity = null;
    }
    return;
  }
  for (const t of state.tiles) {
    if (t.entity?.type === "Hedge" || t.entity?.type === "Treasure") t.entity = null;
  }
}

// ---------- dinosaurs ----------

const DINO_BLOCKED = "not possible on the dinosaur or an apple";
const APPLE_BLOCKED = "apples are for the dinosaur — it eats them by walking onto them";
const DIRS = ["North", "East", "South", "West"];

const isDinoTile = (tile) => tile.entity?.type === "Dinosaur" || tile.entity?.type === "Apple";

/** Bone for cutting off `k` segments: k² × Dinosaurs level. */
export const boneFor = (state, k) => k * k * Math.max(1, level(state, "Dinosaurs"));

/** Tiles the dinosaur's head may step onto: empty ground, Grass (trampled) or an Apple (eaten). */
function dinoCanEnter(tile) {
  const e = tile.entity;
  return !e || e.type === "Grass" || e.type === "Apple";
}

/** Index of (x, y) in the dinosaur's body (0 = head), or -1. */
export function dinoSegment(state, x, y) {
  if (!state.dino) return -1;
  return state.dino.body.findIndex((p) => p.x === x && p.y === y);
}

/** Valid head moves right now: [{ dir, x, y, eat }]. No wrap; never into the body or a hedge. */
export function dinoMoves(state) {
  if (!state.dino) return [];
  const head = state.dino.body[0];
  const out = [];
  for (const dir of DIRS) {
    const n = neighbor(state, head.x, head.y, dir, false);
    if (!n) continue;
    const tile = tileAt(state, n.x, n.y);
    if (!dinoCanEnter(tile)) continue;
    out.push({ dir, x: n.x, y: n.y, eat: tile.entity?.type === "Apple" });
  }
  return out;
}

function hatchDino(state) {
  const { x, y } = state.drone;
  const tile = tileAt(state, x, y);
  tile.entity = { type: "Dinosaur", progress: 1 };
  tile.regrow = 0;
  state.dino = { body: [{ x, y }], dir: "South", stepTimer: 0, appleTimer: 0 };
}

/**
 * One autonomous step: the head moves to a random valid neighbour. Eating an
 * apple grows the body by one (the tail stays); otherwise the tail follows.
 * With no valid move the dinosaur stays put. Returns true if it moved.
 */
export function dinoStep(state, rng = Math.random) {
  const moves = dinoMoves(state);
  if (!moves.length) return false;
  const m = moves[Math.min(moves.length - 1, Math.floor(rng() * moves.length))];
  const d = state.dino;
  const tile = tileAt(state, m.x, m.y);
  tile.entity = { type: "Dinosaur", progress: 1 };
  tile.regrow = 0;
  d.body.unshift({ x: m.x, y: m.y });
  d.dir = m.dir;
  if (!m.eat) {
    const tail = d.body.pop();
    removeEntity(tileAt(state, tail.x, tail.y));
  }
  return true;
}

/** Spawn one apple on a random empty (or grass) tile, if under the cap. */
export function spawnApple(state, rng = Math.random) {
  let apples = 0;
  const free = [];
  state.tiles.forEach((t, i) => {
    if (t.entity?.type === "Apple") apples++;
    else if (!t.entity || t.entity.type === "Grass") free.push(i);
  });
  if (apples >= appleCap(state.size) || !free.length) return false;
  const t = state.tiles[free[Math.min(free.length - 1, Math.floor(rng() * free.length))]];
  t.entity = { type: "Apple", progress: 1 };
  t.regrow = 0;
  return true;
}

function dinoTick(state, dt, rng) {
  const d = state.dino;
  d.appleTimer += dt;
  while (d.appleTimer >= APPLE_SPAWN_SECONDS) {
    d.appleTimer -= APPLE_SPAWN_SECONDS;
    spawnApple(state, rng);
  }
  d.stepTimer += dt;
  while (d.stepTimer >= DINO_STEP_SECONDS) {
    d.stepTimer -= DINO_STEP_SECONDS;
    dinoStep(state, rng);
  }
}

function removeApples(state) {
  for (const t of state.tiles) if (t.entity?.type === "Apple") removeEntity(t);
}

/**
 * Harvest the body segment at (x, y): it and everything behind it (toward the
 * tail) is cut off, paying (segments removed)² × level Bone. Cutting the head
 * removes the whole dinosaur (and its apples), so a new one can be planted.
 */
function harvestDino(state, x, y) {
  const i = dinoSegment(state, x, y);
  if (i < 0) {
    removeEntity(tileAt(state, x, y)); // stray segment (can't happen in a consistent state)
    return true;
  }
  const body = state.dino.body;
  const cut = body.splice(i);
  const bone = boneFor(state, cut.length);
  add(state, "Bone", bone);
  emit({ type: "dinoHarvest", bone, cut: cut.length, level: Math.max(1, level(state, "Dinosaurs")) });
  for (const p of cut) removeEntity(tileAt(state, p.x, p.y));
  if (!body.length) {
    state.dino = null;
    removeApples(state);
  }
  return true;
}

// Accept a saved dinosaur only if its chain is consistent with the tiles
// (in bounds, unique, each segment next to the one before, every segment tile
// holds a Dinosaur, no maze). Otherwise drop it with its apples.
function restoreDino(state, d) {
  state.dino = null;
  const n = state.size;
  const raw = Array.isArray(d?.body) ? d.body : null;
  const body = raw ? raw.map((p) => ({ x: Number(p?.[0]), y: Number(p?.[1]) })) : [];
  const inside = (v) => Number.isInteger(v) && v >= 0 && v < n;
  const seen = new Set();
  let valid = !state.maze && body.length > 0;
  for (let i = 0; valid && i < body.length; i++) {
    const p = body[i];
    if (!inside(p.x) || !inside(p.y) || seen.has(idx(state, p.x, p.y))) valid = false;
    else if (tileAt(state, p.x, p.y).entity?.type !== "Dinosaur") valid = false;
    else if (i > 0 && Math.abs(p.x - body[i - 1].x) + Math.abs(p.y - body[i - 1].y) !== 1) valid = false;
    else seen.add(idx(state, p.x, p.y));
  }
  if (valid) {
    const timer = (v, max) => {
      const t = Number(v);
      return Number.isFinite(t) && t >= 0 && t < max ? t : 0;
    };
    state.dino = {
      body,
      dir: DIRS.includes(d.dir) ? d.dir : "South",
      stepTimer: timer(d.st, DINO_STEP_SECONDS),
      appleTimer: timer(d.at, APPLE_SPAWN_SECONDS),
    };
  }
  state.tiles.forEach((t, i) => {
    const type = t.entity?.type;
    if (type !== "Dinosaur" && type !== "Apple") return;
    const keep = valid && (type === "Apple" || seen.has(i));
    t.entity = keep ? { type, progress: 1 } : null;
  });
}
