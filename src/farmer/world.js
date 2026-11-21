// JS Farmer — pure world logic (no DOM, no timers). Unit-tested in node.
//
// Coordinates: x grows East, y grows North. tiles[y * size + x].
// Every mutating function returns either `true`/`false` (simple success) or a
// result object `{ ok, msg?, locked? }` so the runtime can log helpful hints.

import {
  DEAD_PUMPKIN_CHANCE,
  DIR_DELTA,
  ENTITY_INFO,
  FERTILIZER_SECONDS,
  GRASS_REGROW_DELAY,
  ITEM_ORDER,
  UNLOCKS,
  UNLOCK_BY_ID,
  WATER_BASE_INTERVAL,
  WATER_DECAY_PER_SEC,
  WATER_PER_USE,
  WORLD_SIZES,
} from "./constants.js";
import { generateMaze, treasureDirection } from "./maze.js";

const ok = { ok: true };
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
  return e;
}

export function createGame() {
  const state = {
    size: 1,
    tiles: [newTile()],
    drone: { x: 0, y: 0, flips: 0 },
    items: Object.fromEntries(ITEM_ORDER.map((k) => [k, 0])),
    unlocks: Object.fromEntries(UNLOCKS.map((u) => [u.id, 0])),
    waterTimer: 0,
    // Active maze: { treasure: { x, y } } or null. Walls are Hedge entities on the tiles.
    maze: null,
  };
  // TFWR start: a single grassland tile with grass on it.
  state.tiles[0].entity = makeEntity("Grass", Math.random, 1);
  return state;
}

// ---------- helpers ----------

export const level = (state, id) => state.unlocks[id] || 0;
export const isUnlocked = (state, id) => level(state, id) >= 1;
export const idx = (state, x, y) => y * state.size + x;
export const tileAt = (state, x, y) => state.tiles[idx(state, x, y)];
export const droneTile = (state) => tileAt(state, state.drone.x, state.drone.y);
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
}

// ---------- real-time simulation ----------

// Advance the world by dt seconds. Growth multiplier = 1 + 4 × water (1×…5×).
export function tick(state, dt, rng = Math.random) {
  const n = state.size;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tile = tileAt(state, x, y);
      const e = tile.entity;
      if (e && e.progress < 1) {
        const rate = 1 + 4 * tile.water;
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
        tile.water = Math.max(0, tile.water - WATER_DECAY_PER_SEC * dt);
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
  if (!isGrown(e)) {
    // Deviation: unripe Grass is left alone (returns false) so the very first
    // `while (true) { harvest(); }` program works at any speed.
    if (e.type === "Grass") return false;
    // TFWR: harvesting any other unripe plant just destroys it.
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
    default: // Dead_Pumpkin and anything else: just cleared
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
  if (info.soil && tile.ground !== "Soil") return fail(`${type} needs Soil — till() first`);
  if (!canAfford(state, info.cost)) {
    return fail(`Not enough items for ${type} seed (${costText(info.cost)})`);
  }
  pay(state, info.cost);
  tile.entity = makeEntity(type, rng);
  return ok;
}

export function till(state) {
  if (!isUnlocked(state, "Carrots")) return fail("till() is locked", "Carrots");
  if (state.maze) return fail(MAZE_BLOCKED);
  const tile = droneTile(state);
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
  [a.entity, b.entity] = [b.entity, a.entity];
  a.regrow = 0;
  b.regrow = 0;
  return ok;
}

export function clearFarm(state) {
  state.tiles = Array.from({ length: state.size * state.size }, newTile);
  state.maze = null;
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
    if (e.progress >= 1) mature(tile, Math.random);
    return ok;
  }
  return fail(`Can't use ${String(item)}`);
}

export const TRADES = {
  Fertilizer: { cost: { Pumpkin: 1 }, unlock: "Fertilizer" },
  Water: { cost: { Carrot: 1 }, unlock: "Watering" },
};

export function trade(state, item, n = 1) {
  n = Math.max(1, Math.floor(n));
  const t = TRADES[item];
  if (!t) return fail(`Can't trade for ${String(item)} (only Fertilizer, Water)`);
  if (!isUnlocked(state, t.unlock)) return fail(`${item} is locked`, t.unlock);
  if (state.maze) return fail(MAZE_BLOCKED);
  const cost = Object.fromEntries(Object.entries(t.cost).map(([k, v]) => [k, v * n]));
  if (!canAfford(state, cost)) return fail(`Not enough items (${costText(cost)})`);
  pay(state, cost);
  add(state, item, n);
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
  if (status === "blocked") return fail(`${u.name} needs ${u.requires} first`, u.requires);
  const cost = u.cost(level(state, id));
  if (!canAfford(state, cost)) return fail(`Not enough items for ${u.name} (${costText(cost)})`);
  pay(state, cost);
  state.unlocks[id] = level(state, id) + 1;
  if (id === "Expand") {
    state.size = WORLD_SIZES[state.unlocks.Expand];
    clearFarm(state); // TFWR: expanding clears the farm
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

// ---------- persistence ----------

export function serialize(state) {
  return {
    v: 1,
    size: state.size,
    drone: { x: state.drone.x, y: state.drone.y },
    items: { ...state.items },
    unlocks: { ...state.unlocks },
    waterTimer: state.waterTimer,
    // Active maze (walls/treasure are entities on the tiles below).
    maze: state.maze ? { tx: state.maze.treasure.x, ty: state.maze.treasure.y } : null,
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
  if (!data || data.v !== 1) return base;
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
      }
      return tile;
    });
  }
  const dx = Number(data.drone?.x);
  const dy = Number(data.drone?.y);
  state.drone.x = Number.isInteger(dx) && dx >= 0 && dx < state.size ? dx : 0;
  state.drone.y = Number.isInteger(dy) && dy >= 0 && dy < state.size ? dy : 0;
  state.waterTimer = Number(data.waterTimer) || 0;
  restoreMaze(state, data.maze);
  return state;
}

// ---------- mazes ----------

const MAZE_BLOCKED = "not possible inside a maze — harvest the treasure (or clear()) first";

/** Mazes level → Gold per treasure: farm tiles (size²) × level. */
export const mazeGold = (state) => state.size * state.size * Math.max(1, level(state, "Mazes"));

/** Turn the whole farm into a perfect hedge maze around the drone's tile. */
export function spawnMaze(state, rng = Math.random) {
  const { x, y } = state.drone;
  const { walls, treasure } = generateMaze(state.size, x, y, rng);
  state.tiles = walls.map((wall) => {
    const t = newTile();
    if (wall) t.entity = { type: "Hedge", progress: 1 };
    return t;
  });
  tileAt(state, treasure.x, treasure.y).entity = { type: "Treasure", progress: 1 };
  state.maze = { treasure: { ...treasure } };
}

function harvestTreasure(state) {
  add(state, "Gold", mazeGold(state));
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
    state.maze = { treasure: { x: tx, y: ty } };
    for (let i = 0; i < state.tiles.length; i++) {
      if (i !== idx(state, tx, ty) && state.tiles[i].entity?.type === "Treasure") state.tiles[i].entity = null;
    }
    return;
  }
  for (const t of state.tiles) {
    if (t.entity?.type === "Hedge" || t.entity?.type === "Treasure") t.entity = null;
  }
}
