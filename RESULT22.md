# RESULT22 — Mazes and Dinosaurs removed (BRIEF22)

Branch `farmer-game`, on top of `3c63e06`. Nothing pushed, `main` not touched, nothing deployed, the
buildbox server on :4188 not restarted (see caveat 7 about `dist/`).

| Commit | What |
|---|---|
| `7b0a828` | Server: the `maze` / `daily` / `dino` categories, `GET /api/daily`, the hidden weekly maze and `FARMER_SECRET` are removed. The Online window loses the leaderboard, the Daily Maze Race and the Dino button |
| `3f35ce9` | Progression and economy, plus game mechanics and UI (one commit, see caveat 6) |
| `d883d1d` | BRIEF22 tests: old saves, Megafarm on the new chain, contracts, removed names |
| (this file) | RESULT22 |

**Read first:** caveat 1. **Gold is kept**, because Rice still produces and consumes it.

## Tests

| | Before (`3c63e06`) | After `7b0a828` | After `3f35ce9` | After `d883d1d` (final) |
|---|---|---|---|---|
| Farmer | 316 / 316 | 281 / 281 | 232 / 232 | **242 / 242** |
| Server | 50 / 50 | 31 / 31 | 31 / 31 | **31 / 31** |
| Lint, build | clean | clean | clean | clean |

- Each commit was checked on its own. `3f35ce9` was checked in a clean worktree: tests, lint and build.
- **Flake:** the first full farmer run after `7b0a828` failed the known megafarm wall-clock test
  ("real clock: a busy-looping drone…") once, at box load about 8. It passed on a clean re-run and in
  every full run after that.

Change by file (farmer −74, server −19):

| File | Tests |
|---|---|
| `maze.test.mjs` | 16 → deleted |
| `dino.test.mjs` | 15 → deleted |
| `dinoSeed.test.mjs` | 8 → deleted |
| `daily.test.mjs` | 13 → deleted |
| `verify.test.mjs` | 15 → 2 |
| `online.test.mjs` | 27 → 18 |
| `records.test.mjs` | 19 → 11 |
| `board3d.test.mjs` | 20 → 18 |
| `progression.test.mjs` | 5 → 6 |
| `removal.test.mjs` | new, 9 |
| `server.test.mjs` | 50 → 31 |

**New or rewritten tests for what BRIEF22 asked:**
- **Old-save load and strip:** `removal.test.mjs`. It uses two real exports made by the BRIEF21 engine,
  in `src/farmer/testdata/`: a 6×6 farm inside a live maze (19 hedges, a treasure, 2 bots), and one with a
  3-segment dinosaur, 2 apples and crops.
- **Megafarm unlockable and payable end-to-end:** `progression.test.mjs`. It buys Cactus, earns
  everything on the farm (seeds included), buys Megafarm, then example 7 fills every column.
- **Contracts never reference removed items:** 120 days × 6 unlock sets × 3 farm sizes, plus saved contracts.
- **Server refuses the removed categories, `GET /api/daily` is gone:** `server.test.mjs`. A BRIEF21 DB
  file is also opened and checked byte for byte: its rows, secret and schema are untouched.
- **Removed names fail like unknown ones:** each program using `Entities.Dinosaur`, `Items.Bone`,
  `Unlocks.Mazes`, etc. gives the same warnings, return values and status as the same program with a name
  that never existed.

## Removed

- **Unlocks:** Mazes (Hedge Labyrinth, levels 1–3) and Dinosaurs (Dinosaur Egg, levels 1–3).
- **Items:** `Items.Bone`.
- **Entities:** `Entities.Hedge`, `Treasure`, `Dinosaur`, `Apple`.
- **Mechanics:**
  - maze generation (Fertilizer on a ripe Bush), the hedge walls, maze edges and the blocked actions inside a maze;
  - the maze Gold payout (`MAZE_GOLD_PER_TILE`), seeded mazes, the pending/replay seed;
  - `measure()`'s treasure direction. **`measure()` itself stays**: it still reads sunflower petals and
    cactus sizes, and now always wraps like `move()`;
  - the dinosaur: egg (24 Gold), walk, apples, tail-cut Bone, per-dino seeds, the demo's fixed dino seed,
    and the server's dino benchmark world;
  - `maze.js` is gone. Its seed helpers live on in `rng.js`: `mulberry32`, `randomSeed`, `parseSeed`.
- **Runtime:** the world-event plumbing for maze and dino records, `onRecord`, `timeExistingMaze`,
  `timeFromRunStart`, and the Apple exception in `can_harvest()`.
- **Records:** maze attempts and bests, histograms, the best dino haul, the replay seeds.
  Records are now `{ contracts: { completed, bonus } }`.
- **Client UI:**
  - **Almanac:** the replay-seed box, Best maze runs, Best dinosaur harvest and the dino seed line.
    It now shows run stats and contract totals.
  - **Online window:** the maze/dino leaderboard tabs, "ส่งคะแนน Dino", the Daily Maze Race section, the
    auto-submit of local records, and the client calls `leaderboard`, `submitScore`, `daily`,
    `scoreForRecord`, `submitRecord`, `submitDinoProgram`. Identity, arena, challenges and history stay.
  - **Guide:** the labyrinth and dinosaur sections and every mention elsewhere.
  - **Editor declarations:** the same, in `farmerLib.js`.
  - **Examples:** 7 (maze) and 8 (dinosaur) are removed; Megafarm is now 7 and Rice is 8, with their code unchanged.
  - **Elsewhere:** the inventory's Bone, the 2D board's hedge, chest, apple and dino drawing, and the
    status strip's maze and segment notes.
- **3D:** `board3d/setpieces.js` (hedge, chest, apple, dinosaur head/body/legs/tail), the scene's
  dinosaur chain, the "hedge hides its ground tile" rule, and the glossy material and `leafSheet` helper
  that only they used.
- **Server:**
  - `server/mazeBenchmark.js` and `FARMER_SECRET`;
  - the scores and settings queries, `addScore`, `leaderboard`, `dailyBoard`, `dailyEntry` and `secret()`;
  - the maze, dino and daily replays in `verify.js` and in the verifier's result check (arena only now);
  - in `onlineRules.js`: the categories and benchmarks, `validateScore`, `validateBoardQuery`,
    `betterScore` and `LEADERBOARD_LIMIT`;
  - `dailyRace.js`, `dailyClient.js`, `dailyWorker.js`, `onlineDaily.js`, `onlineDino.js` and `DailyRace.jsx`.

## Knock-on changes, old → new

### Megafarm (Bot Crew)

| | Old | New |
|---|---|---|
| Requires | Dinosaurs | **Cactus** (the tier Mazes chained from) |
| Cost | 1400 Bone + 2400 Gold | **40,000 Pumpkin + 30,000 Cactus** |
| Order in the Workshop | last | last (after Cactus) |

`spawn_bot()` and its alias, `num_bots()`, `max_bots()`, the cap, the shared clock and the arena's
Megafarm 1 are unchanged.

**How the price was set.** The measurements use the same harness as the progression test: virtual
clock, Guide examples, everything earned on the farm (seeds included). The farm is 8×8 with Overclock 3,
Grass 2, Carrots 2, Trees 1 and Pumpkins 2. Megafarm step only:

| Engine, price | Seed 1 | Seed 3 | Seed 7 |
|---|---|---|---|
| BRIEF21 engine, old price, bought right after Dinosaurs 1 | 2,856 s | 3,527 s | 3,493 s |
| BRIEF21 engine, old price, after Dinosaurs 2 (as RESULT21's playthrough did) | 820 s | 1,518 s | 1,620 s |
| New engine, 60,000 Pumpkin + 40,000 Cactus (tried, rejected) | 2,525 s | 2,518 s | 2,405 s |
| **New engine, 40,000 Pumpkin + 30,000 Cactus** | **1,681 s** | **1,681 s** | **1,662 s** |

- RESULT21's own playthrough had the Megafarm step at 1,500–2,000 s. The new price is in the middle of
  the old range, and well inside its order of magnitude.
- Income on that farm, with seeds in stock: pumpkins 52.9 /s; cactus 259 /s, which eats 8.3 Pumpkin /s.
  So pumpkins are the bottleneck, and a pumpkin-heavy price grows more slowly than cactus on bigger farms.
- The test asserts the step takes 1,000–2,500 s.

### Contracts

| Contract item | Old reward (value per unit) | New reward (value per unit) |
|---|---|---|
| Hay (tier 0) | Gold, 0.02 | **Pumpkin, 0.08** |
| Wood (tier 0) | Gold, 0.03 | **Pumpkin, 0.12** |
| Carrot (tier 1) | Gold, 0.1 | **Pumpkin, 0.4** |
| Pumpkin (tier 2) | Gold, 0.25 | **Pumpkin, 1** |
| Rice (tier 2.5) | Gold, 0.75 | **Pumpkin, 3** |
| Cactus (tier 3) | Gold, 0.5 | **Cactus, 1** (top tier) |
| Gold (tier 4, needed Mazes) | Bone, 0.5 | **removed** |
| Bone (tier 5, needed Dinosaurs) | Bone, 1 | **removed** |

- `reward = round(amount × value × 2)` as before.
- The new values are the old Gold ones converted at the table's own rates: 1 Gold = 4 Pumpkin = 2 Cactus.
  So every reward is worth what it was.
- **Pumpkin is the currency.** The top tier pays Cactus, the highest crop left (Expand 9, the Cactus
  levels, the Bot Crew): twice what you deliver. That is the premium tier, as the Bone contracts were.
- Example, 12×12: a Cactus contract of 216–360 paid 216–360 Gold, and now pays 432–720 Cactus.
- Rice: delivering pays 6 Pumpkin per Rice (= the old 1.5 Gold), against 1 Gold at the market.
- Amounts, tiers, deadlines and the daily draw are unchanged. Farms that had Mazes or Dinosaurs draw from
  a smaller pool, so their picks differ.
- `REWARD_ITEMS` and the Almanac's bonus totals: Gold, Bone → Pumpkin, Cactus.

### Rice → Gold trade: kept

Gold is still produced (`trade(Items.Rice)`, 1 Gold each) and consumed (Flooded Paddy 2:
4200 Pumpkin + 260 Gold). The brief removes Gold only "if nothing else produces or consumes" it, and Rice
is "otherwise unchanged". So `Items.Gold`, the trade and Rice 2's price all stay. See caveat 1.

### Fertilizer: kept, untouched

- It has a use outside mazes: instant growth, 3 s per dose on a plant that is still growing.
- The Compost Press unlock (after Pumpkins, 180 Pumpkin) and the market price (3 Pumpkin) are unchanged.
- Fertilizer on a ripe Bush now fails with "Nothing growing here" and is not spent.

### Everything else

- Every remaining price, yield, growth time, the unlock order and the tick costs are exactly as BRIEF21
  left them. The price-list test asserts every level.
- Weather, Rice and Arena are unchanged.
- `RULES_VERSION` stays 2, because no arena number moved (below).

## Saves: migration behaviour

A save written before BRIEF22 loads with no crash and no special case. The loader reads only what exists
today:

- **Unlocks:** the Mazes and Dinosaurs levels are dropped. Other levels load as saved, including a Megafarm
  already bought.
- **Items:** the Bone balance is dropped. Every other item loads as saved, Gold included.
- **No refunds** of any kind.
- **Records:** the maze attempts and bests, the dino record and the save's Gold/Bone contract bonus totals
  are dropped. The completed-contract count is kept.
- **The save's `maze`, `dino`, `pendingSeed` and `pendingDinoSeed` sections** are ignored and not written back.
- **Tiles:** a Hedge, Treasure, Dinosaur or Apple loads as no entity on the same ground with the same
  water. Bare Grassland grows grass again after the usual 0.5 s, so a farm saved inside a maze comes back
  as an empty meadow. Crops next to a dinosaur stay as saved.
- **Bots:** helper bots load at their saved tiles.
- **Today's contracts:** a Gold or Bone contract is dropped. The others keep their id, amount, status and
  deadline, and are re-priced in their new reward item. The day is not re-rolled, so no fresh set appears
  to re-earn.
- **Unchanged:** arena rating and history, weather, farm clock and drones.
- **Save shape:** same keys as before, minus `maze`, `dino`, `pendingSeed` and `pendingDinoSeed`; minus
  Bone in `items`; minus Mazes and Dinosaurs in `unlocks`; `records` holds only `contracts`. Save
  Data export/import is the same format and round-trips.
- **Demo mode:** unchanged apart from the Bone in its store room and its dino seed.
- **One small hardening:** a saved entity type now has to be an own key of `ENTITY_INFO`, so a name like
  `constructor` no longer loads as an entity.

## Server

- **`POST /api/scores`:** a token is still required first (401), then a bad body is still a 400. Then
  **every** category, `maze`, `daily`, `dino` or anything else, gets `400 {"error":"unknown category"}`,
  the existing answer for an unknown category.
- **`GET /api/leaderboard`:** the same 400 for any category.
- **`GET /api/daily`:** removed, now `404 no such endpoint`.
- **DB:** nothing is deleted and nothing is migrated.
  - A new DB file no longer gets the `scores` and `settings` tables.
  - An older file keeps them, rows, indexes and the old secret included, untouched and unread. A test
    dumps a BRIEF21-shaped file before and after a server run and compares them.
- **`server/README.md`:** the `FARMER_SECRET` row and the Daily Maze Race and Maze Leaderboard sections
  are dropped, and the one line is added.
  - I also corrected three lines that would otherwise be wrong now: two Rollback bullets about the
    `period` / `race_date` columns, which became one bullet on rolling back to a pre-BRIEF22 server, and
    the backup paragraph's "scores".

## Arena: byte-identical

- **What was run:** 15 fixed programs × 3 goals × seeds 1, 31, 777, 4242 = 180 runs, each through
  `runSolo` and the server's `verifyArena`.
  - The programs: the 3 rivals, the 8 kept Guide examples, a spinner, a sweep-harvester, a random walker
    and a program that uses `measure()`.
- **Result:** the full JSON dump of every result is **byte-identical** before (`3c63e06`) and after
  (`d883d1d`): sha256 `a082db34…6f75` both times. That holds with the old and with the new `examples.js`.
  The arena never had Mazes or Dinosaurs, and its unlock set merely loses the two zero entries.

## 3D: triangle delta

**Removed unique geometries:** 7, about **7,350 triangles** in all. `setpieces.js` is −442 lines.

| Model | Triangles |
|---|---|
| Hedge | 380 |
| Treasure chest | 2,020 |
| Apple | 588 |
| Dinosaur head | 2,546 |
| Dinosaur body (also the lone `Dinosaur` model) | 512 |
| Dinosaur body + legs | 832 |
| Dinosaur tail | 472 |

**Scenes that still exist:** identical before and after (seeded cactus sizes).

| Scene | Triangles |
|---|---|
| Demo farm | 69,822 |
| 12×12 grass | 205,422 |
| 12×12 pumpkin | 15,216 |
| 12×12 cactus | 143,430 |
| 12×12 tree | 196,554 |
| 12×12 rice | 169,998 |
| 12×12 bare | 11,886 |

- **Scenes that no longer exist** (RESULT21's numbers): a 12×12 maze, 41,646 visible; all hedges, 66,606;
  a 144-segment dinosaur, 110,328.
- **No dangling references:** a lint/grep sweep, plus a test that the old types build no model and hide
  no ground.
- **Built assets:** 16,349,489 → 16,216,613 bytes (−132,876).

## Browser smoke check

- **What:** headless Chromium on a `vite preview` of the final build, on port 4199, with the demo farm.
  It opened the Almanac, the Online window and the Field Guide.
- **Result:** no page errors, and none of the removed strings appear on the page (Labyrinth, Dinosaur,
  แข่งวงกต, ส่งคะแนน Dino, Replay seed, Best maze, Bone, Hedge, Maze L1).
  - The Almanac shows the run and contract totals.
  - The Online window shows Identity and Friend Arena.
  - The Guide shows examples 7 and 8 under their new numbers.
- **Note:** `vite preview` proxies `/api` to :4188. The Online window therefore made read-only GETs
  against the live old server (no identity, no writes).

## Caveats

1. **Gold stays.** It is still made (selling Rice) and spent (Flooded Paddy 2), so the brief's condition
   for removing it is not met. Contracts no longer pay it. Its whole economy is now: grow rice, sell it,
   buy Rice 2.
   - If you want Gold gone too, that needs three decisions: re-price Rice 2, drop or re-point the Rice
     trade, and decide what selling rice is for. Not done.
2. **The late game is shorter overall**, because two tiers are gone. On the farm measured above:
   - Cactus 1 → Megafarm took about 3,750 s on the old minimal path (Mazes 1, Dinosaurs 1, Megafarm);
     it is now about 1,680 s.
   - Only the Megafarm step itself was matched to the old grind.
3. **Contracts now pay Pumpkins from the very first farm.** The amounts are tiny early (a 1×1 farm's
   Hay contract pays 1 Pumpkin, a 5×5 farm's about 16). Pumpkins only matter from Expand 6 (220) on, so
   the early curve barely moves. It is not measured beyond the existing playthrough test, which still passes.
4. **Compost Press has no Guide example any more** (only the maze example used Fertilizer). The Guide
   text and the Workshop still explain it.
5. **A player with Dinosaurs but no Megafarm** keeps nothing for it: Bone and the levels are dropped,
   and the new price is due. Mazes already required Cactus, so the chain itself is open to them at once.
6. **Commit split.** Progression/economy and client mechanics+UI are one commit (`3f35ce9`). The unlock
   table, engine and UI import each other's removed symbols, so either half on its own would not build.
   The server and the tests are separate commits, and every commit is green.
7. **`dist/` and the :4188 server.**
   - My first build, while making `7b0a828`, wrote into `dist/`, which the live :4188 server serves.
     I restored it by rebuilding `3c63e06` into `dist/`, so the server serves the pre-BRIEF22 client
     again, as before this run. Every later build went to `/tmp`.
   - The server process was not restarted. Until it is, it runs the old code and still serves the maze,
     daily and dino endpoints. The watch process needs to rebuild `dist/` and restart it to deploy BRIEF22.
8. **Old scores in the production DB stay where they are, unserved.** A rollback to a pre-BRIEF22 server
   serves them again. Nothing new is written to them.
9. **Not verified:** real GPU, phone width, Thai glyphs (no Thai font here). The Online flows against a
   server running the new code were exercised by the server tests only, not in a browser.
10. RESULT21's caveat 1 (the maze path could be read out of the op counts) is moot: that board is gone.
11. Throwaway scripts (arena dump, triangle counts, price calibration, old-save fixture maker, smoke
    check) are in `/tmp/b22`, not in the repo. The briefs stay untracked as before.
