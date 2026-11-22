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
 * Everything that can stand on a tile. Hedge and Treasure exist only inside a
 * maze, each tile of the dinosaur reads as Dinosaur, and Apples turn up while
 * a dinosaur is alive. Dead_Pumpkin / Dead_Rice are spoiled: harvest() clears them.
 */
declare const Entities: {
${names(Entities)}
};
/** What the store room can hold. */
declare const Items: {
${names(Items)}
};
/** The two kinds of ground. till() switches a tile from one to the other. */
declare const Grounds: {
${names(Grounds)}
};
/** Upgrade ids for unlock(), get_cost() and num_unlocked(). The Workshop window sells the same upgrades. */
declare const Unlocks: {
${names(Unlocks)}
};

/** One tile up the screen: y + 1. */
declare const North: "North";
/** One tile to the right: x + 1. */
declare const East: "East";
/** One tile down the screen: y - 1. */
declare const South: "South";
/** One tile to the left: x - 1. */
declare const West: "West";

// ---------- actions (they take time; the await is added for you) ----------

/**
 * Gather whatever grows on the bot's tile. A ripe plant goes into the store
 * room; an unripe one is lost (young grass is spared).
 * Maze Treasure: pays Gold for every farm tile, then the maze is gone.
 * Dinosaur: cuts this segment and all the tail behind it
 * → Bone = (segments cut)² × Dinosaurs level (from the head: all of it).
 * Apples stay where they are (false). Costs 200 ticks.
 * @returns true when there was something to gather.
 */
declare function harvest(): boolean;
/**
 * Put a plant on the bot's tile. Needs the Plant upgrade and the plant's own.
 * Carrots, Pumpkins, Sunflowers, Cactus and Rice want Soil. The seed is paid
 * for on the spot (see get_cost). Grass on the tile makes room.
 * Entities.Rice (Rice upgrade, 3 Carrots): the tile's water must be ≥ 0.5.
 * Below 0.2 it stops growing, and more than 200 dry world ticks in a row
 * (20 s) turn it into Dead_Rice. Ripe: 4 Rice (7 at level 2).
 * Entities.Dinosaur (Dinosaurs upgrade, 24 Gold): a dinosaur one tile long. It
 * wanders on its own and gets longer with each apple. One per farm. 200 ticks.
 */
declare function plant(entity: EntityType): boolean;
/**
 * Drive one tile. Leaving one side of the farm enters on the opposite side. A
 * Hedge stops the bot: it stays put and you get false. Inside a maze the farm
 * edge stops it too. 200 ticks.
 */
declare function move(direction: Direction): boolean;
/** Is the way free? On the open farm always; not into a Hedge or over a maze's outer edge. */
declare function can_move(direction: Direction): boolean;
/** Turn Grassland into Soil or back; whatever stood on the tile is removed. Needs Carrots. Not inside a maze, not on the dinosaur or an apple. 200 ticks. */
declare function till(): boolean;
/** Start over with a bare Grassland farm (a maze or dinosaur goes too) and bring this bot to (0, 0). 200 ticks. */
declare function clear(): boolean;
/**
 * Trade places between this tile's plant and the neighbour's; growth, petals
 * and size travel along. Never across the farm edge (false). Needs Cactus. Not
 * inside a maze, not with the dinosaur or an apple. 200 ticks.
 */
declare function swap(direction: Direction): boolean;
/**
 * Apply items to the bot's tile.
 * Items.Water: +0.25 water each (growth ×(1 + 4×water)).
 * Items.Fertilizer: 3 s of growth each. On a full-grown Bush, with Mazes, it
 * grows a hedge maze over the entire farm instead (a dinosaur and its apples
 * vanish with the old field).
 */
declare function use_item(item: ItemType, n?: number): boolean;
/**
 * Deal with the market n times. It sells Fertilizer (3 Pumpkins) and Water
 * (2 Carrots), and buys Items.Rice for 1 Gold each (Rice upgrade).
 * Closed while you are in a maze. 200 ticks.
 */
declare function trade(item: ItemType, n?: number): boolean;
/** Buy the next level of an upgrade if the store room covers it. 200 ticks. */
declare function unlock(unlock: UnlockType): boolean;
/** The bot turns once around itself. 600 ticks: a handy way to wait. */
declare function spin_in_place(): boolean;
/** Same as spin_in_place(). */
declare function do_a_flip(): boolean;

// ---------- sensors (no waiting, 1 tick) ----------

/** Is the plant here full-grown? (The dinosaur always counts, an apple never does.) Needs Senses. */
declare function can_harvest(): boolean | null;
/** What stands on this tile, or null. Needs Senses. */
declare function get_entity_type(): EntityType | null;
/** Grassland or Soil? Needs Senses. */
declare function get_ground_type(): GroundType | null;
/** The bot's column; 0 is the West edge. Needs Senses. */
declare function get_pos_x(): number | null;
/** The bot's row; 0 is the South edge. Needs Senses. */
declare function get_pos_y(): number | null;
/** How wet this tile is, 0…1. Needs Senses. */
declare function get_water(): number | null;
/**
 * A Sunflower's petals (7–15) or a Cactus's size (0–9), here or one tile over
 * in \`direction\`; null for other plants. Needs Senses.
 * Inside a maze: the Direction towards the Treasure from that tile. The longer
 * axis decides and a tie goes East/West; null on the Treasure.
 */
declare function measure(direction?: Direction): number | Direction | null;
/** Tiles along one side of the farm. */
declare function get_world_size(): number;
/** How much of an item is in the store room. */
declare function num_items(item: ItemType): number;
/**
 * Price of an upgrade's next level, or of one seed, e.g. { Wood: 1, Hay: 2 }.
 * null when there is none. Cactus, Grass and Rice mean the upgrade.
 */
declare function get_cost(thing: UnlockType | EntityType): Partial<Record<ItemType, number>> | null;
/** Level of an upgrade, 0 = not bought. For a plant: the upgrade it belongs to. */
declare function num_unlocked(thing: UnlockType | EntityType): number;
/** Seconds since Run was pressed; every bot reads the same clock. */
declare function get_time(): number;
/** Ticks this bot has used in this run (an action 200, a spin 600, a sensor 1). */
declare function get_tick_count(): number;

// ---------- Megafarm: a crew of bots ----------

/**
 * Put one more bot on this tile (Megafarm upgrade). It runs THIS SAME program
 * from its first line, side by side with the rest of the crew; farm and store
 * room are shared, and each call acts on the bot that makes it.
 * false without Megafarm or when max_bots() are out already. 200 ticks.
 */
declare function spawn_bot(): boolean;
/** Bots on the farm right now (1 without Megafarm). */
declare function num_bots(): number;
/** Most bots allowed: one per farm column with Megafarm (12 on 12×12), else 1. */
declare function max_bots(): number;
/** Same as spawn_bot(). */
declare function spawn_drone(): boolean;
/** Same as num_bots(). */
declare function num_drones(): number;
/** Same as max_bots(). */
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
 * The 3 orders of the day. Players with the same upgrades and farm size get
 * the same ones. Deadlines run on the farm clock: the ticks your programs use
 * (actions 200, sensors 1). 1 tick.
 */
declare function get_contracts(): Contract[];
/**
 * Deliver a contract: if it is active, not expired and you have the amount,
 * the items are consumed, the reward is paid and it is done. Takes 200 ticks.
 * @returns false when short of items, expired, already done or an unknown id.
 */
declare function deliver_contract(id: string): boolean;

// ---------- arena ----------

/**
 * Arena (⚔️): the goal of the match this program is running in, e.g.
 * { item: "Hay", amount: 500 } — first to hold that many wins. null outside
 * the arena (on your own farm). Free, 1 tick.
 */
declare function get_arena_goal(): { item: ItemType; amount: number } | null;

// ---------- weather ----------

/** The farm's weather states. */
type WeatherType = "Sunny" | "Rain" | "Storm" | "Drought";
/**
 * The weather right now: "Sunny" (normal), "Rain" (Soil slowly gains water),
 * "Storm" (growth ×1.5, lightning destroys a few crops) or "Drought" (water
 * evaporates 3× faster; growth ×0.5 on tiles with water < 0.5).
 * null on a weatherless world (the arena). Free sense: 1 op, 1 tick.
 */
declare function get_weather(): WeatherType | null;
/**
 * The forecast: the true weather of the next segment (it may be the same as
 * now) and APPROXIMATELY how many world ticks until it starts (10 per second;
 * the true value ±20 %, never exact). Expensive: counts as 25 ops (1 tick).
 * null on a weatherless world (the arena).
 */
declare function get_forecast(): { next: WeatherType; inTicks: number } | null;

// ---------- output ----------

/** Write a line to the Output tab. */
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
    "spin_in_place",
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
    "spawn_bot",
    "num_bots",
    "max_bots",
    "spawn_drone",
    "num_drones",
    "max_drones",
    "get_contracts",
    "deliver_contract",
    "get_arena_goal",
    "get_weather",
    "get_forecast",
    "print",
    "quick_print",
  ].map((n) => [n, "readonly"]),
);
