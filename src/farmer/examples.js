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
];
