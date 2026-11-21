# RESULT 8: JS Farmer v2, Phase 3 (Megafarm)

Branch: `farmer-game` (on top of `bebbf79`, Dinosaurs). Everything in BRIEF8-MEGAFARM.md is implemented. Not pushed.
`FUTURE_UNLOCKS` is now empty and the "Coming in v2" rows are gone from the Unlocks panel.

```bash
npm run test:farmer    # 153 tests (136 old + 17 new in src/farmer/megafarm.test.mjs), all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency.

**Two existing assertions changed:** `maze.test.mjs` and `dino.test.mjs` both asserted `FUTURE_UNLOCKS = ["Megafarm"]`. The brief requires the list to be empty, so both now expect `[]`, and their titles say "no future unlocks remain". No other existing test was touched.

## Files
- **`constants.js`**:
  - `Unlocks.Megafarm` and the Megafarm unlock row (after Dinosaurs, requires Dinosaurs).
  - `maxDrones(size)`, the cap rule.
  - `FUTURE_UNLOCKS = []`.
- **`world.js`**:
  - `state.drones`, the drone list.
  - `newDrone`, `allDrones`, `withDrone`, `droneCap`, `spawnDrone`, `resetDrones`.
  - Maze handling for extra drones.
  - Save/load of the drone list.
- **`runtime.js`**:
  - Each Run is now a session holding one program instance (`ctx`) per drone.
  - `spawn_drone()`, `num_drones()`, `max_drones()`.
  - The per-drone error rule, and the `onDroneError` callback.
- **`transform.js`**: `spawn_drone` is added to `ACTIONS`, so the transform awaits it like any other action.
- **`farmerLib.js`**: `.d.ts` declarations and globals for the three new functions. The `get_time` / `get_tick_count` docs now describe their multi-drone meaning.
- **`droneBands.js`** (new): hat band colours for each drone index, shared by 3D and 2D.
- **`board3d/models.js`**: `buildDrone(band)` takes the band colour. Each colour gets its own cached geometry, and drone 0's stays `droneBody`.
- **`board3d/FarmScene.js`**: draws one drone model per drone. Drone 0 is still `fs.drone`; the helpers are in `fs.extraDrones`, and `fs.droneRecs` lists them all.
- **`FarmBoard.jsx`**: the 2D fallback draws each drone with a new `DroneSprite` component and a coloured band.
- **`statusStrip.js` / `FarmerPage.jsx`**: the strip shows `🚁×N` when more than one drone exists.
  - **`FarmerPage.jsx`** also switches to the Output tab when any single drone fails.
- **`useFarmEngine.js`**: an `errorSeq` counter, bumped by `onDroneError`.
- **`UnlocksPanel.jsx`**: the "Coming in v2" block is removed.
- **`DocsPanel.jsx`**:
  - New "Megafarm 🏭" section.
  - API rows for `spawn_drone()` and `num_drones()` / `max_drones()`.
  - `clear()` and `get_time()` / `get_tick_count()` rows updated.
  - Megafarm added to the Unlocks constants list.
- **`examples.js`**: new example "9. Drone Squad".
- **`megafarm.test.mjs`**: new tests.

## The model as implemented
- **World:**
  - `state.drones` is a list of `{ x, y, flips }`. `state.drone` is always `drones[0]`, the original drone. The info strip, the UI buttons and all existing single-drone code read `state.drone`, so they are unchanged.
  - `W.allDrones(state)` falls back to `[state.drone]` for hand-made states that have no list.
- **One function per drone:**
  - `W.withDrone(state, drone, fn)` points `state.drone` at the calling drone for one synchronous world call, then restores it (also on a throw).
  - The runtime wraps every action and sense this way. So `harvest`, `plant`, `move`, `measure`, maze treasure direction, dinosaur hatching and harvesting, `till`, `swap`, `use_item` and `clear` all act on the caller with no change to the world rules from phases 1–2.
  - Drones may share tiles and never block each other. Movement still only checks hedges and maze edges.
- **`spawn_drone()`:**
  - It is an action: 200 ticks, uses 1 Power if you have any, and is auto-awaited.
  - With Megafarm unlocked and below the cap, it adds a drone on the caller's tile and returns `true`.
  - The new drone runs the **same program from the top**: the same combined multi-file program as the file you pressed ▶ on. It runs in its own instance, so its program variables are its own.
  - It starts on the next microtask, so none of its code runs inside the caller's `spawn_drone()` call.
  - It returns `false` with a one-time hint when:
    - Megafarm is locked: `🔒 Unlock Megafarm first (spawn_drone)`.
    - The cap is reached: `spawn_drone(): already N drones — the cap is N on a N×N farm`.
    - It is called outside a running program, e.g. a smuggled reference called after the run ended: `spawn_drone(): only works inside a running program`.
- **Also added:** `num_drones()` (drones on the farm) and `max_drones()` (the cap, or 1 while Megafarm is locked). Both are free senses that don't need Senses. Without them, a same-program-from-the-top drone can't tell whether it is the first one. The original game has both functions.
- **Cap rule:**
  - **max drones = the farm's side length, minimum 1**, i.e. `maxDrones(size) = max(1, size)`: 1 on 1×1, 6 on 6×6, 12 on 12×12.
  - The count includes drone 0 and every drone on the farm, including helpers whose program already ended (they are still on the farm).
  - The cap grows with Expand. Size never shrinks, so existing drones never exceed it.
- **Concurrency and fairness:**
  - Every instance runs on the event loop as before. During an action it sleeps for that action's time on its own timers, so drones really act in parallel: 2 drones × 5 moves take about 1.2 s, not 2.2 s (tested).
  - When busy without actions, an instance yields to the event loop after `YIELD_EVERY_MS` of work, as before. The macrotask queue is FIFO, so busy instances take turns round-robin, and timers (the page's game loop and render) run in between.
  - The tick budget is unchanged.
  - A real-clock test runs one drone in a bare `while (true) { n++ }` loop. The other drone still finishes its 7 actions, and a 10 ms UI interval keeps firing.
- **Shared state:**
  - Farm, inventory, unlocks, Power and the dinosaur are shared.
  - A harvest is credited once. When several drones hit the same tile, the first harvest takes the crop and the others find the tile empty (`false`). Tested with 4 drones sweeping the same 16 bushes: 16 Wood in total, 16 successful harvests across all drones.
  - Hints are de-duplicated per run, so 12 drones don't print the same hint 12 times.
- **Clocks:**
  - `get_time()` is one clock for the whole run: seconds since Run, minus paused time, the same for every drone.
  - `get_tick_count()` counts the calling drone's own ticks.
  - The info strip shows drone 0's ticks, actions and last `measure()`, plus the run clock.
- **Lifetime:**
  - Each new Run first dismisses every drone except drone 0, so `num_drones()` is 1 at the top of a fresh run.
  - When a run ends (done, stopped or error), its drones stay where they are, idle, and are saved. They disappear at the next Run, Reset Save or import.
  - The run stays "running" while any drone's program runs, so drone 0 finishing doesn't end the helpers.
- **Stop / Pause:** ■ stops every drone. ❚❚ pauses every drone, the world and the run clock, and ▶ resumes all of them.
- **Error rule:** an uncaught error stops **only the drone that threw it**.
  - The Log shows it with the drone number: `Drone 1: Line 5: Error: boom`. Drone 0's errors have no prefix, exactly as before.
  - The UI switches to the Output tab at once, even while other drones keep running (`onDroneError` → `errorSeq`).
  - When the last drone has finished, the run's status is `stopped` if you pressed Stop, otherwise `error` (with the first error's info, including `drone`) if any drone failed, otherwise `done`.
  - With one drone this is exactly the old behaviour: the error ends the run immediately with status `error`.
- **Mazes with several drones:**
  - The maze is generated around the drone that used the fertilizer.
  - Any other drone that ends up on a hedge is moved onto the maze start tile, so no drone can be walled inside a hedge.
  - `measure()` gives each drone the treasure direction from its own tile (tested).
  - Whichever drone harvests the treasure gets the Gold, once.
- **`clear()`:** resets the farm and moves the **calling** drone to (0,0); other drones stay where they are. The Clear Farm button and Expand act as drone 0, as before.

## Persistence
- `serialize()` adds `drones: [[x, y], …]` (drone 0 first) and still writes `drone: { x, y }` for older readers. The save format stays `v: 1`.
- `deserialize()` takes drone 0 from `drone` (as before) and helpers from `drones[1…]`.
  - Out-of-bounds or malformed entries are dropped, and the list is cut to the cap.
  - Old saves with no `drones` field, or a field that isn't an array, load as one drone.
  - Inside a saved maze, helpers on a hedge tile join drone 0.
- Programs never persist mid-run, so loaded drones are idle. The next Run starts with drone 0 alone.
- Round-trip test: 3 drones placed by a real run, then serialize → JSON → deserialize. Positions and the full serialization are identical, and a Run on the loaded farm starts with `num_drones() = 1`.

## Unlock cost
| What | Value | Reasoning |
|---|---|---|
| Megafarm (single level) | 2,000 🦴 + 1,500 🪙, requires Dinosaurs | It's the last tier and is paid only in endgame items. 2,000 Bone is about 20 dinosaur heads at Dinosaurs L1 (median about 100 🦴 each, from RESULT7), or about 10 at L2. 1,500 Gold is about 11 mazes on 12×12 at Mazes L1 (144 🪙) or 4 at L3 (432 🪙). That's in the same range as Dinosaurs L2 (1,800 🪙 + 1,000 🦴), so you have to run both mini-games for a while. |
| Max level | 1 | The brief ties the cap to farm size, not to a level, so more levels would have nothing to raise. |
| Icon | 🏭 | Kept from the old placeholder row. |

## Presentation
- **3D board:**
  - Every drone uses the existing pumpkin-drone model, with its own glide, yaw, flip and rotor animation. A newly spawned drone appears directly on its tile.
  - Drone 0 keeps its red hat band. Helper k gets `DRONE_BANDS[(k − 1) % 11]`: blue, green, purple, yellow, teal, pink, white, black, orange, sky and lime. Drones 1–11 (all 12 on a 12×12 farm) all differ.
  - Helpers bob out of phase with drone 0, so a stack of drones on one tile still reads as several.
  - Models are added and removed to match `game.drones`.
- **2D fallback:** each drone has its own sprite with the matching band colour and an offset bob phase.
- **I checked both visually** in headless Chromium: SwiftShader for 3D, and `--disable-3d-apis` for 2D. I used a 6×6 save with 5 drones. All 5 show, the bands are distinguishable, and the strip reads `📍 (0, 1) 🚁×5 · 🌿 Bush / Grassland · …`.
- **Info strip:** it still follows drone 0. A `🚁×N` chip appears only when N > 1. The snapshot keys and the 250 ms sampling are unchanged, so the single-drone strip is byte-for-byte the same (existing test).
- **Docs panel:**
  - New "Megafarm 🏭" section covering spawning, the same-program-from-top rule, the cap, shared state, and the stop and error rules.
  - New API rows, plus the updated `clear()` and `get_time()` / `get_tick_count()` rows.
  - Megafarm added to the constants.
- **Example "9. Drone Squad"** (needs Megafarm and Senses):
  - Drone 0 walks to the West edge.
  - Every drone then moves one column East, calls `spawn_drone()` and steps back. The helper starts the program again from there, so the spawning cascades column by column.
  - Each drone then harvests its own column forever.
  - On an n×n farm that is exactly n drones (the cap), one per column. The last drone prints `6 drones farming, 6 columns`.
  - Without Megafarm it prints a note and farms column 0 alone.

## Tests (src/farmer/megafarm.test.mjs, 17)
These use a new virtual clock built for several concurrent drones: `sleep` registers a timer, and the driver jumps to the earliest timer once every instance is waiting. The engine tests' per-sleep clock would make N drones run time N× too fast.
- **Unlock and content:** the row's position, requirement, cost and max level; buying it; `FUTURE_UNLOCKS = []`; the `.d.ts` text, globals and `ACTIONS`; the cap rule for every farm size.
- **World:** one drone in a new game. `spawnDrone` is locked, then works on the caller's tile, then hits the cap. `withDrone` routes to the right drone and restores it even after a throw. `resetDrones` works.
- **`spawn_drone`:**
  - Locked: `false`, the hint, 1 drone.
  - Unlocked: the helper starts from the top on the caller's tile, with the exact print order.
  - Cap: 4 drones on 4×4, exactly 3 successful spawns across all drones, each drone's extra call returns `false`, and the cap hint appears once.
  - Outside a running program: `false` and the hint.
- **Concurrency:**
  - Two drones run the same program and end on their own tiles. Their prints interleave, and it takes about 1.2 s, not 2.2 s.
  - The real-clock no-starvation test described above.
- **Shared inventory:** 4 drones sweep the same 16 bushes, giving 16 Wood, so each harvest is credited once.
- **Stop and Pause:**
  - Pause freezes all 3 drones and the run clock, and resume moves them all again.
  - Stop ends every instance and nothing moves afterwards. The statuses are `running, stopped`.
  - Drones stay idle on the farm, and the next Run starts with 1.
- **Error rule:**
  - A helper's error is logged as `Drone 1: Line 5: Error: boom`, `onDroneError` fires, and the run keeps going. Drone 0 finishes its moves, and the run ends with `error` (`info.drone = 1`).
  - Drone 0's own error is unprefixed and ends the run.
- **Per-drone world interaction:**
  - A helper on a would-be hedge is moved to the maze start.
  - Two drones in one maze each get `measure()` from their own tile.
  - A helper hatches a dinosaur and harvests it: Bone credited once.
- **Save/load with 3 drones:** the round trip, plus old saves, damaged lists, and truncation to the cap.
- **Example 9 end to end:** 6×6, drone 0 starting mid-farm. After 30 s there are 6 drones, one per column, no errors, and Hay is above 100. Without Megafarm it prints the note and uses 1 drone.
- **3D:** helper models are added and removed and get their own band geometry, they sit on their own tiles, and drone 0 still follows `game.drone`.
- **Strip:** no `drones` field with 1 drone, `drones: 2` with a helper, and it still shows drone 0's tile.

**Single-drone games:** all 136 existing tests pass unchanged, apart from the two `FUTURE_UNLOCKS` lines above.

## Deviations from the original game's Megafarm that I know of
- **No function argument:** the original's `spawn_drone(function)` starts the new drone on the given function. Here `spawn_drone()` takes no argument and the new drone runs the same program from the top (the brief's simplification). Programs have to branch on `num_drones()` or on position, as example 9 does.
- **No drone handles:** the original returns a drone handle (or `None`), and has `wait_for(drone)` to collect a drone's return value. Here you get a boolean, and there is no `wait_for`, return value or messaging between drones.
- **Drones don't vanish:** in the original a spawned drone disappears when its function returns. Here drones stay on the farm, idle, until the next Run, so the brief's "save loads them idle" has something to load. They still count toward the cap while idle.
- **Cap:** in the original the drone count comes from Megafarm upgrade levels. Here there is a single level and the cap is the farm's side length.
- **Clock:** `get_time()` here is the run's clock (as before), not a global game clock. `get_tick_count()` is per drone.
- **Shared memory:** each drone's program variables are its own, as in the original, where drones don't share globals. JavaScript's `globalThis` is still shared between drones, and nothing stops a program from using it.
- **Megafarm level in `num_unlocked`:** it just returns 0 or 1.

## Uncertain / worth a look
- **Drone 0 is not special during a run:** if drone 0's program finishes first, the helpers keep the run alive. Stop is the only way to end everything at once.
- **Helpers moved by mazes:** a helper on a would-be hedge is moved onto the maze start (the spawning drone's tile). That's a teleport, but the alternative is a drone permanently walled inside a hedge pillar. In a loaded save, helpers on hedges join drone 0.
- **`clear()` only moves the caller:** other drones keep their positions on the now-empty farm. I couldn't confirm what the original does here.
- **Small change for single-drone runs:** after a drone's program throws, any un-awaited callback flows of that drone now park at their next gate. Before, after an error those stray flows could keep acting with nobody watching. With several drones that would let a "stopped" drone keep moving, so they now stop. No existing test depended on the old behaviour.
- **`stats()` and `serialize()` gained fields** (`drones`). Nothing compares their keys, and the strip only adds its field when N > 1.
