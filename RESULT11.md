# RESULT 11: JS Farmer v3, Phase 3 (Async Arena + ELO)

Branch: `farmer-game` (on top of `35ee06b`, Seeded Contracts). Everything in BRIEF11-V3-ARENA.md is implemented. Not pushed.

```bash
npm run test:farmer    # 203 tests (185 old + 18 new in src/farmer/arena.test.mjs), all pass
npm run lint           # 0 problems
npm run build          # ✓ built (the arena worker is its own chunk, arenaWorker-*.js)
```

No existing test was changed. No new dependency.

## Files
- **`arena.js`** (new, no DOM): the arena unlock set, the goal presets, the bot table, `arenaWorld(seed)`, the headless match runner `runMatch()` and `matchText()`.
- **`arenaRating.js`** (new, pure):
  - ELO (`eloExpected`, `eloDelta`) and the save's `arena` section (`emptyArena`, `sanitizeArena`, `recordMatch`).
  - It is a separate module so `world.js` can sanitize the section without importing the runtime (that would be an import cycle).
- **`arenaBots.js`** (new): the three opponents, rookie, pro and ace, as plain source strings.
- **`arenaWorker.js` + `arenaClient.js`** (new): the UI runs each match in a Web Worker, or on the main thread when Workers are unavailable (see "Performance").
- **`ArenaPanel.jsx`** (new), **`FarmerPage.jsx`**, **`useFarmerFiles.js`**:
  - The Arena window, opened by a sixth ⚔️ button in the top-right row.
  - Its window position is saved like the other windows.
- **`useFarmEngine.js`**: `recordArenaMatch(match)`. This is the only place a match touches the player's state: rating, history, a log line, then save.
- **`runtime.js`**: two new options, both off by default, so a normal farm is unchanged.
  - `arenaGoal` adds the `get_arena_goal()` sense and turns off contracts: `get_contracts()` returns `[]` and `deliver_contract()` fails.
  - `mathRandom` gives the program its own frozen `Math` with a seeded `random()`.
- **`world.js`**:
  - New `state.arena`, which is saved and loaded, survives a rejected farm part like records, and is `null` in a demo serialize.
  - One fix: the maturation roll in fertilizer's `use_item` used `Math.random` instead of the `rng` it is passed. This made rotten pumpkins after fertilizer unseeded. On the page `rng` is still `Math.random`, so nothing changes there.
- **`farmerLib.js`** / **`DocsPanel.jsx`**: the `get_arena_goal()` declaration and lint global, an API row, and an "Arena ⚔️" docs section.

## 1. Arena unlock set (decision)
**A fixed set, not the player's current unlocks.** Both sides always play the same game whatever the player owns, the result depends only on the seed and the two programs, and the bots (written against the full API) never meet a player who lacks things they use.

| unlock | arena level | why |
|---|---|---|
| Plant, Senses, Grass, Carrots, Trees, Watering, Pumpkins, Sunflowers, Fertilizer, Cactus, **Megafarm** | 1 | "everything up to Megafarm"; Megafarm gives 8 drones on 8×8 |
| Expand | 7 (= 8×8) | the farm size the brief specifies |
| **Speed** | **0** | buying Speed (Hay) is part of the race; at level 1+ everything would just run faster |
| **Mazes, Dinosaurs** | **0** | maze and dinosaur goals are out of scope, and locking Mazes removes the only fresh-world Gold source (see gold200) |

- `unlock()` works as on a normal farm, so a program may buy upgrades with what it farms (all three bots buy Speed).
- **The world:** each side starts with an 8×8 Grassland farm, Grass on every tile at a growth stage drawn from the seed, an empty inventory and one drone.
- **Not in the arena:** contracts, weather (doesn't exist yet), and the date (`today` is pinned).

## 2. Goal presets (final list)
| id | goal | pro (1 drone), seeds 1–15 | ace (8 drones), seeds 1–15 |
|---|---|---|---|
| `hay500` | first to hold 500 Hay | 50,850 – 51,150 ticks | 9,000 – 9,200 |
| `wood800` | first to hold 800 Wood | 80,475 – 81,075 | 33,725 – 33,925 |
| `pumpkin300` | first to hold 300 Pumpkin | 91,675 – 146,975 (rotten-pumpkin luck) | 44,275 – 91,025 |

**`gold200` is dropped.** In the arena unlock set there is no Gold source:
- maze treasure needs Mazes (locked, and the brief rules mazes out);
- contract rewards are turned off in the arena (they would also depend on the date).

The only way to get Gold would be to farm 2,000 Cactus + 2,000 Pumpkin and buy Mazes inside the match, which is a maze goal again.

- **Tick cap:** 200,000 ticks per match. The first side to hold the amount wins. At the cap the larger amount wins; equal amounts are a draw. Both reaching the goal at the same tick is also a draw.
- **What "tick" means here:** 1 tick = 1 ms of game time (virtual), so an action at base speed is 200 ticks, and 200,000 ticks = 1,000 base actions. The tick cap and the reported ticks use this match clock, not `get_tick_count()`, which counts 200 per action regardless of Speed or Power. That way Speed and Power really make you win sooner.

## 3. Determinism approach
- **Two worlds, one clock:**
  - Each side has its own `arenaWorld(seed)` and its own `createRuntime()`.
  - Every runtime `sleep(ms)` (and every yield, which is `sleep(0)`) puts a timer on that side's queue.
  - The driver waits one macrotask so all program code (microtasks) has run, then jumps the shared clock to the earliest timer of either side and wakes every timer due at that instant, in `(at, seq)` order.
  - This is the Megafarm test driver pattern, so N drones sleeping at once do not make time run N× faster.
- **Growth on a fixed grid:**
  - The worlds `tick()` every 100 ms of virtual time, like the page loop, never at timer boundaries.
  - So one side's action timing can never change the other side's world. A test checks this: pro reaches 500 Hay at the identical tick against four different opponents.
  - Mirror matches (pro vs pro, on every goal) are exact draws.
- **Seeded randomness:** every random draw comes from `mulberry32`:
  - the starting grass, from the seed;
  - the world `rng` (petals, cactus sizes, rotten pumpkins), seeded with the seed;
  - the program's own `Math.random()`, a separate, identically seeded stream for each side.
- **Nothing else is time- or date-dependent:** `get_time()` reads the virtual clock, record timestamps are pinned, and there are no contracts.
- **Tests:** same seed + same two programs → the identical result object (winner, ticks, amounts, per-side details) for pro vs ace on all three goals, and for a mirror match of programs that farm with `Math.random()`.
- **In the browser:** a Rematch with the same seed gave the identical result in the Worker.
- **Safety:**
  - **An error loses at once**, with the reason recorded: the first error log line, mapped to the file and line (`lib, line 3: ReferenceError …`). This covers syntax errors (at tick 0), runtime errors and a single failing Megafarm drone (the rest of that side is stopped). Both sides failing at the same tick is a draw.
  - **An infinite loop is cut by the tick cap.** A loop without actions hits the runtime's existing runaway throttle (10 ms sleeps on the virtual clock) and so runs into the cap. Two `while (true) {}` programs finish in about 0.4 s as a 0–0 draw at 200,000 ticks.
  - **Op budget:** 2,000,000 API calls per side. Past that, the side is stopped and keeps what it holds. With the runaway throttle it is never reached before the cap in practice, so the test uses a small budget.
  - A program that simply ends without reaching the goal just stops; the other side plays on. If both have ended, the match ends right away ("Both programs ended").
- **Isolation:**
  - The runner only builds throwaway worlds. A test serializes the player's save (inventory, records, contracts, clock, rating) before and after two matches, one of them a "vandal" program calling `clear()`, `unlock()` and `deliver_contract()`. The save is byte-identical, and a `localStorage` proxy records zero accesses.
  - Another test runs a match beside a live player run: it is undisturbed, and outside the arena `get_arena_goal()` is `null` and contracts work.
  - Only `recordMatch()` writes `state.arena`, after the match.

## 4. Bots
They are plain programs that go through the same transform and runtime as player code, with no special privileges. They use `get_arena_goal()` to read the goal.
- **rookie (800):** an inward square spiral that harvests what is ripe, plants bushes when the goal is Wood, then walks all the way back to the corner. Hay and Wood only, so it holds 0 Pumpkin. It reaches 500 Hay at ~104k ticks.
- **pro (1200):** `ensure_speed` / `ensure_hay` / `ensure_wood` / `ensure_pumpkin`, a single drone snaking column by column.
  - Speed comes first: up to level 2 for Hay, 3 otherwise.
  - Wood: a checkerboard of trees with bushes in between.
  - Pumpkin: hay → wood → tills the farm → carrots → pumpkins. Each empty soil tile gets a pumpkin if there is a carrot in stock, otherwise a carrot. Rotten pumpkins are cleared. When one sweep counts all 64 ripe it harvests the 8×8 square (512).
- **ace (1600):** pro's plan on a full Megafarm squad.
  - The first drone spawns one helper per column (8 drones) and every drone tends its own column.
  - Phases switch from the shared inventory: Speed → trees → (Hay going down = someone is planting carrots) → pumpkins.
  - The first drone sweeps the whole farm and harvests the square.
- **Measured** in the tests (seed 2): rookie loses to pro, pro loses to ace, and ace runs 8 drones. In plain node a single match takes 0.01–0.3 s (seed 7, every pairing and goal).

## 5. ELO and the save
- Standard ELO against the bot's fixed rating, K = 32. The delta is rounded to a whole point each match, so the rating stays an integer.
- From 1000 (tested):

| vs | win | draw | loss |
|---|---|---|---|
| rookie 800 | +8 | −8 | −24 |
| pro 1200 | +24 | +8 | −8 |
| ace 1600 | +31 | +15 | −1 |

- **Save shape**, in `farmer_save_v1`, still `v: 1`, as its own section (not in records):
  ```js
  arena: { rating: 1024, matches: [
    { at: 1795258052846, bot: "pro", goal: "hay500", result: "win", ticks: 50950, delta: 24, seed: 1080146534 }, … ] }  // newest last, ≤ 20
  ```
- **Load rules:**
  - Old saves start at 1000 with no matches.
  - Junk entries are dropped one by one (unknown bot or goal, e.g. `gold200`, bad result, negative ticks), and the history is cut to the last 20.
  - The section survives a rejected farm part.
- **Other paths:** export and import need no change (the section is inside `save`). Reset Save clears it. A demo farm never records and serializes `arena: null`.

## 6. UI
- **Button:** ⚔️ is the sixth button in the top-right row.
- **Window:** "Arena · rating N" (light stone style like Records, scrolls internally). From top to bottom:
  - the rating card, with the W / D / L rating change against the selected bot;
  - **Your file** (dropdown of your files; it runs with its helper files, exactly like ▶), **Opponent**, **Goal**, an optional seed (blank = random) and **⚔️ Run Match**;
  - a short rules line, and the bot's code in a collapsible block;
  - while running: "Racing…", the ticks out of 200,000, and two progress bars (you and the bot, towards the goal amount);
  - the result card: the winner, both final amounts (with the drone count when > 1), the reason line, ticks, seed, the rating change "−7 → 985" and **↻ Rematch** (same seed, bot and goal);
  - **History:** the last 20 matches, newest first (result chip, bot, goal, ticks, delta).
- **Log:** each match writes "⚔️ Arena: loss vs Pro (500 Hay, 50,950 ticks) — rating −7 → 985" to the Output log.
- **Demo mode:** the window shows "The arena is off on the demo farm" with a **Back to my farm** button, and no match can run.
- **Checked in headless Chromium** against the production build:
  - a match vs Pro on a fresh save, then a Rematch: identical result, both saved to `farmer_save_v1.arena` with the right deltas (−8, then −7);
  - ace on pumpkin300 from the farm page in 0.54 s;
  - the demo note;
  - no console errors.

## Deviations and uncertainties
- **Performance, and why there is a Worker.**
  - On the plain page a match takes 0.3–0.8 s. On the farmer page, run on the main thread, the runner's one-macrotask-per-step loop competed with the 3D board's rendering, and the same matches took 19–66 s in headless Chromium (software GL).
  - The UI therefore runs each match in a module Web Worker and falls back to the main thread when Workers are unavailable. The result is identical either way.
  - Under `node --test` matches run ~5× slower than in plain node, probably because of the test runner's async tracking. The arena tests take ~12 s of the suite.
- **New API function `get_arena_goal()`.** The brief did not ask for it, but a race "to a production goal" needs the programs to know the goal. The bots use it too, so they have no privilege over the player.
- **Ticks are game-time ms, not `get_tick_count()` ticks** (see §2). I think that is the fair clock, but with Speed or Power the two differ.
- **The tech tree is not respected in the arena:** Megafarm is on while Mazes and Dinosaurs (its prerequisites) are off, and Speed starts at 0. This is deliberate (§1).
- **History entries have two extra fields** beyond the brief's `{ at, bot, goal, result, ticks }`: `delta` (so the history can show rating changes) and `seed` (for replays).
- **Not virtualized:** `Date.now()`, `performance.now()` and real `setTimeout` inside a program. A program that uses them can be non-deterministic, and a real `setTimeout` callback could fire after the match. `globalThis` is also shared by both sides (they run in the same realm), so a program could in theory read a flag the other side sets. None of the bots do any of this.
- **Closing the window mid-match does not cancel it.** The match finishes in the worker and is still recorded and logged. There is no Cancel button.
- **Bot strength is my tuning.** Pro's pumpkin times swing with rotten-pumpkin luck (worst seed 147k of the 200k cap). Ace's single goal check relies on the first drone sweeping the farm, so an unlucky seed can take up to ~91k ticks.
