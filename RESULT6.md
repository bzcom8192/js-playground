# RESULT 6: JS Farmer v2, Phase 1 (Mazes)

Branch: `farmer-game` (on top of `1b16865`). Everything in BRIEF6-MAZES.md is implemented. Not pushed.
Dinosaurs and Megafarm are untouched and still listed as "Coming in v2".

```bash
npm run test:farmer    # 121 tests (105 old + 16 new in src/farmer/maze.test.mjs), all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency.

## Files
- **`src/farmer/maze.js`** (new, pure):
  - `generateMaze(size, x, y, rng)` builds the maze.
  - `pathDistances` runs a BFS over the path tiles.
  - `treasureDirection` implements the measure() rule.
- **`world.js`**: maze state, spawning, walls, measure(), the gold payout, blocked actions and save/load.
- **`constants.js`**: `Items.Gold` 🪙, `Entities.Hedge` 🟩, `Entities.Treasure` 💰, `Unlocks.Mazes` 🧩 and the Mazes unlock row. `FUTURE_UNLOCKS` now only has Dinosaurs and Megafarm.
- **`runtime.js`**: `use_item` passes the run's rng to the maze generator. `can_move` now checks the walls.
- **`farmerLib.js`**: the `Entities`/`Items`/`Unlocks` declarations are generated from the source objects, so the `EntityType`/`ItemType`/`UnlockType` unions pick up the new names automatically. I updated the JSDoc for harvest, move, can_move, till, clear, swap, use_item, trade and measure. `measure()` now returns `number | Direction | null`.
- **`board3d/models.js`**: new hedge and treasure-chest models.
- **`FarmBoard.jsx`**: the 2D fallback draws hedges and the treasure.
- **`statusStrip.js`**: the info strip names hedges and the treasure.
- **`FarmerPage.jsx`**: Gold appears in the inventory bar.
- **`DocsPanel.jsx`**: new "Mazes 🧩" section, plus updated API rows and constant lists.
- **`examples.js`**: new example "7. Maze Runner".

## Mechanics as implemented
- **State:** `game.maze` is `{ treasure: {x, y} }` while a maze is active, otherwise `null`.
  - Walls are ordinary tile entities `{ type: "Hedge", progress: 1 }`, and the treasure is `{ type: "Treasure", progress: 1 }`. So `get_entity_type()` and the existing tile-info and 3D diff paths see them with no special cases.
  - Hedge and Treasure have `cost: null`, so `plant()` refuses them, the same way it refuses `Dead_Pumpkin`.
- **Spawn:** `use_item(Items.Fertilizer, n = 1)` on a fully grown Bush, with Mazes ≥ 1, turns the whole farm into a maze and uses `n` fertilizer.
  - The existing checks still run first and fail the same way as before: Fertilizer unlock, then "Not enough Fertilizer".
  - Any other case keeps the old behaviour: an unripe plant still gets 2 s of growth per item, and a grown non-bush or an empty tile still fails with "Nothing growing here" without using fertilizer.
  - Every maze tile is reset to Grassland with no water.
- **Layout:** a cells-and-walls grid.
  - Cells are the tiles whose x and y have the same parity as the drone's tile, so the drone always stands on a cell.
  - A randomized recursive backtracker (iterative depth-first search) visits every cell and opens the tile between two consecutive cells.
  - Everything else is a hedge.
  - The treasure goes on the path tile with the largest BFS distance from the drone. Ties go to the first tile the BFS finds. In a tree the farthest tile is always a dead end.
- **Movement:** `move()` into a Hedge returns false and the drone stays put.
  - **Judgement call:** inside a maze the farm edge is also a wall, so there is no wrap-around. With wrapping, opposite edge path tiles would join up and the maze would stop being perfect (loops, more than one path). Outside a maze, movement wraps exactly as before.
  - `can_move(dir)` now reports what `move()` would do. In the open field that is still always true; it is false into a hedge or across a maze edge.
- **measure() in a maze:** returns the Direction of the treasure from the drone, or from the neighbouring tile when called as `measure(dir)` (no wrap; null past the edge).
  - **Rule:** with `dx = tx − x` and `dy = ty − y`, if `|dx| ≥ |dy|` the result is `East` (dx > 0) or `West`, otherwise `North` (dy > 0) or `South`.
  - Ties go to East/West, and the result is `null` on the treasure itself.
  - Outside a maze, measure() is unchanged (sunflower petals, cactus size, otherwise null).
- **Goal:** `harvest()` on the treasure adds Gold, removes the maze and leaves every tile as empty Grassland. The drone stays where it is, and grass grows back as normal.
  - While a maze is active, grass does not grow back on path tiles.
  - `harvest()` on an empty path tile returns false.
- **Blocked inside a maze:** `plant`, `till`, `swap` and `trade` fail with "not possible inside a maze…". They change nothing in the game state, which a test checks against a serialized snapshot.
  - `use_item(Fertilizer)` fails, since nothing is growing on a path tile.
  - `use_item(Water)` still works; it is harmless.
- **Clear and reset:** `clearFarm()` sets `maze = null`. It is used by `clear()`, the Clear Farm button and Expand. Reset Save creates a new game, which also has no maze.
- **Persistence:** `serialize()` adds `maze: { tx, ty } | null`. Walls and the treasure are already saved inside the tile entities, and the drone position was already saved.
  - The save format stays at `v: 1`. Old saves have no `maze`, `Gold` or `Mazes` field and load with no maze, 0 Gold and Mazes level 0.
  - A saved maze is restored only if it is consistent: the treasure tile really holds the Treasure and the drone is not on a hedge.
  - Otherwise the maze is dropped and any stray Hedge or Treasure entities are removed, so a damaged save can't leave you stuck behind walls.

## Numbers chosen
| What | Value | Reasoning |
|---|---|---|
| Mazes unlock (level 1) | 2,000 🌵 + 2,000 🎃, requires Cactus | Above Cactus L3 (1,500 🎃 + 300 🌵) and the last Expand step (2,000 🪵 + 2,000 🎃 + 200 🌵). One sorted 12×12 cactus harvest pays 20,736+, so this is a "you've reached the endgame" price, not a grind. |
| Mazes level 2 / 3 | 6,000 🌵 + 300 🪙 / 18,000 🌵 + 900 🪙 | Same `scale(base, 3, l−1)` curve as the other upgrades. The Gold part means you must run mazes to upgrade mazes. |
| Max level | 3 | Matches Cactus and Watering. |
| Gold per treasure | `size² × max(1, Mazes level)` | 1 Gold per farm tile, so a 12×12 farm pays 144 / 288 / 432. Bigger farms make longer mazes, so they pay more. |
| Fertilizer per maze | `n` from `use_item(Items.Fertilizer, n)`, default 1 (1 🎃 by trade) | Keeps the existing "use n items" meaning; n > 1 gives no bonus. |
| Icons | 🪙 Gold, 🟩 Hedge, 💰 Treasure, 🧩 Mazes | |

## Presentation
- **3D board:**
  - Hedge: one merged, vertex-coloured mesh. It is a 0.98 × 0.5 × 0.98 box, darker toward the ground, with 9 leafy clumps on top.
  - Hedges on neighbouring tiles touch, so walls read as continuous. Height 0.5 (not taller) so the 55° camera can still see the path behind a wall.
  - Treasure: gold box body, half-cylinder lid, two dark straps over body and lid plus a rim, a pale lock plate with a keyhole on the camera side, and three spilled coins. It is turned slightly so both the lid and the lock read.
  - I checked this visually in headless Chromium (software GL) on an 8×8 maze. The first version was hard to read, so the chest got bigger and the hedges lower.
- **2D fallback:** hedges are dark-green blocks raised off the tile with a gradient. The treasure is 💰 on a soft gold glow. Checked with WebGL disabled.
- **Info strip:** standing on the treasure shows `💰 Treasure / Grassland`. While a maze is active, `what` also lists the neighbouring maze tiles, e.g. `Grassland · 🟩 Hedge E S W · 💰 Treasure N`. The farm edge counts as a hedge.
  - This goes through the existing `stripFields().what` path, so the snapshot keys and the 250 ms sampling are unchanged, and the strip looks exactly as before outside a maze.
- **Docs panel:** new "Mazes 🧩" section covering spawn, layout, the treasure and the measure() rule, Gold, and what is blocked. The constants lists and the move/can_move/measure/use_item rows are updated.
- **Example "7. Maze Runner"** (needs Mazes, Fertilizer, Plant, Senses):
  - If needed, it plants a bush, waits for it to grow, trades for fertilizer and spawns a maze.
  - It faces the treasure (`measure()`), then follows the right-hand wall using `move()`'s return value until `get_entity_type()` is the Treasure, harvests it and prints `Gold: …`. Then it repeats.
  - It resumes correctly if started mid-maze, and stops with a message if it can't get fertilizer.

## Tests (src/farmer/maze.test.mjs)
- Unlock placement, new constants and `.d.ts` text; Hedge/Treasure can't be planted.
- Generation is perfect at every farm size (1…12) × 4 start positions × 3 seeds:
  - connected (BFS reaches every path tile)
  - acyclic (edges = nodes − 1)
  - the start is a path tile
  - the treasure is on the farthest path tile
  - the same seed gives the same maze
- Spawn only on grown Bush + Mazes + fertilizer. Without Mazes, on grass/tree/empty, with no fertilizer, or without the Fertilizer unlock, there is no maze and no fertilizer is used. An unripe bush keeps the old growth boost.
- A 400-step random walk checks that `move()` and `can_move()` match the walls exactly, and that the edge doesn't wrap.
- `measure()` and `measure(dir)` checked on every path tile of a 7×7 maze; the tie and null cases; the sunflower behaviour outside.
- Treasure harvest: Gold = 25 on 5×5 and 50 at level 2; the farm is back to Grassland and grass regrows; no grass grows during the maze.
- plant/till/swap/trade fail with no change to the game state.
- `clear()` and Expand remove the maze.
- Save/load round trip on 8×8 with an active maze and a moved drone: walls, treasure, drone, items, can_move and measure are identical, and the loaded maze pays out.
- Old saves load with no maze; an inconsistent maze is dropped.
- End to end: the Maze Runner example on a 6×6 farm, starting with 0 fertilizer, solves two mazes (`Gold: 36`, `Gold: 72`) with no errors.
- Runtime `can_move`/`measure` inside a maze; strip text; 3D models (size and triangle checks) and the scene shows one model per hedge plus the chest.

## Uncertain / worth a look
- **No wrap inside mazes** (see Movement). This is the one place where "all other movement rules unchanged" gives way, because it was needed for "exactly one path".
- **Very small farms make trivial mazes.** Because of the cell lattice, a 2×2 farm, or a 3×3 farm with the drone on (1,1), has a single cell. The treasure then spawns under the drone and pays immediately (4 or 9 Gold). In practice Mazes is unlocked long after the farm is 12×12.
- **measure() return type.** In a maze it returns a string instead of a number, so the editor type is the union `number | Direction | null`. This follows the brief rather than TFWR (whose maze measure returns the treasure position).
- **Gold has no use yet** except Mazes levels 2–3. Dinosaurs and Megafarm will presumably spend it.
