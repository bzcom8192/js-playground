// Semicolon Acres — game constants and data tables.
// Pure data, no DOM dependencies (imported by node tests too).

export const Entities = Object.freeze({
  Grass: "Grass",
  Bush: "Bush",
  Tree: "Tree",
  Carrot: "Carrot",
  Pumpkin: "Pumpkin",
  Sunflower: "Sunflower",
  Cactus: "Cactus",
  Dead_Pumpkin: "Dead_Pumpkin",
  Hedge: "Hedge",
  Treasure: "Treasure",
  Dinosaur: "Dinosaur",
  Apple: "Apple",
  Rice: "Rice",
  Dead_Rice: "Dead_Rice",
});

export const Items = Object.freeze({
  Hay: "Hay",
  Wood: "Wood",
  Carrot: "Carrot",
  Pumpkin: "Pumpkin",
  Power: "Power",
  Cactus: "Cactus",
  Fertilizer: "Fertilizer",
  Water: "Water",
  Gold: "Gold",
  Bone: "Bone",
  Rice: "Rice",
});

export const Grounds = Object.freeze({
  Grassland: "Grassland",
  Soil: "Soil",
});

export const Unlocks = Object.freeze({
  Speed: "Speed",
  Expand: "Expand",
  Plant: "Plant",
  Senses: "Senses",
  Grass: "Grass",
  Carrots: "Carrots",
  Trees: "Trees",
  Watering: "Watering",
  Pumpkins: "Pumpkins",
  Sunflowers: "Sunflowers",
  Fertilizer: "Fertilizer",
  Cactus: "Cactus",
  Mazes: "Mazes",
  Dinosaurs: "Dinosaurs",
  Megafarm: "Megafarm",
  Rice: "Rice",
});

// Directions are plain strings; dx/dy follow "x grows East, y grows North".
export const Directions = Object.freeze({
  North: "North",
  East: "East",
  South: "South",
  West: "West",
});

export const DIR_DELTA = Object.freeze({
  North: [0, 1],
  East: [1, 0],
  South: [0, -1],
  West: [-1, 0],
});

export const ITEM_ORDER = [
  "Hay",
  "Wood",
  "Carrot",
  "Pumpkin",
  "Power",
  "Cactus",
  "Rice",
  "Fertilizer",
  "Water",
  "Gold",
  "Bone",
];

export const ITEM_ICONS = {
  Hay: "🌾",
  Wood: "🪵",
  Carrot: "🥕",
  Pumpkin: "🎃",
  Power: "⚡",
  Cactus: "🌵",
  Fertilizer: "🧪",
  Water: "💧",
  Gold: "🪙",
  Bone: "🦴",
  Rice: "🌾",
};

// Per-entity rules. growTime is in seconds at water level 0.
// unlock: the Unlocks entry required to plant it (null = always).
// soil: true if it can only be planted on Soil.
// cost: seed cost auto-deducted by plant().
export const ENTITY_INFO = {
  Grass: { icon: "🌱", growTime: 1, unlock: "Plant", soil: false, cost: {} },
  Bush: { icon: "🌿", growTime: 4, unlock: "Plant", soil: false, cost: {} },
  Tree: { icon: "🌳", growTime: 7, unlock: "Trees", soil: false, cost: {} },
  Carrot: {
    icon: "🥕",
    growTime: 6,
    unlock: "Carrots",
    soil: true,
    cost: { Wood: 1, Hay: 1 },
  },
  Pumpkin: {
    icon: "🎃",
    growTime: 3,
    unlock: "Pumpkins",
    soil: true,
    cost: { Carrot: 1 },
  },
  Sunflower: {
    icon: "🌻",
    growTime: 5,
    unlock: "Sunflowers",
    soil: true,
    cost: { Carrot: 1 },
  },
  Cactus: {
    icon: "🌵",
    growTime: 2,
    unlock: "Cactus",
    soil: true,
    cost: { Pumpkin: 1 },
  },
  Dead_Pumpkin: {
    icon: "🎃",
    growTime: 0,
    unlock: null,
    soil: true,
    cost: null,
  },
  // Maze tiles: created only by spawning a maze, never planted (cost: null).
  Hedge: { icon: "🟩", growTime: 0, unlock: "Mazes", soil: false, cost: null },
  Treasure: { icon: "💰", growTime: 0, unlock: "Mazes", soil: false, cost: null },
  // Dinosaur: plant() hatches the (single) dinosaur; every body tile holds one.
  // Apples only spawn by themselves while a dinosaur is alive (cost: null).
  Dinosaur: { icon: "🦖", growTime: 0, unlock: "Dinosaurs", soil: false, cost: { Gold: 10 } },
  Apple: { icon: "🍎", growTime: 0, unlock: "Dinosaurs", soil: false, cost: null },
  // Rice (v3 phase 5): a paddy crop. Soil with water ≥ RICE_PLANT_WATER to
  // plant; withers into Dead_Rice when kept dry (see the RICE_* knobs below).
  Rice: {
    icon: "🌾",
    growTime: 9, // 1.5× the Carrot's 6 s
    unlock: "Rice",
    soil: true,
    cost: { Carrot: 1 },
  },
  Dead_Rice: { icon: "🌾", growTime: 0, unlock: null, soil: true, cost: null },
};

// World sizes per Expand level (max 12×12).
export const WORLD_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];

// Tuning knobs.
export const GRASS_REGROW_DELAY = 0.5; // s an empty Grassland tile waits before new grass sprouts
export const WATER_DECAY_PER_SEC = 0.02; // tile water level lost per second (linear)
export const WATER_PER_USE = 0.25;
export const FERTILIZER_SECONDS = 2;
export const DEAD_PUMPKIN_CHANCE = 0.2;
export const WATER_BASE_INTERVAL = 10; // s per Water item at Watering level 1
export const DINO_STEP_SECONDS = 0.3; // game seconds per dinosaur step (3 world ticks of 100 ms)
export const APPLE_SPAWN_SECONDS = 1.5; // game seconds between apple spawns while a dinosaur lives
// Rice (v3 phase 5). Ticks here are world ticks (0.1 s of farm time, the same
// tick the weather counts — see weather.js), so 200 ticks = 20 s.
export const RICE_PLANT_WATER = 0.5; // plant(Rice) needs tile water ≥ this
export const RICE_DRY_WATER = 0.2; // a growing rice tile below this is "dry" (and stops growing)
export const RICE_WITHER_TICKS = 200; // dry for MORE than this many consecutive ticks → Dead_Rice
export const RICE_TICKS_PER_SEC = 10; // world ticks per second (= weather.js WEATHER_TICKS_PER_SEC)
export const RICE_YIELD = [0, 3, 5]; // Rice per harvested plant, by Rice level (L1 3, L2 5)
export const RICE_L2_GROWTH = 1.5; // Rice L2 grows 1.5× faster (9 s → 6 s)
export const RICE_GOLD = 2; // trade(Items.Rice): 1 Rice → 2 Gold
/** Max apples on the farm at once: one per 16 tiles, at least 1 (12×12 → 9). */
export const appleCap = (size) => Math.max(1, Math.floor((size * size) / 16));

const scale = (base, factor, level) => Math.round(base * factor ** level);

// UNLOCKS — single data-driven table. `id` is what programs, saves and the
// server use (never rename it); `name` and `desc` are what the Workshop shows.
// cost(level) returns the cost to go from `level` to `level + 1`.
// requires: other unlock id that must be at level ≥ 1 first.
export const UNLOCKS = [
  {
    id: "Speed",
    name: "Overclock",
    icon: "⏩",
    desc: "A faster clock for the whole crew: every level doubles the bots' pace.",
    requires: null,
    maxLevel: 5,
    cost: (l) => ({ Hay: scale(20, 3, l) }),
  },
  {
    id: "Expand",
    name: "New Acres",
    icon: "🗺️",
    desc: "Buy the land next door. Farm side: 1→2→3→4→5→6→7→8→10→12. The surveyors flatten everything that was growing.",
    requires: null,
    maxLevel: WORLD_SIZES.length - 1,
    cost: (l) =>
      [
        { Hay: 30 },
        { Wood: 20 },
        { Wood: 40, Carrot: 20 },
        { Wood: 80, Carrot: 50 },
        { Wood: 150, Carrot: 100 },
        { Wood: 300, Pumpkin: 100 },
        { Wood: 500, Pumpkin: 300 },
        { Wood: 1000, Pumpkin: 1000 },
        { Wood: 2000, Pumpkin: 2000, Cactus: 200 },
      ][l],
  },
  {
    id: "Plant",
    name: "Seed Hopper",
    icon: "🌿",
    desc: "Fits the bot with a planter: plant(), and Bushes to cut for Wood.",
    requires: null,
    maxLevel: 1,
    cost: () => ({ Hay: 10 }),
  },
  {
    id: "Senses",
    name: "Sensor Mast",
    icon: "👁️",
    desc: "Lets programs look around: can_harvest(), get_entity_type(), get_ground_type(), get_pos_x/y(), measure(), get_water().",
    requires: null,
    maxLevel: 1,
    cost: () => ({ Hay: 15 }),
  },
  {
    id: "Grass",
    name: "Meadow Mix",
    icon: "🌾",
    desc: "Denser grass. Each cut brings ×(level + 1) Hay.",
    requires: "Plant",
    maxLevel: 5,
    cost: (l) => ({ Hay: scale(40, 3, l) }),
  },
  {
    id: "Carrots",
    name: "Plough Blade",
    icon: "🥕",
    desc: "till() opens Soil, and Carrots go in it (seed: 1 Wood + 1 Hay). Carrot yield ×level.",
    requires: "Plant",
    maxLevel: 5,
    cost: (l) =>
      l === 0
        ? { Wood: 50 }
        : { Wood: scale(100, 3, l - 1), Carrot: scale(50, 3, l - 1) },
  },
  {
    id: "Trees",
    name: "Woodlot",
    icon: "🌳",
    desc: "Trees give 5 Wood each, but every tree standing right next door doubles the growing time. Wood yield ×level.",
    requires: "Carrots",
    maxLevel: 5,
    cost: (l) =>
      l === 0
        ? { Hay: 100, Wood: 50 }
        : { Wood: scale(200, 3, l - 1), Carrot: scale(50, 3, l - 1) },
  },
  {
    id: "Watering",
    name: "Rain Barrel",
    icon: "💧",
    desc: "Collects 1 Water every 10 s per level, up to 5 + 5×level. Pour it with use_item(Items.Water): wet tiles grow faster.",
    requires: "Carrots",
    maxLevel: 3,
    cost: (l) => ({ Wood: scale(100, 3, l), Carrot: scale(50, 3, l) }),
  },
  {
    id: "Pumpkins",
    name: "Pumpkin Patch",
    icon: "🎃",
    desc: "Pumpkins for Soil (seed: 1 Carrot). Ripe ones in a solid k×k block fuse and pay k³. Yield ×level.",
    requires: "Carrots",
    maxLevel: 5,
    cost: (l) =>
      l === 0
        ? { Carrot: 200 }
        : { Carrot: scale(300, 3, l - 1), Pumpkin: scale(100, 3, l - 1) },
  },
  {
    id: "Sunflowers",
    name: "Sunflower Chargers",
    icon: "🌻",
    desc: "Sunflowers for Soil (seed: 1 Carrot) turn daylight into Power, and a powered action takes half the time.",
    requires: "Pumpkins",
    maxLevel: 1,
    cost: () => ({ Pumpkin: 100 }),
  },
  {
    id: "Fertilizer",
    name: "Compost Press",
    icon: "🧪",
    desc: "The market sells Fertilizer: trade(Items.Fertilizer), 1 Pumpkin each. One dose is worth 2 s of growth.",
    requires: "Pumpkins",
    maxLevel: 1,
    cost: () => ({ Pumpkin: 100 }),
  },
  {
    id: "Rice",
    name: "Flooded Paddy",
    icon: "🌾",
    desc: "Rice for wet Soil (water ≥ 0.5, seed: 1 Carrot): 3 per plant, 5 at level 2, which also ripens 1.5× faster. 20 s below 0.2 water ruins it. trade(Items.Rice) pays 2 Gold each.",
    requires: "Pumpkins",
    maxLevel: 2,
    cost: (l) => (l === 0 ? { Pumpkin: 1500, Carrot: 500 } : { Pumpkin: 3000, Gold: 150 }),
  },
  {
    id: "Cactus",
    name: "Cactus Bench",
    icon: "🌵",
    desc: "Cactus for Soil (seed: 1 Pumpkin), and swap() to rearrange it. In perfect size order n plants pay n². Yield ×level.",
    requires: "Pumpkins",
    maxLevel: 3,
    cost: (l) =>
      l === 0
        ? { Pumpkin: 200 }
        : { Pumpkin: scale(500, 3, l - 1), Cactus: scale(100, 3, l - 1) },
  },
  {
    id: "Mazes",
    name: "Hedge Labyrinth",
    icon: "🧩",
    desc: "Fertilizer on a full-grown Bush sends hedges over the whole farm. Find the treasure inside: Gold = farm tiles × level.",
    requires: "Cactus",
    maxLevel: 3,
    cost: (l) =>
      l === 0
        ? { Cactus: 2000, Pumpkin: 2000 }
        : { Cactus: scale(6000, 3, l - 1), Gold: scale(300, 3, l - 1) },
  },
  {
    id: "Dinosaurs",
    name: "Dinosaur Egg",
    icon: "🦕",
    desc: "plant(Entities.Dinosaur) for 10 Gold. It wanders, eats apples and gets longer; cut it anywhere for Bone = (segments cut)² × level.",
    requires: "Mazes",
    maxLevel: 3,
    cost: (l) =>
      l === 0
        ? { Gold: 600, Cactus: 6000 }
        : { Gold: scale(1800, 3, l - 1), Bone: scale(1000, 3, l - 1) },
  },
  {
    id: "Megafarm",
    name: "Bot Crew",
    icon: "🏭",
    desc: "spawn_bot() puts another bot on your tile with the same program. One per farm column at most (12 on 12×12), sharing one farm and one store room.",
    requires: "Dinosaurs",
    maxLevel: 1,
    cost: () => ({ Bone: 2000, Gold: 1500 }),
  },
];

// Every planned unlock is implemented (the "Coming in v2" rows are gone).
export const FUTURE_UNLOCKS = [];

/** Megafarm cap: one bot per farm column (the farm's side length), at least 1. */
export const maxDrones = (size) => Math.max(1, Math.floor(size) || 0);

export const UNLOCK_BY_ID = Object.fromEntries(UNLOCKS.map((u) => [u.id, u]));

// Which unlock "owns" an entity (for num_unlocked(Entities.X)).
export const ENTITY_UNLOCK = {
  Grass: "Grass",
  Bush: "Plant",
  Tree: "Trees",
  Carrot: "Carrots",
  Pumpkin: "Pumpkins",
  Sunflower: "Sunflowers",
  Cactus: "Cactus",
  Hedge: "Mazes",
  Treasure: "Mazes",
  Dinosaur: "Dinosaurs",
  Apple: "Dinosaurs",
  Rice: "Rice",
};
