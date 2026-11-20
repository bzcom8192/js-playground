// Editor support for the Farmer page: TypeScript declarations (IntelliSense +
// hover docs in Monaco) and the matching ESLint globals list.

import { Entities, Grounds, Items, Unlocks } from "./constants.js";

export const FARMER_LIB_FILE = "ts:farmer-api.d.ts";

const names = (obj) => Object.keys(obj).map((k) => `    ${k}: "${k}";`).join("\n");

export const FARMER_LIB = `
type Direction = "North" | "East" | "South" | "West";
type EntityType = keyof typeof Entities;
type ItemType = keyof typeof Items;
type GroundType = keyof typeof Grounds;
type UnlockType = keyof typeof Unlocks;

/** Entity types that can grow on a tile. */
declare const Entities: {
${names(Entities)}
};
/** Inventory items. */
declare const Items: {
${names(Items)}
};
/** Ground types. till() toggles between them. */
declare const Grounds: {
${names(Grounds)}
};
/** Upgrades you can buy in the Unlocks tab or with unlock(). */
declare const Unlocks: {
${names(Unlocks)}
};

/** Direction: y + 1 (up on screen). */
declare const North: "North";
/** Direction: x + 1 (right). */
declare const East: "East";
/** Direction: y - 1 (down on screen). */
declare const South: "South";
/** Direction: x - 1 (left). */
declare const West: "West";

// ---------- actions (take time, auto-awaited) ----------

/**
 * Harvest the entity under the drone. Ripe plants add their yield to your
 * inventory; unripe plants are destroyed (unripe grass is left alone).
 * Takes 200 ticks.
 * @returns true if there was something to harvest.
 */
declare function harvest(): boolean;
/**
 * Plant an entity under the drone. Needs the Plant unlock plus the entity's own
 * unlock; Carrots/Pumpkins/Sunflowers/Cactus need Soil. Seed cost is paid
 * automatically (see get_cost). Planting over Grass replaces it. 200 ticks.
 */
declare function plant(entity: EntityType): boolean;
/** Move one tile. Wraps around the edges of the farm. 200 ticks. */
declare function move(direction: Direction): boolean;
/** Always true in an open field (kept for TFWR compatibility). */
declare function can_move(direction: Direction): boolean;
/** Toggle Grassland ⇄ Soil under the drone and remove its entity. Needs Carrots. 200 ticks. */
declare function till(): boolean;
/** Reset every tile to empty Grassland and move the drone to (0, 0). 200 ticks. */
declare function clear(): boolean;
/**
 * Swap the entity under the drone with its neighbour (growth, petals, size move
 * with it). Does not wrap: false at the edge. Needs Cactus. 200 ticks.
 */
declare function swap(direction: Direction): boolean;
/**
 * Use an item on the tile under the drone.
 * Items.Water: +0.25 water (growth ×(1 + 4×water)).
 * Items.Fertilizer: skip 2 s of growth per item.
 */
declare function use_item(item: ItemType, n?: number): boolean;
/** Buy items: Fertilizer costs 1 Pumpkin, Water costs 1 Carrot. 200 ticks. */
declare function trade(item: ItemType, n?: number): boolean;
/** Buy the next level of an unlock, if affordable. 200 ticks. */
declare function unlock(unlock: UnlockType): boolean;
/** The drone does a flip. 600 ticks. Purely for style. */
declare function do_a_flip(): boolean;

// ---------- senses (instant, 1 tick) ----------

/** true if the entity under the drone is fully grown. Needs Senses. */
declare function can_harvest(): boolean | null;
/** Type of the entity under the drone, or null. Needs Senses. */
declare function get_entity_type(): EntityType | null;
/** Ground type under the drone. Needs Senses. */
declare function get_ground_type(): GroundType | null;
/** Drone x position (0 = West edge). Needs Senses. */
declare function get_pos_x(): number | null;
/** Drone y position (0 = South edge). Needs Senses. */
declare function get_pos_y(): number | null;
/** Water level 0…1 under the drone. Needs Senses. */
declare function get_water(): number | null;
/**
 * Sunflower petals (7–15) or cactus size (0–9) under the drone, or of the
 * neighbour in \`direction\`. null for anything else. Needs Senses.
 */
declare function measure(direction?: Direction): number | null;
/** Side length of the square farm. */
declare function get_world_size(): number;
/** How many of an item you have. */
declare function num_items(item: ItemType): number;
/**
 * Cost of the next level of an unlock, or the seed cost of an entity, e.g.
 * { Wood: 1, Hay: 1 }. null if maxed / free. Shared names (Cactus, Grass)
 * resolve to the unlock.
 */
declare function get_cost(thing: UnlockType | EntityType): Partial<Record<ItemType, number>> | null;
/** Current level of an unlock (0 = locked). Entities map to their unlock. */
declare function num_unlocked(thing: UnlockType | EntityType): number;
/** Seconds since this run started. */
declare function get_time(): number;
/** Ticks used by this run (actions 200, flips 600, senses 1). */
declare function get_tick_count(): number;

// ---------- output ----------

/** Print to the log panel. */
declare function print(...values: any[]): void;
/** Same as print. */
declare function quick_print(...values: any[]): void;
`;

export const FARMER_GLOBALS = Object.fromEntries(
  [
    "Entities",
    "Items",
    "Grounds",
    "Unlocks",
    "North",
    "East",
    "South",
    "West",
    "harvest",
    "plant",
    "move",
    "can_move",
    "till",
    "clear",
    "swap",
    "use_item",
    "trade",
    "unlock",
    "do_a_flip",
    "can_harvest",
    "get_entity_type",
    "get_ground_type",
    "get_pos_x",
    "get_pos_y",
    "get_water",
    "measure",
    "get_world_size",
    "num_items",
    "get_cost",
    "num_unlocked",
    "get_time",
    "get_tick_count",
    "print",
    "quick_print",
  ].map((n) => [n, "readonly"]),
);
