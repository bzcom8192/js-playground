# RESULT19 — v5 phase 2: seeded dino + dino verification (BRIEF19)

Branch `farmer-game`, on top of `bbb635e`. Nothing was pushed.

| Commit | What |
|---|---|
| `269e2fc` | Code + tests |
| (this file) | RESULT19 summary |

## Tests

| | Before | After |
|---|---|---|
| Farmer | 271 / 271 | **285 / 285** (+14) |
| Server | 33 / 33 | **35 / 35** (+2) |
| Lint, build | clean | clean |

- **New tests.** Farmer (14): same seed + program → identical path, apples and Bone; other seeds
  diverge; a record's seed replays its run; frame-rate independence (16 ms … 6 s and uneven frames);
  save/load mid-walk; old saves; demo; records; the benchmark; sending a program once. Server (2): no code
  → 400, unverifiable → 422, known program → measured Bone, tampered numbers ignored. The existing
  phase-1 DB test now also has an old dino row.
- **Changed tests:** only those that encoded the old rule (dino without code accepted, rows
  unverified) or fed the walk from the world rng. They now set a dinosaur seed.
- **One flake, not from this work:** `megafarm.test.mjs` "real clock: a busy-looping drone…" failed
  once at load average ~7 and passed alone and in every later full run. It measures wall time.
- **Mechanics check:** 27 solo arena runs, 6 maze verifications and all constants (minus the new
  `DEMO_DINO_SEED`) hash the same on `bbb635e` and on this tree (throwaway script).
- **Browser check** (headless Chromium, throwaway server + DB): an old-format save with a live
  seedless dinosaur got a seed on load, a run set a record, one POST went out with the code, the Dino
  board showed the row with ✓, and a seed queued in the Almanac was saved. No page errors.
  Not looked at: phone width, the Field Guide text, the 🌐 log line in the Output tab.

## Seed design

- `state.dino` has `seed`, `draws`, `start` (hatching tile). Draw *n* is draw *n* of `mulberry32(seed)`
  (`mulberry32At` in `maze.js`), so the stream's position is a plain counter that saves exactly.
- **Step choices and apple tiles** come from that one stream; the world rng is no longer used.
  **Apple timing** is the existing fixed 1.5 s cadence counted from hatching, so it never was random
  and is unchanged.
- Steps and apples that fall due in one frame now run in time order (apple first on a tie, as
  before). Before, a long frame did all its apples first, so the walk depended on the frame rate.
- Where a seed comes from: the world's fixed one (demo `DEMO_DINO_SEED` = 12, or the benchmark) → the
  queued one (`pendingDinoSeed`, used once) → random. The Output log prints `Dinosaur seed: N`.
- **Old saves:** a live dinosaur without a seed gets one on load and keeps it. Its hatching tile is
  unknown, so its record shows the seed as plain text, "hatched before seeds: not repeatable".
- **Demo:** fixed seed, records off, `serialize` writes no dinosaur.
- **Records:** the best harvest also stores `seed, size, sx, sy`. The Almanac shows the seed like a
  maze's (click = use it for the next dinosaur) and the seed box has a Maze and a Dino button.

## Benchmark definition

`DINO_BENCHMARK` (`onlineRules.js`), `dinoVerifyWorld` / `verifyDino` (`verify.js`).

| | |
|---|---|
| Farm | 12×12, grown Grass on every tile, no weather, no maze |
| Dinosaur | hatched on **(6, 6)**, length 1, **seed 4188**. Every later egg of the run has seed 4188 too, so `clear()` + replant is no re-roll |
| Bot | (0, 0), one bot (`spawn_bot()` allowed, 12) |
| Unlocks | all at the top level (Speed 5, Dinosaurs 3 → Bone = segments² × 3) |
| Inventory | 1,000,000 of each item; Power 0 (as on the maze farm); **Bone 0**, so programs that count Bone behave |
| Randomness | world rng and the program's `Math.random()` seeded from 4188 |
| Tick cap | **3,000 world ticks** of 100 ms = 300 s of farm time = 1,000 dinosaur steps, 200 apple spawns |
| Other limits | 2,000,000 API calls, the usual worker and 10 s timeout |
| Score | largest single harvest's Bone (any cut, head included); `ticks` / `ops` = run counters at that harvest. First one on a tie |

- **Why world ticks:** run-clock ticks pass 32× faster than farm time at Speed 5, so a cap of a few
  thousand of those would be about ten dinosaur steps.
- **Why 4188:** a plain waiting dinosaur boxes itself in at a median length of about 10 on 12×12
  (40 seeds). 4188 reaches 10 and stays free longest of six candidates (about 107 s).
- Replay cost here (load average ~7): 0.1–1 s for one bot, up to 5.7 s for 12 bots with no memory failure.

## Endpoint changes

- `POST /api/scores`, `category: "dino"`: **`code` required** (else 400). `value`, `ticks`, `ops`, `seed`
  are accepted and ignored; they describe the player's own farm, not the benchmark.
- The server stores `value` = measured Bone, `ticks`, `ops`, the benchmark seed / size / tile, `code`,
  `verified = 1`. It answers 201 with those (no code) plus `claimed: { value } | null`.
- 422 `dino score rejected: …` when the run harvests nothing (failed, ended, 3,000 ticks, op budget)
  and 422 `could not verify …` on a timeout or crash. 429 when the verifier queue is full, as before.
- `GET /api/leaderboard?category=dino` ranks verified rows only. **No schema change:** old trust-based
  rows stay in the table, off the board.
- **Client:** dino records go out with the program as it ran (helper files included). The Online
  window shows ✓, the "ยังไม่ยืนยัน" mark is gone, and the log names the benchmark result.

## Decisions and caveats

1. **The board shows the benchmark result, not the local record**, so the numbers usually differ. In
   the browser check a 12 Bone local run scored 3. A program tuned to a smaller farm can score nothing.
2. **Submission still needs a new local best** (the maze flow). Someone with a big old record who
   writes a better program only submits it after beating that record. A manual "submit" button would
   fix this; it was not in the brief.
3. **A program that fails or is cut off after a harvest keeps that harvest.** Maze runs end at the
   solve; a dino program normally loops forever, so this seemed the fair reading.
4. **The same dino program is sent once per page load**, because its result cannot change. A 422 is
   not retried either (editing the program or reloading does); offline, 429 and 5xx are.
5. **"Identical on every machine" is exact for the walk and for headless replays.** On the page a
   bot's moves run on real time, so *when* it meets the dinosaur can vary slightly between two runs.
   Weather (lightning) and crops also change where it can walk.
6. Local feel: same cadence, same uniform choice among free tiles; only the source of randomness
   changed. Planting an egg now uses one draw of the world rng (for the seed).
7. **All dino boards start empty** after this deploy. If the benchmark ever changes, old rows must be
   left out too; the stored seed and size tell them apart.
8. A bot's loop that only senses passes no farm time in a replay until the runaway guard slows it
   (existing behaviour); it costs ops, which are capped.
9. The briefs stay untracked as before. No git identity was configured on this machine, so Muse was
   passed per commit and the git config was not changed.
