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

/**
 * Entity types that can be on a tile. Hedge / Treasure only appear in a maze;
 * every tile of the dinosaur's body is a Dinosaur; Apples spawn while it lives.
 */
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
 * On the maze Treasure: Gold = farm tiles × Mazes level, and the maze is removed.
 * On a Dinosaur segment: that segment and the whole tail behind it are cut off
 * → Bone = (segments removed)² × Dinosaurs level (the head takes it all).
 * Apples can't be harvested (false). Takes 200 ticks.
 * @returns true if there was something to harvest.
 */
declare function harvest(): boolean;
/**
 * Plant an entity under the drone. Needs the Plant unlock plus the entity's own
 * unlock; Carrots/Pumpkins/Sunflowers/Cactus need Soil. Seed cost is paid
 * automatically (see get_cost). Planting over Grass replaces it.
 * Entities.Dinosaur (Dinosaurs unlock, 10 Gold) hatches a length-1 dinosaur
 * that roams by itself and grows by eating apples. One per farm. 200 ticks.
 */
declare function plant(entity: EntityType): boolean;
/**
 * Move one tile. Wraps around the edges of the farm. Hedges are walls: moving
 * into one returns false and the drone stays. Inside a maze the farm edge is a
 * wall too (no wrap). 200 ticks.
 */
declare function move(direction: Direction): boolean;
/** Could move(direction) succeed? Always true in an open field; false into a Hedge or across a maze's edge. */
declare function can_move(direction: Direction): boolean;
/** Toggle Grassland ⇄ Soil under the drone and remove its entity. Needs Carrots. Fails inside a maze and on the dinosaur / an apple. 200 ticks. */
declare function till(): boolean;
/** Reset every tile to empty Grassland (also removes a maze and the dinosaur) and move the drone to (0, 0). 200 ticks. */
declare function clear(): boolean;
/**
 * Swap the entity under the drone with its neighbour (growth, petals, size move
 * with it). Does not wrap: false at the edge. Needs Cactus. Fails inside a maze
 * and when either tile is the dinosaur or an apple. 200 ticks.
 */
declare function swap(direction: Direction): boolean;
/**
 * Use an item on the tile under the drone.
 * Items.Water: +0.25 water (growth ×(1 + 4×water)).
 * Items.Fertilizer: skip 2 s of growth per item. On a fully grown Bush with
 * Mazes unlocked it instead turns the whole farm into a hedge maze (the
 * dinosaur and its apples disappear with the old farm).
 */
declare function use_item(item: ItemType, n?: number): boolean;
/** Buy items: Fertilizer costs 1 Pumpkin, Water costs 1 Carrot. Fails inside a maze. 200 ticks. */
declare function trade(item: ItemType, n?: number): boolean;
/** Buy the next level of an unlock, if affordable. 200 ticks. */
declare function unlock(unlock: UnlockType): boolean;
/** The drone does a flip. 600 ticks. Purely for style. */
declare function do_a_flip(): boolean;

// ---------- senses (instant, 1 tick) ----------

/** true if the entity under the drone is fully grown (a dinosaur always is; an apple never). Needs Senses. */
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
 * Inside a maze: the Direction of the Treasure from here (or from the
 * neighbour): the axis with the larger distance wins, ties go East/West;
 * null on the Treasure itself.
 */
declare function measure(direction?: Direction): number | Direction | null;
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
/** Seconds since this run started (the same clock for every drone). */
declare function get_time(): number;
/** Ticks used by this drone in this run (actions 200, flips 600, senses 1). */
declare function get_tick_count(): number;

// ---------- Megafarm ----------

/**
 * Megafarm: spawn a new drone on this drone's tile. The new drone runs THIS
 * SAME program from the top, at the same time as the others, sharing the farm
 * and the inventory. Every function acts on the drone that calls it.
 * Returns false when Megafarm is locked or max_drones() drones already exist.
 * Takes 200 ticks.
 */
declare function spawn_drone(): boolean;
/** How many drones are on the farm (1 without Megafarm). */
declare function num_drones(): number;
/** The drone cap: the farm's side length once Megafarm is unlocked (12 on 12×12), else 1. */
declare function max_drones(): number;

// ---------- contracts ----------

/** One of today's contracts, as returned by get_contracts(). */
interface Contract {
  /** Pass this to deliver_contract(), e.g. "2026-11-21#1". */
  id: string;
  /** The item to deliver. */
  item: ItemType;
  /** How many of it. */
  amount: number;
  /** Bonus paid on delivery (in rewardItem). */
  reward: number;
  /** "Gold" or "Bone". */
  rewardItem: ItemType;
  /** Farm-clock ticks until it expires (0 once done / expired). */
  ticksLeft: number;
  status: "active" | "done" | "expired";
}
/**
 * Today's 3 daily contracts (same for every player on the same date, with the
 * same unlocks and farm size). The deadline counts down on the farm clock:
 * the ticks your programs spend (actions 200, senses 1). 1 tick.
 */
declare function get_contracts(): Contract[];
/**
 * Deliver a contract: if it is active, not expired and you have the amount,
 * the items are consumed, the reward is paid and it is done. Takes 200 ticks.
 * @returns false when short of items, expired, already done or an unknown id.
 */
declare function deliver_contract(id: string): boolean;

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
    "spawn_drone",
    "num_drones",
    "max_drones",
    "get_contracts",
    "deliver_contract",
    "print",
    "quick_print",
  ].map((n) => [n, "readonly"]),
);
