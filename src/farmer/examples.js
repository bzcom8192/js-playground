// Starter programs for the Field Guide. Each one only uses what its header
// comment says it needs, and is exercised by the node engine tests.

export const DEFAULT_CODE = `// Good morning from Semicolon Acres! This file is your bot's whole plan.
// Run starts it (Ctrl+Enter), Stop ends it, and you can edit it any time.
// This plan: cut the grass, turn once while it grows back, cut it again.
// The Hay pays for your first upgrade in the Workshop.
let rounds = 0;
while (true) {
  harvest();
  spin_in_place();
  rounds += 1;
  if (rounds % 10 === 0) {
    print("Round", rounds, "- Hay in the store room:", num_items(Items.Hay));
  }
}
`;

// Seeded second file: the player's shared functions.
export const HELPER_CODE = `// toolshed — functions every other file can borrow.
// Whatever file you run, the functions written here are ready to call in it.
// Only functions are shared; loose statements in this file are skipped then.

// Park in the South-West corner. Needs: Sensor Mast (Senses).
function park() {
  while (get_pos_y() > 0) move(South);
  while (get_pos_x() > 0) move(West);
}
`;

export const EXAMPLES = [
  {
    id: "first-harvest",
    name: "1. Mow and turn",
    needs: [],
    code: DEFAULT_CODE,
  },
  {
    id: "snake",
    name: "2. Walk the rows",
    needs: ["Expand"],
    code: `// Walk the rows — needs: New Acres (Expand).
// Up one column, one step East, up the next. Driving off the North edge puts
// the bot back on the South edge, so every column ends where it began.
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
    name: "3. Firewood hedge",
    needs: ["Plant", "Senses"],
    code: `// Firewood hedge — needs: Seed Hopper (Plant), Sensor Mast (Senses).
// Cut what is ripe and put a bush wherever there is none yet.
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
    name: "4. Root cellar",
    needs: ["Carrots", "Senses"],
    code: `// Root cellar — needs: Plough Blade (Carrots), Sensor Mast (Senses).
// One carrot seed takes 1 Wood + 2 Hay from the store room: stock up first.
function tend_tile() {
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
      tend_tile();
      move(North);
    }
    move(East);
  }
}
`,
  },
  {
    id: "pumpkins",
    name: "5. One big pumpkin",
    needs: ["Pumpkins", "Senses"],
    code: `// One big pumpkin — needs: Pumpkin Patch (Pumpkins), Sensor Mast (Senses).
// Plant the farm edge to edge and replant the spoiled ones until none is
// missing. Then the whole k×k block comes off in one go and pays k³.
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
          harvest(); // spoiled: make room
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
  harvest(); // takes the entire block
  print("Pumpkins:", num_items(Items.Pumpkin));
}
`,
  },
  {
    id: "cactus",
    name: "6. Tidy cactus bench",
    needs: ["Cactus", "Senses"],
    code: `// Tidy cactus bench — needs: Cactus Bench (Cactus), Sensor Mast (Senses).
// Small to the West and South, tall to the East and North. First every row,
// then every column, trading neighbours that stand the wrong way round.
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
        spin_in_place(); // not ripe yet
      }
    }
  }
  harvest(); // the whole bench at once
  print("Cactus:", num_items(Items.Cactus));
}
`,
  },
  {
    id: "maze",
    name: "7. Hand on the hedge",
    needs: ["Mazes", "Fertilizer", "Plant", "Senses"],
    code: `// Hand on the hedge — needs: Hedge Labyrinth (Mazes), Compost Press
// (Fertilizer), Seed Hopper (Plant), Sensor Mast (Senses).
// Grow a bush, feed it until it becomes a labyrinth, then follow the hedge on
// the right-hand side. A labyrinth without loops always gives way like that.
const RIGHT = { North: East, East: South, South: West, West: North };
const LEFT = { North: West, West: South, South: East, East: North };
const BACK = { North: South, East: West, South: North, West: East };

function in_maze() {
  // In a labyrinth measure() answers with a direction, on the treasure with null.
  return typeof measure() === "string" || get_entity_type() === Entities.Treasure;
}

function spawn_maze() {
  if (get_entity_type() !== Entities.Bush) {
    harvest();
    plant(Entities.Bush);
  }
  while (!can_harvest()) {
    spin_in_place(); // the bush needs a moment
  }
  if (num_items(Items.Fertilizer) < 1) {
    trade(Items.Fertilizer);
  }
  use_item(Items.Fertilizer);
}

function solve_maze() {
  let dir = measure() || North; // set off towards the treasure
  while (get_entity_type() !== Entities.Treasure) {
    // Right if we can, else ahead, else left, else back the way we came.
    // move() into a hedge is simply false (can_move() would ask first).
    for (const d of [RIGHT[dir], dir, LEFT[dir], BACK[dir]]) {
      if (move(d)) {
        dir = d;
        break;
      }
    }
  }
  harvest(); // Gold! and the hedges are gone
}

while (true) {
  if (!in_maze()) {
    spawn_maze();
  }
  if (!in_maze()) {
    print("No labyrinth today: out of Fertilizer, and of Pumpkins to buy it with.");
    break;
  }
  solve_maze();
  print("Gold:", num_items(Items.Gold));
}
`,
  },
  {
    id: "dinosaur",
    name: "8. Apple trail",
    needs: ["Dinosaurs", "Plant", "Senses"],
    code: `// Apple trail — needs: Dinosaur Egg (Dinosaurs), Seed Hopper (Plant), Sensor
// Mast (Senses), and 24 Gold per egg.
// An empty field, one egg, half a minute of apples: every apple adds a tile to
// the animal. Then the bot drives every row and cuts wherever it bumps into
// it. A cut takes that segment plus the tail behind it and pays the square.
// Once all of it is cut, the next egg can go in.
const GROW_SECONDS = 30;
const n = get_world_size();

function go_to(x, y) {
  // Whichever way round is shorter (the field joins up at the edges).
  while (get_pos_x() !== x) move((x - get_pos_x() + n) % n <= n / 2 ? East : West);
  while (get_pos_y() !== y) move((y - get_pos_y() + n) % n <= n / 2 ? North : South);
}

function wait(seconds) {
  const start = get_time();
  while (get_time() - start < seconds) {
    spin_in_place(); // the dinosaur does not wait for us
  }
}

function sweep_and_cut() {
  // Once over every tile, North up one column and South down the next.
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

clear(); // crops would be in its way
while (true) {
  go_to(0, 0);
  // Only one dinosaur fits: false while some of the last one is left.
  if (plant(Entities.Dinosaur)) {
    wait(GROW_SECONDS);
  } else if (num_items(Items.Gold) < get_cost(Entities.Dinosaur).Gold) {
    print("No Gold for an egg: run example 7 for a while.");
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
    name: "9. A bot per column",
    needs: ["Megafarm", "Senses"],
    code: `// A bot per column — needs: Bot Crew (Megafarm), Sensor Mast (Senses).
// Each new bot begins THIS FILE at line 1, on the tile where it was put down.
// So the plan is a relay: drop a bot one column East, go back, farm your own
// column for good. The last column has nobody to its East and the relay ends.
// max_bots() is the farm's width, so there is a bot for every column.
const n = get_world_size();

if (num_bots() === 1) {
  // Alone, so this is the bot Run started with: begin at the West edge.
  while (get_pos_x() > 0) move(West);
}

if (get_pos_x() < n - 1) {
  move(East);
  if (!spawn_bot()) print("Nobody for column", get_pos_x(), "(no Bot Crew, or everyone is out)");
  move(West);
} else {
  print(num_bots(), "bots at work,", n, "columns");
}

// My column: North and round again, cutting whatever is ripe.
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
    name: "10. Rice to market",
    needs: ["Rice", "Watering", "Senses"],
    code: `// Rice to market — needs: Flooded Paddy (Rice), Rain Barrel (Watering), Sensor
// Mast (Senses), and the Plough Blade for till().
// Flood a tile to 0.5, plant, and keep the young rice clear of the 0.2 line;
// a dry spell of 20 s would ruin it. A short barrel is topped up with Water
// bought for Carrots, and each round ends at the market: 1 Gold per Rice.
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
        if (get_water() < 0.25) wet_paddy(); // well above the 0.2 line
      } else if (wet_paddy()) {
        plant(Entities.Rice);
      }
      move(North);
    }
    move(East);
  }
  const rice = num_items(Items.Rice);
  if (rice > 0) trade(Items.Rice, rice);
  print("Market day:", rice, "Rice sold, Gold now", num_items(Items.Gold));
}
`,
  },
];
