// JS Farmer — game constants and data tables.
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
  "Fertilizer",
  "Water",
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
};

// World sizes per Expand level (TFWR-like progression, max 12×12).
export const WORLD_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];

// Tuning knobs.
export const GRASS_REGROW_DELAY = 0.5; // s an empty Grassland tile waits before new grass sprouts
export const WATER_DECAY_PER_SEC = 0.02; // tile water level lost per second (linear)
export const WATER_PER_USE = 0.25;
export const FERTILIZER_SECONDS = 2;
export const DEAD_PUMPKIN_CHANCE = 0.2;
export const WATER_BASE_INTERVAL = 10; // s per Water item at Watering level 1

const scale = (base, factor, level) => Math.round(base * factor ** level);

// UNLOCKS — single data-driven table.
// cost(level) returns the cost to go from `level` to `level + 1`.
// requires: other unlock id that must be at level ≥ 1 first.
export const UNLOCKS = [
  {
    id: "Speed",
    name: "Speed",
    icon: "⏩",
    desc: "Each level doubles drone execution speed.",
    requires: null,
    maxLevel: 5,
    cost: (l) => ({ Hay: scale(20, 3, l) }),
  },
  {
    id: "Expand",
    name: "Expand",
    icon: "🗺️",
    desc: "Grows the farm (1→2→3→4→5→6→7→8→10→12). Clears the farm.",
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
    name: "Plant",
    icon: "🌿",
    desc: "Unlocks plant() and Bushes (→ Wood).",
    requires: null,
    maxLevel: 1,
    cost: () => ({ Hay: 10 }),
  },
  {
    id: "Senses",
    name: "Senses",
    icon: "👁️",
    desc: "Unlocks can_harvest(), get_entity_type(), get_ground_type(), get_pos_x/y(), measure(), get_water().",
    requires: null,
    maxLevel: 1,
    cost: () => ({ Hay: 15 }),
  },
  {
    id: "Grass",
    name: "Grass",
    icon: "🌾",
    desc: "Hay yield ×(level + 1).",
    requires: "Plant",
    maxLevel: 5,
    cost: (l) => ({ Hay: scale(40, 3, l) }),
  },
  {
    id: "Carrots",
    name: "Carrots",
    icon: "🥕",
    desc: "Unlocks till() and Carrots (Soil, seed: 1 Wood + 1 Hay). Carrot yield ×level.",
    requires: "Plant",
    maxLevel: 5,
    cost: (l) =>
      l === 0
        ? { Wood: 50 }
        : { Wood: scale(100, 3, l - 1), Carrot: scale(50, 3, l - 1) },
  },
  {
    id: "Trees",
    name: "Trees",
    icon: "🌳",
    desc: "Unlocks Trees (5 Wood, grow 2× slower per adjacent tree). Wood yield ×level.",
    requires: "Carrots",
    maxLevel: 5,
    cost: (l) =>
      l === 0
        ? { Hay: 100, Wood: 50 }
        : { Wood: scale(200, 3, l - 1), Carrot: scale(50, 3, l - 1) },
  },
  {
    id: "Watering",
    name: "Watering",
    icon: "💧",
    desc: "Water tank: +1 Water every 10s/level, cap 5 + 5×level. use_item(Items.Water) speeds growth.",
    requires: "Carrots",
    maxLevel: 3,
    cost: (l) => ({ Wood: scale(100, 3, l), Carrot: scale(50, 3, l) }),
  },
  {
    id: "Pumpkins",
    name: "Pumpkins",
    icon: "🎃",
    desc: "Unlocks Pumpkins (Soil, seed: 1 Carrot). k×k squares yield k³. Yield ×level.",
    requires: "Carrots",
    maxLevel: 5,
    cost: (l) =>
      l === 0
        ? { Carrot: 200 }
        : { Carrot: scale(300, 3, l - 1), Pumpkin: scale(100, 3, l - 1) },
  },
  {
    id: "Sunflowers",
    name: "Sunflowers",
    icon: "🌻",
    desc: "Unlocks Sunflowers (Soil, seed: 1 Carrot) → Power (actions 2× faster).",
    requires: "Pumpkins",
    maxLevel: 1,
    cost: () => ({ Pumpkin: 100 }),
  },
  {
    id: "Fertilizer",
    name: "Fertilizer",
    icon: "🧪",
    desc: "trade(Items.Fertilizer) for 1 Pumpkin; use_item() skips 2s of growth.",
    requires: "Pumpkins",
    maxLevel: 1,
    cost: () => ({ Pumpkin: 100 }),
  },
  {
    id: "Cactus",
    name: "Cactus",
    icon: "🌵",
    desc: "Unlocks Cactus (Soil, seed: 1 Pumpkin) and swap(). Sorted farm yields n². Yield ×level.",
    requires: "Pumpkins",
    maxLevel: 3,
    cost: (l) =>
      l === 0
        ? { Pumpkin: 200 }
        : { Pumpkin: scale(500, 3, l - 1), Cactus: scale(100, 3, l - 1) },
  },
];

export const FUTURE_UNLOCKS = [
  { id: "Mazes", name: "Mazes", icon: "🧩" },
  { id: "Dinosaurs", name: "Dinosaurs", icon: "🦕" },
  { id: "Megafarm", name: "Megafarm", icon: "🏭" },
];

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
};
