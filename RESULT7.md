# RESULT 7: JS Farmer v2, Phase 2 (Dinosaurs)

Branch: `farmer-game` (on top of `8774dd6`, Mazes). Everything in BRIEF7-DINOSAURS.md is implemented. Not pushed.
Megafarm is untouched and is now the only "Coming in v2" entry.

```bash
npm run test:farmer    # 136 tests (121 old + 15 new in src/farmer/dino.test.mjs), all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency.

**One existing assertion changed:** `maze.test.mjs` asserted `FUTURE_UNLOCKS = ["Dinosaurs", "Megafarm"]`. The brief requires moving Dinosaurs out of that list, so the assertion now expects `["Megafarm"]` and the test title says so. No other existing test was touched.

## Files
- **`constants.js`**:
  - `Entities.Dinosaur` 🦖, `Entities.Apple` 🍎, `Items.Bone` 🦴, `Unlocks.Dinosaurs` 🦕.
  - The Dinosaurs unlock row sits after Mazes and requires Mazes.
  - New tuning knobs: `DINO_STEP_SECONDS`, `APPLE_SPAWN_SECONDS`, `appleCap(size)`.
  - `ENTITY_UNLOCK` maps Dinosaur and Apple to Dinosaurs.
  - `FUTURE_UNLOCKS` = Megafarm only.
- **`world.js`**:
  - The `state.dino` model plus hatching, stepping, apple spawning and the Bone harvest.
  - The blocked actions, the maze and clear interaction, and save/load with validation.
  - Exported helpers: `dinoMoves`, `dinoStep`, `dinoSegment`, `spawnApple`, `boneFor`.
- **`runtime.js`**: `can_harvest()` is false on an Apple. Nothing else needed changing, because `get_cost` and `num_unlocked` are data-driven.
- **`farmerLib.js`**: the Entities/Items/Unlocks declarations pick up the new names automatically. I updated the JSDoc for harvest, plant, till, swap, clear, use_item and can_harvest.
- **`board3d/models.js`**: dinosaur head, body, body-with-feet and tail segment models, an apple model, and `buildDinoSegment` / `setDinoPart`.
- **`board3d/FarmScene.js`**: the dinosaur is drawn as one animated chain (see Presentation).
- **`FarmBoard.jsx`**: the 2D fallback draws dinosaur segments and apples.
- **`statusStrip.js`**: dinosaur segment label in the info strip.
- **`FarmerPage.jsx`**: Bone appears in the inventory bar.
- **`DocsPanel.jsx`**: new "Dinosaurs 🦕" section, plus updated API rows and constant lists.
- **`examples.js`**: new example "8. Bone Farm".
- **`demo.js`**: the demo farm inventory now shows some Gold and Bone. The layout is unchanged.
- **`dino.test.mjs`**: new tests.

## Mechanics as implemented
- **State:** `game.dino` is `{ body: [{x, y}, …] (head first), dir, stepTimer, appleTimer }` or `null`.
  - Every body tile holds the entity `{ type: "Dinosaur", progress: 1 }`, and each apple is `{ type: "Apple", progress: 1 }`.
  - As with the maze, `get_entity_type()`, the tile-info path and the 3D diff see them with no special cases.
  - Apple has `cost: null`, so `plant()` refuses it.
- **Spawn:** `plant(Entities.Dinosaur)` needs Plant + Dinosaurs and costs 10 Gold. The usual seed rules apply: it must be an empty tile, or a Grass tile (the grass is replaced), and no Soil is needed.
  - The dinosaur starts at length 1, facing South.
  - Only one dinosaur per farm: a second `plant` fails with "only one dinosaur per farm…" and nothing is paid.
  - It is also refused inside a maze (the existing maze rule).
- **Movement:** every 0.3 s of game time (3 world ticks of 100 ms), the head steps to a uniformly random valid neighbour.
  - Valid means the farm edge is never crossed (no wrap) and the tile holds nothing, Grass (trampled, no Hay) or an Apple (eaten).
  - It never enters its own body (tail tile included), a Hedge, the Treasure, or any crop. Crops block it like walls, so a dinosaur never destroys your farm.
  - With no valid move it stays put.
  - The tail tile it leaves becomes empty ground, and grass regrows there as normal.
  - Timing uses the world simulation, so Pause and the frozen demo farm stop it. A long frame catches up step by step.
  - The drone flies over it, so `move()` is unaffected.
- **Apples:** while a dinosaur is alive, every 1.5 s of game time one apple spawns on a random tile that is empty or has grass. The cap is `max(1, ⌊size²/16⌋)` apples: 1 on 5×5, 4 on 8×8, 9 on 12×12.
  - When the head steps onto an apple it eats it and the body grows by 1 (the tail stays where it was).
  - Apples can't be harvested: `harvest()` returns false with the hint "apples are for the dinosaur…", and `can_harvest()` is false.
  - When the dinosaur is completely harvested, its remaining apples disappear. Otherwise they would block tiles forever.
- **Harvest:** `harvest()` on segment `i` (0 = head) cuts off that segment and everything behind it (the `len − i` segments up to the tail tip).
  - **Bone = (segments removed)² × max(1, Dinosaurs level).**
  - The tail tip pays 1, a middle cut pays for the length removed, and the head takes the whole dinosaur (length²).
  - What is left keeps roaming. Once the head is harvested, the dinosaur and its apples are gone and `plant(Entities.Dinosaur)` works again.
  - `measure()` is unchanged (null on a dinosaur).
  - Cutting the tail is also how you free a dinosaur that has boxed itself in.
- **Blocked on dinosaur or apple tiles:**
  - `plant` (existing "Tile already has …").
  - `till` and `swap` (new "not possible on the dinosaur or an apple"; `swap` checks both tiles).
  - `use_item(Fertilizer)` gives "Nothing growing here".
  - A test checks that a failed attempt leaves the serialized state unchanged.
- **Mazes:** spawning a maze replaces the whole farm, so the dinosaur and its apples are removed (`state.dino = null`), the same as `clear()`. No apples can spawn while the maze is active.
  - After the treasure is harvested you can plant a new dinosaur.
  - `clear()`, Expand and Reset Save also remove the dinosaur.
- **Persistence:** `serialize()` adds `dino: { body: [[x, y], …], dir, st, at } | null`. Segment and apple entities are already saved in the tiles.
  - The save format stays at `v: 1`.
  - Old saves have no `dino`, `Bone` or `Dinosaurs` field and load with no dinosaur, 0 Bone and Dinosaurs level 0.
  - A saved dinosaur is restored only if it is consistent: the chain is non-empty, in bounds, has no overlaps, each segment is next to the previous one (no wrap), every segment tile holds a Dinosaur, and there is no active maze.
  - Otherwise every Dinosaur and Apple entity is stripped. Stray Dinosaur tiles outside a valid chain are removed. Timers outside their range load as 0.

## Numbers chosen
| What | Value | Reasoning |
|---|---|---|
| Dinosaurs unlock (level 1) | 600 🪙 + 6,000 🌵, requires Mazes | Next tier after Mazes (2,000 🌵 + 2,000 🎃), so you have to run mazes first: 5 mazes on 12×12 at Mazes L1 (144 🪙 each), or 3 at L2 (288 🪙). 6,000 🌵 is the same cactus as Mazes L2. |
| Dinosaurs level 2 / 3 | 1,800 🪙 + 1,000 🦴 / 5,400 🪙 + 3,000 🦴 | The same `scale(base, 3, l−1)` curve as every other upgrade. The Bone part means you must farm bones to upgrade dinosaurs, just as Mazes L2+ needs Gold. |
| Max level | 3 | Matches Cactus, Watering and Mazes. |
| Dinosaur "seed" | 10 🪙 | Gives Gold a running use. It's small next to one maze payout, so the cost is the time spent, not the Gold. |
| Start length | 1 | |
| Move cadence | 1 step / 0.3 s of game time (3 world ticks) | Lively on screen, slow enough to watch, and the drone can still catch it. |
| Apple rate | 1 / 1.5 s (every 5 steps) | About one apple on the board for every 5 moves. |
| Apple cap | `max(1, ⌊size²/16⌋)` | 1 per 16 tiles, so apples stay sparse and growth comes from roaming. |
| Bone formula | (segments removed)² × level | Matches the original's squared length payout. The tail-end cut pays for the length removed, and length is worth more than the sum of its parts. |
| Icons | 🦖 Dinosaur, 🍎 Apple, 🦴 Bone, 🦕 Dinosaurs | |

**Measured feel**, from 200 simulated runs per size on an open farm:
- A pure random walk avoiding its own body eventually boxes itself in.
- On 8×8, the median length when that happens is 9 (10th–90th percentile 5–14), after about 48 s.
- On 12×12 the median is 10 (6–17), after about 64 s.
- So one head harvest pays about 100 🦴 at level 1. Dinosaurs L2 (1,000 🦴) is roughly 10 dinosaurs away.
- A stuck dinosaur is the natural "harvest me" signal. Cutting its tail frees it.

## Presentation
- **3D board:**
  - The dinosaur is one animated chain, not a model per tile. Records stay aligned by index with `game.dino.body`.
  - On each step every segment glides one tile forward and turns to face the segment ahead. A meal adds a segment (with a pop) where the tail was, and a harvest pops the cut segments away.
  - A new dinosaur somewhere else snaps into place instead of gliding across the farm.
  - The per-tile models skip Dinosaur tiles, the same way giant pumpkins hide their cells.
  - Segment models, all one merged, vertex-coloured mesh in the existing flat style:
    - **Head:** big rounded skull, a boxy snout with a pale jaw, a smile line, nostrils, large white eyes with pupils on top (readable at 55° whichever way it faces) and orange crest plates. Scaled ×1.12.
    - **Body:** squashed sphere torso with a pale belly and orange back plates, plus a thick "bridge" reaching forward to the next segment so the chain reads as one animal. Every other body segment has four stubby feet.
    - **Tail:** smaller torso, bridge, and a tapering, slightly upturned tip.
  - Segments taper from 1.0 to about 0.78 toward the tail.
  - **Apple:** a small red sphere (r = 0.15) with a dimpled top, a lighter cheek, a stem and a leaf.
  - I checked this visually in headless Chromium (SwiftShader) on 8×8 and 4×4 farms. The first version read like beads on a string, so the bridges got thicker, the head bigger and the tail tip shorter.
- **2D fallback:**
  - The head is 🦖, mirrored when heading East.
  - Body segments are green rounded blobs with orange plates; the tail is a smaller blob. Apples are 🍎.
  - Checked in headless Chromium.
- **Info strip:** shows `🦖 Dinosaur head 1/5 / Grassland`, `🦖 Dinosaur 3/5 / …` or `🦖 Dinosaur tail 5/5 / …` (segment counted from the head / length), and `🍎 Apple / Grassland`.
  - This uses the existing `stripFields().what` path, so the snapshot keys and the 250 ms sampling are unchanged.
- **Docs panel:** new "Dinosaurs 🦕" section covering hatching, roaming, apples, Bone and the interactions. The API rows (harvest, plant, till, swap, clear, can_harvest) and the constants lists are updated.
- **Example "8. Bone Farm"** (needs Dinosaurs, Plant, Senses and 10 Gold per dinosaur):
  - It calls `clear()`, then hatches a dinosaur at (0, 0) and waits 30 s with `get_time()` / `do_a_flip()`.
  - It then sweeps the farm column by column and harvests the dinosaur wherever it meets it, each time cutting off the tail behind that segment. It prints `Bone: …` after every sweep that paid.
  - `plant()` failing (one per farm) tells it the old dinosaur is still roaming, so it sweeps again. It stops with a message when Gold runs out.

## Tests (src/farmer/dino.test.mjs, 15)
- **Unlock and content:** placement after Mazes and the Mazes requirement, the costs for levels 1–3, `FUTURE_UNLOCKS` = Megafarm, the constants, icons and `.d.ts` text, and the locked/apple plant failures.
- **Spawn:** over grass or on an empty tile, pays 10 Gold, length 1, one at a time (nothing paid on failure), not on a crop, not without Gold. Runtime `get_cost` / `num_unlocked` / `get_entity_type` / `can_harvest` on a dinosaur.
- **Cadence:** no step at 0.29 s, a step at 0.3 s, and exactly 3 steps in the next second of 10 ms ticks.
- **Movement:** 1,500 ticks on 3×3, 5×5, 7×7 and 12×12 farms with random hedges and crops. After every tick:
  - the chain is in bounds, has no overlaps, is contiguous, and matches the Dinosaur tiles exactly
  - the head moved at most one tile (no wrap)
  - the head never entered its old body or a hedge or crop
  - `dir` matches the step
  - every offered move avoids the body and blocked tiles

  It also checks that the dinosaur really moves and grows.
- **Boxed in:** the dinosaur stays put.
- **Apples:** none without a dinosaur, exact timing, the cap (9 on 12×12), and they only land on empty or grass tiles. Eating grows the body by 1 with the tail staying put, then the length holds.
- **Harvest:** tail tip = 1, a middle cut of 3 = 9, the head = the whole dinosaur and its apples, after which a new one can hatch. Level 2: a 5-long head = 50.
- **Blocked:** plant/till/swap on the dinosaur and apple tiles, and harvest on an apple, change nothing (serialized snapshot). Runtime check `Apple false false null` plus the hint.
- **Maze rule:** a maze removes the dinosaur and its apples, no dinosaur or apples during the maze, planting again after the treasure, and `clear()`/Expand remove the dinosaur.
- **Save/load:** with a live, grown dinosaur, apples and mid-way timers, the round trip is exact (`dino`, tile types, full serialization). Both copies then evolve identically for 100 ticks on the same random stream, and the loaded dinosaur pays out.
- **Old saves and bad data:** old saves load. Not contiguous, overlapping, wrong tile, out of bounds, garbage, or a missing `dino` field all drop the dinosaur and leave no stray segments or apples. A stray extra segment is stripped and a bad timer becomes 0.
- **End to end on the demo farm:** `createDemoGame()` (all unlocks maxed, 8×8 full of crops, 1,440 Gold) with simulated time runs example 8 until 3 dinosaurs have hatched, with no errors. It checks that the `Bone:` lines strictly increase and match the inventory, the dinosaur grew to ≥ 3, and Gold dropped by exactly 10 per hatch.
  - I also ran it by hand with 3 more seeds and once at Speed 0 with no Power; it keeps producing Bone (for example 0 → 570 in 5 simulated minutes).
- **Info strip:** head, middle and tail labels, and the apple.
- **3D:** every segment part and the apple build with sensible sizes. The snout points +z, body parts bridge forward, `setDinoPart` swaps the geometry, and the `dinoPartFor` / `dinoYaw` helpers are checked.
  - Scene: Dinosaur tiles get no per-tile model while the apple and bush do. After a meal there are 4 segments and the old tail became body; the segments glide onto their tiles. Harvesting the head pops every segment away.

## Uncertain / worth a look
- **Crops block the dinosaur.** The brief only names its own body and hedges. I also block crops, because one tile can hold only one entity, and trampling would silently destroy plants. Grass is the exception: it regrows everywhere, so the dinosaur tramples it.
- **No eating the tile the tail is leaving.** "Cannot enter its own body" is taken literally, so it includes the current tail tile. This plus the random walk is why dinosaurs box themselves in (see "Measured feel").
- **No way to locate the head from code.** `measure()` is unchanged as the brief asks, so scripts find the dinosaur by sweeping with `get_entity_type()`. Only the info strip shows which segment you are over. A future sense (for example `measure()` on a dinosaur returning the segment index) would make "cut at the head" strategies possible.
- **Movement doesn't scale with Speed.** Like plant growth, it runs on world time, not drone speed. At Speed 0 a full sweep of a 12×12 farm takes about 29 s, during which the dinosaur makes about 96 steps.
