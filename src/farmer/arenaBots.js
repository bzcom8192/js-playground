// JS Farmer — the Arena's built-in opponents (v3 phase 3).
//
// Plain player programs: each one is a source string that goes through the
// same transform and runtime as your own code, with no special privileges.
// They read the match goal with get_arena_goal() like any arena program can.
//   rookie (800):  a spiral walker, Hay and Wood only, lots of wasted steps.
//   pro    (1200): one drone, ensure_*-style phases: Speed → hay → wood →
//                  carrot → pumpkin.
//   ace    (1600): pro's plan on a full Megafarm squad (8 drones, one per
//                  column) with tighter loops.

const ROOKIE = `// Rookie — a simple spiral farmer (Hay and Wood only).
// Walks an inward spiral over the farm, harvests what is ripe, plants bushes
// when the goal is Wood, then walks all the way back to the corner.
const n = get_world_size();
const goal = get_arena_goal();
const want_wood = goal !== null && goal.item === Items.Wood;

function tend() {
  if (can_harvest()) {
    harvest();
  }
  if (want_wood && get_entity_type() !== Entities.Bush) {
    plant(Entities.Bush);
  }
}

function walk(dir, steps) {
  for (let i = 0; i < steps; i++) {
    move(dir);
    tend();
  }
}

function spiral() {
  // N n-1, E n-1, S n-1, W n-2, N n-2, E n-3, S n-3, W n-4, …
  const dirs = [North, East, South, West];
  tend();
  walk(North, n - 1);
  let len = n - 1;
  let d = 1;
  while (len > 0) {
    walk(dirs[d % 4], len);
    d++;
    if (d % 2 === 1) {
      len--;
    }
  }
}

function back_to_corner() {
  while (get_pos_x() > 0) {
    move(West);
  }
  while (get_pos_y() > 0) {
    move(South);
  }
}

while (true) {
  spiral();
  back_to_corner();
}
`;

const PRO = `// Pro — a structured ensure_* farmer (one drone).
// Speed first (it pays for itself), then the pipeline the goal needs:
// hay → wood → carrot → pumpkin. Snakes the farm column by column.
const n = get_world_size();
const goal = get_arena_goal() || { item: Items.Hay, amount: 500 };
const SPEED_MAX = goal.item === Items.Hay ? 2 : 3;
const HAY_NEED = 150; // carrot seeds for the pumpkin field
const WOOD_NEED = 150;

function buy_speed() {
  while (num_unlocked(Unlocks.Speed) < SPEED_MAX) {
    const cost = get_cost(Unlocks.Speed);
    if (cost === null || num_items(Items.Hay) < cost.Hay) {
      return;
    }
    unlock(Unlocks.Speed);
  }
}

// One tile of each kind of field. Returns true when the tile is "done".
function tend_hay() {
  if (can_harvest()) {
    harvest();
  }
  return true;
}

function tend_wood(x, y) {
  // Checkerboard: trees never touch (no slowdown), bushes in between.
  const want = (x + y) % 2 === 0 ? Entities.Tree : Entities.Bush;
  const e = get_entity_type();
  if (e === want) {
    if (can_harvest()) {
      harvest();
      plant(want);
    }
  } else if (e === null || e === Entities.Grass) {
    plant(want);
  } else {
    harvest();
  }
  return true;
}

function tend_pumpkin() {
  if (get_ground_type() !== Grounds.Soil) {
    if (can_harvest()) {
      harvest();
    }
    till();
  }
  let e = get_entity_type();
  if (e === Entities.Dead_Pumpkin) {
    harvest();
    e = null;
  } else if (e !== null && e !== Entities.Pumpkin && can_harvest()) {
    harvest(); // a ripe carrot (or a leftover) → its yield
    e = null;
  }
  if (e === null) {
    if (num_items(Items.Carrot) >= 1) {
      plant(Entities.Pumpkin);
    } else if (num_items(Items.Hay) < 1) {
      plant(Entities.Grass);
    } else if (num_items(Items.Wood) < 1) {
      plant(Entities.Bush);
    } else {
      plant(Entities.Carrot);
    }
  }
  return get_entity_type() === Entities.Pumpkin && can_harvest();
}

function tend(kind, x, y) {
  if (kind === "wood") {
    return tend_wood(x, y);
  }
  if (kind === "pumpkin") {
    return tend_pumpkin();
  }
  return tend_hay();
}

// One pass over the whole farm; returns how many tiles are done.
function sweep(kind) {
  let done = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      if (tend(kind, x, y)) {
        done++;
      }
      move(North);
    }
    move(East);
  }
  return done;
}

function ensure_speed() {
  while (num_unlocked(Unlocks.Speed) < SPEED_MAX) {
    sweep("hay");
    buy_speed();
  }
}

function ensure_hay(k) {
  while (num_items(Items.Hay) < k) {
    sweep("hay");
    buy_speed();
  }
}

function ensure_wood(k) {
  while (num_items(Items.Wood) < k) {
    sweep("wood");
  }
}

function ensure_pumpkin(k) {
  while (num_items(Items.Pumpkin) < k) {
    if (sweep("pumpkin") === n * n) {
      harvest(); // the whole farm is one ripe square: n³ pumpkins
    }
  }
}

ensure_speed();
if (goal.item === Items.Hay) {
  ensure_hay(goal.amount);
} else if (goal.item === Items.Wood) {
  ensure_wood(goal.amount);
} else if (goal.item === Items.Pumpkin) {
  ensure_hay(HAY_NEED);
  ensure_wood(WOOD_NEED);
  ensure_pumpkin(goal.amount);
} else {
  ensure_hay(1000000);
}
`;

const ACE = `// Ace — pro's plan on a full Megafarm squad.
// The first drone walks East and spawns one helper per column (max_drones()
// = 8 on 8×8), then every drone farms its own column. Phases are read from
// the shared inventory, so all drones switch together:
//   0 grass (buy Speed) → 1 trees/bushes → 2 carrots → pumpkins.
// For pumpkins the first drone sweeps the whole farm and harvests the full
// 8×8 square (512) as soon as every tile is a ripe pumpkin.
const n = get_world_size();
const goal = get_arena_goal() || { item: Items.Hay, amount: 500 };
const leader = num_drones() === 1;
const SPEED_MAX = goal.item === Items.Hay ? 2 : 3;
const HAY_NEED = 150;
const WOOD_NEED = 150;
let phase = 0;
let hay_mark = 0;

function buy_speed() {
  while (num_unlocked(Unlocks.Speed) < SPEED_MAX) {
    const cost = get_cost(Unlocks.Speed);
    if (cost === null || num_items(Items.Hay) < cost.Hay) {
      return;
    }
    unlock(Unlocks.Speed);
  }
}

function update_phase() {
  if (goal.item === Items.Hay) {
    return;
  }
  if (phase === 0) {
    const fast = num_unlocked(Unlocks.Speed) >= SPEED_MAX;
    const hay_ok = goal.item !== Items.Pumpkin || num_items(Items.Hay) >= HAY_NEED;
    if ((fast && hay_ok) || num_items(Items.Wood) > 0) {
      phase = 1;
      hay_mark = num_items(Items.Hay);
    }
  }
  if (phase === 1 && goal.item === Items.Pumpkin) {
    // Hay only goes down once some drone plants carrots: follow it.
    if (num_items(Items.Wood) >= WOOD_NEED || num_items(Items.Hay) < hay_mark) {
      phase = 2;
    }
  }
}

function tend_wood(x, y) {
  const want = (x + y) % 2 === 0 ? Entities.Tree : Entities.Bush;
  const e = get_entity_type();
  if (e === want) {
    if (can_harvest()) {
      harvest();
      plant(want);
    }
  } else if (e === null || e === Entities.Grass) {
    plant(want);
  } else {
    harvest();
  }
}

function tend_pumpkin() {
  if (get_ground_type() !== Grounds.Soil) {
    if (can_harvest()) {
      harvest();
    }
    till();
  }
  let e = get_entity_type();
  if (e === Entities.Dead_Pumpkin) {
    harvest();
    e = null;
  } else if (e !== null && e !== Entities.Pumpkin && can_harvest()) {
    harvest();
    e = null;
  }
  if (e === null) {
    if (num_items(Items.Carrot) >= 1) {
      plant(Entities.Pumpkin);
    } else if (num_items(Items.Hay) < 1) {
      plant(Entities.Grass);
    } else if (num_items(Items.Wood) < 1) {
      plant(Entities.Bush);
    } else {
      plant(Entities.Carrot);
    }
  }
  return get_entity_type() === Entities.Pumpkin && can_harvest();
}

function tend(x, y) {
  update_phase();
  if (phase === 0) {
    if (can_harvest()) {
      harvest();
    }
    buy_speed();
    return false;
  }
  if (phase === 1) {
    tend_wood(x, y);
    return false;
  }
  return tend_pumpkin();
}

// Leader: hand every other column to a new drone, then come back to column 0.
if (leader) {
  for (let i = 1; i < max_drones(); i++) {
    if (can_harvest()) {
      harvest();
    }
    move(East);
    spawn_drone();
  }
  while (get_pos_x() !== 0) {
    move(East);
  }
}

const x = get_pos_x();
while (true) {
  if (leader && phase === 2) {
    // The whole farm, counting ripe pumpkins; all n² → harvest the square.
    let ready = 0;
    for (let cx = 0; cx < n; cx++) {
      for (let y = 0; y < n; y++) {
        if (tend(cx, get_pos_y())) {
          ready++;
        }
        move(North);
      }
      move(East);
    }
    if (ready === n * n) {
      harvest();
    }
  } else {
    for (let y = 0; y < n; y++) {
      tend(x, get_pos_y());
      move(North);
    }
  }
}
`;

export const BOT_CODE = Object.freeze({ rookie: ROOKIE, pro: PRO, ace: ACE });
