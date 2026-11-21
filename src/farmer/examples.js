// Starter programs for the Docs panel. Each one only uses what its header
// comment says it needs, and is exercised by the node engine tests.

export const DEFAULT_CODE = `// Welcome to JS Farmer! Press Run (Ctrl+Enter).
// The drone does exactly what your code says — nothing more.
// Collect Hay, then buy upgrades in the Unlocks tab.
// Tip: after unlocking Senses, try: if (can_harvest()) harvest();
while (true) {
  harvest();
  do_a_flip();
}
`;

// Seeded second file ("f0"): a small helper module, like the reference's second window.
export const HELPER_CODE = `// f0 — helper functions.
// Top-level functions in this file can be called from any other file
// (like Python's "from f0 import *"). Other top-level code here is
// ignored when another file runs.

// Fly back to (0, 0). Needs: Senses.
function go_home() {
  while (get_pos_x() > 0) move(West);
  while (get_pos_y() > 0) move(South);
}
`;

export const EXAMPLES = [
  {
    id: "first-harvest",
    name: "1. First Harvest",
    needs: [],
    code: DEFAULT_CODE,
  },
  {
    id: "snake",
    name: "2. Snake the Field",
    needs: ["Expand"],
    code: `// Snake the Field — needs: Expand.
// Visits every tile column by column (movement wraps around the edges).
while (true) {
  for (let x = 0; x < get_world_size(); x++) {
    for (let y = 0; y < get_world_size(); y++) {
      harvest();
      move(North);
    }
    move(East);
  }
}
`,
  },
  {
    id: "bushes",
    name: "3. Bushes for Wood",
    needs: ["Plant", "Senses"],
    code: `// Bushes for Wood — needs: Plant, Senses.
// Harvests ripe plants and keeps a bush on every tile.
while (true) {
  for (let x = 0; x < get_world_size(); x++) {
    for (let y = 0; y < get_world_size(); y++) {
      if (can_harvest()) {
        harvest();
      }
      if (get_entity_type() !== Entities.Bush) {
        plant(Entities.Bush);
      }
      move(North);
    }
    move(East);
  }
}
`,
  },
  {
    id: "carrots",
    name: "4. Carrot Rows",
    needs: ["Carrots", "Senses"],
    code: `// Carrot Rows — needs: Carrots, Senses.
// Each carrot seed costs 1 Wood + 1 Hay, so keep some in stock.
function farm_tile() {
  if (get_ground_type() !== Grounds.Soil) {
    till();
  }
  if (can_harvest()) {
    harvest();
  }
  if (get_entity_type() === null) {
    plant(Entities.Carrot);
  }
}

while (true) {
  for (let x = 0; x < get_world_size(); x++) {
    for (let y = 0; y < get_world_size(); y++) {
      farm_tile();
      move(North);
    }
    move(East);
  }
}
`,
  },
  {
    id: "pumpkins",
    name: "5. Pumpkin Square",
    needs: ["Pumpkins", "Senses"],
    code: `// Pumpkin Square — needs: Pumpkins, Senses.
// Fill the whole farm with pumpkins. A solid k×k square of ripe
// pumpkins harvests all at once for k³ pumpkins.
const n = get_world_size();

while (true) {
  let complete = false;
  while (!complete) {
    complete = true;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        if (get_ground_type() !== Grounds.Soil) {
          till();
        }
        if (get_entity_type() === Entities.Dead_Pumpkin) {
          harvest(); // clear the rotten one
        }
        if (get_entity_type() !== Entities.Pumpkin) {
          plant(Entities.Pumpkin);
          complete = false;
        } else if (!can_harvest()) {
          complete = false;
        }
        move(North);
      }
      move(East);
    }
  }
  harvest(); // one harvest clears the whole square
  print("Pumpkins:", num_items(Items.Pumpkin));
}
`,
  },
  {
    id: "cactus",
    name: "6. Cactus Sort",
    needs: ["Cactus", "Senses"],
    code: `// Cactus Sort — needs: Cactus, Senses.
// Rows are sorted West→East, then columns South→North (bubble sort with
// swap()). A sorted farm yields n² cactus for n cacti.
const n = get_world_size();

function go_to(x, y) {
  while (get_pos_x() !== x) {
    move(East);
  }
  while (get_pos_y() !== y) {
    move(North);
  }
}

function plant_all() {
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      go_to(x, y);
      if (get_ground_type() !== Grounds.Soil) {
        till();
      }
      if (get_entity_type() !== Entities.Cactus) {
        harvest();
        plant(Entities.Cactus);
      }
    }
  }
}

function sort_line(fixed, along_x) {
  for (let pass = 0; pass < n - 1; pass++) {
    for (let i = 0; i < n - 1 - pass; i++) {
      const dir = along_x ? East : North;
      if (along_x) {
        go_to(i, fixed);
      } else {
        go_to(fixed, i);
      }
      if (measure() > measure(dir)) {
        swap(dir);
      }
    }
  }
}

while (true) {
  plant_all();
  for (let y = 0; y < n; y++) {
    sort_line(y, true);
  }
  for (let x = 0; x < n; x++) {
    sort_line(x, false);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      go_to(x, y);
      while (!can_harvest()) {
        do_a_flip(); // wait for it to ripen
      }
    }
  }
  harvest(); // harvests every cactus on the farm
  print("Cactus:", num_items(Items.Cactus));
}
`,
  },
  {
    id: "maze",
    name: "7. Maze Runner",
    needs: ["Mazes", "Fertilizer", "Plant", "Senses"],
    code: `// Maze Runner — needs: Mazes, Fertilizer, Plant, Senses.
// Grows a bush, turns it into a maze with fertilizer, then walks the maze
// with the right-hand rule (keep a hand on the hedge to your right) until it
// stands on the treasure. measure() points at the treasure inside a maze.
const RIGHT = { North: East, East: South, South: West, West: North };
const LEFT = { North: West, West: South, South: East, East: North };
const BACK = { North: South, East: West, South: North, West: East };

function in_maze() {
  // Inside a maze measure() returns a direction (a string), or null on the treasure.
  return typeof measure() === "string" || get_entity_type() === Entities.Treasure;
}

function spawn_maze() {
  if (get_entity_type() !== Entities.Bush) {
    harvest();
    plant(Entities.Bush);
  }
  while (!can_harvest()) {
    do_a_flip(); // wait for the bush to grow
  }
  if (num_items(Items.Fertilizer) < 1) {
    trade(Items.Fertilizer);
  }
  use_item(Items.Fertilizer);
}

function solve_maze() {
  let dir = measure() || North; // start by facing the treasure
  while (get_entity_type() !== Entities.Treasure) {
    // Right-hand rule: try right, straight, left, then turn back.
    // move() returns false into a hedge (can_move(d) would check for free).
    for (const d of [RIGHT[dir], dir, LEFT[dir], BACK[dir]]) {
      if (move(d)) {
        dir = d;
        break;
      }
    }
  }
  harvest(); // treasure → Gold, the maze disappears
}

while (true) {
  if (!in_maze()) {
    spawn_maze();
  }
  if (!in_maze()) {
    print("No maze — need Fertilizer (or Pumpkins to trade for it).");
    break;
  }
  solve_maze();
  print("Gold:", num_items(Items.Gold));
}
`,
  },
  {
    id: "dinosaur",
    name: "8. Bone Farm",
    needs: ["Dinosaurs", "Plant", "Senses"],
    code: `// Bone Farm — needs: Dinosaurs, Plant, Senses (and 10 Gold per dinosaur).
// Clears the field, hatches a dinosaur and lets it roam: it eats the apples
// that keep appearing and grows 1 tile per apple. Then the drone sweeps the
// farm and harvests the dinosaur wherever it meets it: that cuts off the
// segment and the whole tail behind it for (segments removed)² Bone.
// When nothing is left, plant() works again and a new dinosaur hatches.
const GROW_SECONDS = 30;
const n = get_world_size();

function go_to(x, y) {
  // Shortest way (movement wraps around the edges outside a maze).
  while (get_pos_x() !== x) move((x - get_pos_x() + n) % n <= n / 2 ? East : West);
  while (get_pos_y() !== y) move((y - get_pos_y() + n) % n <= n / 2 ? North : South);
}

function wait(seconds) {
  const start = get_time();
  while (get_time() - start < seconds) {
    do_a_flip(); // the dinosaur moves on its own meanwhile
  }
}

function sweep_and_cut() {
  // Visit every tile once, column by column, cutting the dinosaur wherever we meet it.
  go_to(0, 0);
  for (let x = 0; x < n; x++) {
    for (let i = 0; i < n; i++) {
      if (get_entity_type() === Entities.Dinosaur) {
        harvest();
      }
      if (i < n - 1) {
        move(x % 2 === 0 ? North : South);
      }
    }
    move(East);
  }
}

clear(); // a free field: the dinosaur can't walk through crops
while (true) {
  go_to(0, 0);
  // plant() fails while the last dinosaur still roams (one per farm).
  if (plant(Entities.Dinosaur)) {
    wait(GROW_SECONDS);
  } else if (num_items(Items.Gold) < get_cost(Entities.Dinosaur).Gold) {
    print("Out of Gold — solve some mazes first (example 7).");
    break;
  }
  const before = num_items(Items.Bone);
  sweep_and_cut();
  if (num_items(Items.Bone) > before) {
    print("Bone:", num_items(Items.Bone));
  }
}
`,
  },
  {
    id: "megafarm",
    name: "9. Drone Squad",
    needs: ["Megafarm", "Senses"],
    code: `// Drone Squad — needs: Megafarm, Senses.
// spawn_drone() starts a new drone on this tile, and the new drone runs
// THIS SAME FILE from the top. So every drone first hands the column east
// of it to a new helper, then farms its own column forever. The result is
// one drone per column. The cap, max_drones(), is the farm size, so it fits
// exactly.
const n = get_world_size();

if (num_drones() === 1) {
  // Only the very first drone (a Run starts with one): go to the West edge.
  while (get_pos_x() > 0) move(West);
}

if (get_pos_x() < n - 1) {
  move(East);
  if (!spawn_drone()) print("No helper for column", get_pos_x(), "(Megafarm locked or at the cap)");
  move(West);
} else {
  print(num_drones(), "drones farming,", n, "columns");
}

// My column: harvest whatever is ripe, walking North (wraps at the edge).
while (true) {
  if (can_harvest()) {
    harvest();
  }
  move(North);
}
`,
  },
  {
    id: "rice",
    name: "10. Rice Paddy",
    needs: ["Rice", "Watering", "Senses"],
    code: `// Rice Paddy — needs: Rice, Watering, Senses (Rice needs Carrots for till()).
// Rice lives in water: plant() needs the tile's water ≥ 0.5, and growing
// rice stops below 0.2 and withers after 20 s dry. So every pass tops each
// paddy up to 0.5 (buying Water for Carrots when the tank is low), plants,
// harvests ripe rice (3 each, 5 at Rice level 2) and sells it: 1 Rice → 2 Gold.
const n = get_world_size();

function wet_paddy() {
  const need = Math.ceil((0.5 - get_water()) / 0.25);
  if (need <= 0) return true;
  if (num_items(Items.Water) < need) trade(Items.Water, need);
  return use_item(Items.Water, need);
}

while (true) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const e = get_entity_type();
      if (e === Entities.Dead_Rice || (e === Entities.Rice && can_harvest())) {
        harvest();
      }
      if (get_ground_type() !== Grounds.Soil) till();
      if (get_entity_type() === Entities.Rice) {
        if (get_water() < 0.25) wet_paddy(); // keep growing rice off the 0.2 line
      } else if (wet_paddy()) {
        plant(Entities.Rice);
      }
      move(North);
    }
    move(East);
  }
  const rice = num_items(Items.Rice);
  if (rice > 0) trade(Items.Rice, rice);
  print("Sold", rice, "Rice. Gold:", num_items(Items.Gold));
}
`,
  },
];
