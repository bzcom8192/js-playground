# RESULT21 — cleanup batch (BRIEF21)

Branch `farmer-game`, on top of `1a9b92b`. The four items were written by an earlier run that
stopped before this file. This run (BRIEF21-FINISH) read the diffs, verified, measured and wrote
this summary; **no game code was changed in it**.

| Commit | What |
|---|---|
| `3d286fb` | Item 1: hidden weekly maze for the leaderboard |
| `a1f3687` | Item 2: 3D detail pass, round 2 |
| `e51cddb` | Item 4: manual Dino submit button |
| `6c24270` | Item 3: our own progression curve |
| (this file) | RESULT21 summary |

**Read first:** caveat 1. The seed stays hidden, but a player can still get the week's *path* out
of the server by reading the op counts of about a dozen submissions.

## Tests

| | Before (`1a9b92b`) | After (`6c24270`) |
|---|---|---|
| Farmer | 297 / 297 | **316 / 316** (+19) |
| Server | 43 / 43 | **50 / 50** (+7) |
| Lint, build | clean | clean (build prints only the usual plugin-timing note) |

"After" was run for this file. "Before" is RESULT20's result; the test counts in the sources match.
By item (farmer / server): 1: +6 / +6, 2: +3 / 0, 4: +5 / 0, 3: +5 / +1.

- **Maze:** seed depends on secret, week and level only; same week → same maze, next week → another;
  seed and layout in no answer; arrival week counts; client numbers ignored; legacy rows; secret kept
  per DB; parking, blind spreading and timeline tricks gain nothing; Bangkok ISO weeks.
- **Models:** smooth / indexed / shared, triangle budgets, ground hidden only under a grown hedge.
- **Dino button:** request body, refusals, 30 s wait, on/off rules, result text (mock fetch).
- **Retune:** the whole price list, what must not move, the curve's shape, economy checks, a headless
  playthrough to pumpkins, an old challenge whose author is measured again.

### Mechanics hashes (throwaway script, each commit exported separately)

| | `1a9b92b` | items 1, 2, 4 | `6c24270` (item 3) |
|---|---|---|---|
| Arena, 27 runs | `5ca2fc8c` | same | **`02b0089e`** |
| Daily race, 9 runs | `8a4724ea` | same | same |
| Dino benchmark, 4 programs | `005d00e3` | same | same |
| Hidden maze, 18 runs (since item 1) | – | `67c98fc1` | same |

- Tick and op costs did not move (200 / 600 / 1 are also asserted).
- **The brief's "arena uses max unlocks and stock" is not so.** Arena starts with an empty store at
  level 1, so item 3 changes it. Solo ticks, seed 1, old → new: rookie hay 103,800 → 69,600;
  pro hay 50,950 → 41,850, wood 80,675 → 73,275, pumpkin 93,775 → 92,875; ace hay 9,200 → 8,900,
  wood 33,925 → 35,975, pumpkin 50,625 → 50,000. Seed 31 pumpkin is slower: pro 104,575 → 134,075,
  ace 53,475 → 87,600.
- So challenges now store `RULES_VERSION` (2; null = before). Answering an older one replays its
  author too, and both results are stored under the new numbers.

## 1. Maze leaderboard: the parking trick and the fix

**Mechanism.** A maze score carried its own seed, farm size and start tile, all chosen by the player
(the Almanac can queue a seed). The layout, so the treasure tile, follows from those three. The
replay's clock started **when the maze was grown**, not when the program started, and growing a maze
only moved bots that ended up *inside a hedge*. So:

1. Pick a seed and work out the treasure tile.
2. Spawn a second bot and drive it there over open field. Nothing is timed yet.
3. Bot 1 grows the maze. The clock starts; bot 2 stands on a path tile, so it stays.
4. Bot 2 harvests.

Measured again on `1a9b92b`: 12×12, seed 424242, **1 tick / 2 ops**, against 23,919 ticks for a depth-first
solver and 30,479 for the Guide's example; the same 1 tick on 8×8. The daily race was already
immune (its maze stands before the program starts).

Found with it: a helper's timeline could be run ahead with free senses before the clock started, the
replay's `Math.random()` was seeded from the maze seed, so a program could test guesses of it, and a
player could choose a trivial maze (a 1×1 farm solves in 201 ticks).

**Fix.**
- **Seed:** `HMAC-SHA256(server secret, "maze-benchmark:<week>:L<level>")`, first 32 bits
  (`server/mazeBenchmark.js`; the client never imports it). One maze per level and Bangkok ISO week
  (`2026-W47`), new every Monday 00:00 Bangkok. The week is fixed when the request **arrives**.
- **Secret:** `FARMER_SECRET` (≥ 16 characters) or a random one made once and kept in the DB (new table
  `settings`). A DB backup therefore contains it.
- **Never sent:** not stored with the score (`seed` is null), not in any answer. 422 texts are fixed
  strings, because an error message could spell out the walls.
- **Benchmark:** 12×12, start (0, 0), public `rngSeed` 2112 for everything else random. Seed, size, start,
  ticks and ops in the request are ignored; only `code` and `level` count.
- **Clock:** from the **start of the run**, and growing the maze gathers every bot on the start tile (benchmark
  only). A maze grown on another tile is an unrelated decoy; if the program never grew the benchmark
  maze, it gets a second run with the maze already standing.
- **Storage:** `scores.period`, nullable, added in place. **Nothing is deleted.** Entries without a period
  stay on the board after the ranked ones, with no rank and a "legacy" mark. A player can have both.
- The board is all-time: entries of different weeks, so of different mazes, rank together.

## 2. Detail pass, round 2

Triangles per model, old → new (same counting as RESULT18):

| Model | Triangles | Vertices | What |
|---|---|---|---|
| Hedge | 156 → **380** | 468 → 496 | uneven rounded body, 5 tufts, about 98 leaves on top and the three visible sides, darker near the ground |
| Chest | 336 → **2,020** | 1,008 → 1,503 | planked box, barrel lid with staves, rim, two riveted bands, ring handle, hasp, padlock with keyhole, coins |
| Apple | 248 → **588** | 744 → 314 | lobed body with hollows, streaked skin, bent stem, leaf, blossom end |
| Dino head | 560 → **2,546** | 1,680 → 1,329 | one skull-and-snout skin, jaw, smile, nostrils, cheeks, eyes with iris, glints and lids, crest |
| Dino body | 296 → **512** | 888 → 290 | one skin from rump to bridge, belly, bands, fins, freckles |
| Dino body + legs | 392 → **832** | 1,176 → 494 | the same plus thighs, feet, claws |
| Dino tail | 186 → **472** | 558 → 262 | tapering skin, fins, leaf tuft |

- **Joins:** each bridge now ends inside the segment ahead. Animation and segment logic are untouched.
- Geometry is smooth, indexed and shared per variant. As before, nothing uses `InstancedMesh`.
- **Scenes (12×12):** maze with 73 hedges 23,610 → 41,646 visible triangles, all hedges 34,350 → 66,606,
  144-segment dinosaur 61,480 → 110,328. Tested budgets: 180k for a maze, 300k for the others.
- The ground tile under a full-grown hedge is no longer drawn (two draws fewer per wall): 456 → 310 draw calls.

**Render cost** (re-measured, `3d286fb` against `a1f3687` in one page, alternating; SwiftShader, 1920×1080,
median ms per frame over 12 frames each, two rounds; box load 8–12):

| Scene | Round 1 | Round 2 | Submitted triangles |
|---|---|---|---|
| Maze | 557 → 453 | 549 → 357 | 23,322 → 38,876 |
| Maze, shadow redrawn | 544 → 545 | 561 → 466 | 36,726 → 70,316 |
| Dinosaur 8×8 (48 segments), shadow | 390 → 446 | 456 → 347 | 44,890 → 81,650 |
| 9-segment dinosaur on wheat 12×12, shadow | 1,448 → 1,655 | 1,516 → 1,637 | 362,834 → 378,314 |
| Demo (unchanged control) | 459 → 614 | 529 → 594 | 69,716 → 69,716 |

The control moved by +12 to +34 % with identical content, so that is the noise. Maze is equal or faster,
and the dinosaur scenes are within it (the wheat one was +8 and +14 %). This is ms per frame, not the
rAF fps of RESULT18; no fps count and no real GPU was measured.

Screenshots from the earlier run: `~/semicolon-acres-brief21-pieces.png` (`-before.png`), `-maze.png`.

## 3. Progression: full old → new table

Order, requirements, level counts, farm sizes and ids are unchanged.

### Upgrade prices

| Upgrade | Old | New |
|---|---|---|
| Speed 1 | 20 Hay | 24 Hay |
| Speed 2 | 60 Hay | 90 Hay |
| Speed 3 | 180 Hay | 280 Hay |
| Speed 4 | 540 Hay | 800 Hay |
| Speed 5 | 1620 Hay | 2200 Hay |
| Expand 1 | 30 Hay | 45 Hay |
| Expand 2 | 20 Wood | 36 Wood |
| Expand 3 | 40 Wood + 20 Carrot | 70 Wood + 40 Carrot |
| Expand 4 | 80 Wood + 50 Carrot | 140 Wood + 90 Carrot |
| Expand 5 | 150 Wood + 100 Carrot | 260 Wood + 180 Carrot |
| Expand 6 | 300 Wood + 100 Pumpkin | 480 Wood + 220 Pumpkin |
| Expand 7 | 500 Wood + 300 Pumpkin | 850 Wood + 650 Pumpkin |
| Expand 8 | 1000 Wood + 1000 Pumpkin | 1600 Wood + 1800 Pumpkin |
| Expand 9 | 2000 Wood + 2000 Pumpkin + 200 Cactus | 3200 Wood + 4200 Pumpkin + 360 Cactus |
| Plant 1 | 10 Hay | 16 Hay |
| Senses 1 | 15 Hay | 28 Hay |
| Grass 1 | 40 Hay | 60 Hay |
| Grass 2 | 120 Hay | 170 Hay |
| Grass 3 | 360 Hay | 480 Hay |
| Grass 4 | 1080 Hay | 1300 Hay |
| Grass 5 | 3240 Hay | 3500 Hay |
| Carrots 1 | 50 Wood | 70 Wood |
| Carrots 2 | 100 Wood + 50 Carrot | 160 Wood + 90 Carrot |
| Carrots 3 | 300 Wood + 150 Carrot | 420 Wood + 260 Carrot |
| Carrots 4 | 900 Wood + 450 Carrot | 1150 Wood + 700 Carrot |
| Carrots 5 | 2700 Wood + 1350 Carrot | 3000 Wood + 1900 Carrot |
| Trees 1 | 100 Hay + 50 Wood | 150 Hay + 90 Wood |
| Trees 2 | 200 Wood + 50 Carrot | 320 Wood + 80 Carrot |
| Trees 3 | 600 Wood + 150 Carrot | 900 Wood + 220 Carrot |
| Trees 4 | 1800 Wood + 450 Carrot | 2400 Wood + 600 Carrot |
| Trees 5 | 5400 Wood + 1350 Carrot | 6500 Wood + 1600 Carrot |
| Watering 1 | 100 Wood + 50 Carrot | 130 Wood + 70 Carrot |
| Watering 2 | 300 Wood + 150 Carrot | 380 Wood + 240 Carrot |
| Watering 3 | 900 Wood + 450 Carrot | 1200 Wood + 800 Carrot |
| Pumpkins 1 | 200 Carrot | 260 Carrot |
| Pumpkins 2 | 300 Carrot + 100 Pumpkin | 420 Carrot + 160 Pumpkin |
| Pumpkins 3 | 900 Carrot + 300 Pumpkin | 1100 Carrot + 550 Pumpkin |
| Pumpkins 4 | 2700 Carrot + 900 Pumpkin | 3000 Carrot + 1700 Pumpkin |
| Pumpkins 5 | 8100 Carrot + 2700 Pumpkin | 8000 Carrot + 5200 Pumpkin |
| Sunflowers 1 | 100 Pumpkin | 140 Pumpkin |
| Fertilizer 1 | 100 Pumpkin | 180 Pumpkin |
| Rice 1 | 1500 Pumpkin + 500 Carrot | 1800 Pumpkin + 800 Carrot |
| Rice 2 | 3000 Pumpkin + 150 Gold | 4200 Pumpkin + 260 Gold |
| Cactus 1 | 200 Pumpkin | 320 Pumpkin |
| Cactus 2 | 500 Pumpkin + 100 Cactus | 900 Pumpkin + 160 Cactus |
| Cactus 3 | 1500 Pumpkin + 300 Cactus | 2600 Pumpkin + 700 Cactus |
| Mazes 1 | 2000 Cactus + 2000 Pumpkin | 2400 Cactus + 3000 Pumpkin |
| Mazes 2 | 6000 Cactus + 300 Gold | 6500 Cactus + 500 Gold |
| Mazes 3 | 18000 Cactus + 900 Gold | 16000 Cactus + 1800 Gold |
| Dinosaurs 1 | 600 Gold + 6000 Cactus | 1100 Gold + 7000 Cactus |
| Dinosaurs 2 | 1800 Gold + 1000 Bone | 2600 Gold + 650 Bone |
| Dinosaurs 3 | 5400 Gold + 3000 Bone | 7500 Gold + 2400 Bone |
| Megafarm 1 | 2000 Bone + 1500 Gold | 1400 Bone + 2400 Gold |

### Growth time and seed

| Plant | Old | New |
|---|---|---|
| Grass | 1 s, free | 1.5 s, free |
| Bush | 4 s, free | 6 s, free |
| Tree | 7 s, free | 10 s, free |
| Carrot | 6 s, 1 Wood + 1 Hay | 8 s, 1 Wood + 2 Hay |
| Pumpkin | 3 s, 1 Carrot | 5 s, 2 Carrot |
| Sunflower | 5 s, 1 Carrot | 7 s, 3 Carrot |
| Cactus | 2 s, 1 Pumpkin | 3.5 s, 2 Pumpkin |
| Rice | 9 s, 1 Carrot | 12 s, 3 Carrot |
| Rice at level 2 | 1.5× faster (6 s) | 1.6× faster (7.5 s) |
| Dinosaur egg | 10 Gold | 24 Gold |

### Yields by level

Level 0 = the crop can be planted but its own upgrade is not bought.

| What | Levels | Old | New |
|---|---|---|---|
| Hay per cut (Grass) | 0–5 | 1 / 2 / 3 / 4 / 5 / 6 | 2 / 3 / 5 / 8 / 12 / 18 |
| Wood per bush (Trees) | 0–5 | 1 / 1 / 2 / 3 / 4 / 5 | 2 / 2 / 3 / 5 / 8 / 12 |
| Wood per tree (Trees) | 1–5 | 5 / 10 / 15 / 20 / 25 | 8 / 13 / 21 / 32 / 48 |
| Carrots per plant (Carrots) | 1–5 | 1 / 2 / 3 / 4 / 5 | 2 / 3 / 5 / 8 / 12 |
| Pumpkin factor, × k³ (Pumpkins) | 1–5 | 1 / 2 / 3 / 4 / 5 | 1 / 2 / 3 / 5 / 8 |
| Cactus factor, × n or n² (Cactus) | 1–3 | 1 / 2 / 3 | 1 / 2 / 4 |
| Maze Gold per farm tile (Mazes) | 1–3 | 1 / 2 / 3 | 2 / 3 / 5 |
| Rice per plant (Rice) | 1–2 | 3 / 5 | 4 / 7 |
| Power per sunflower | – | ⌊√flowers⌋ | 2 × ⌊√flowers⌋ |
| Power bonus (most petals, ≥ 10 flowers) | – | ×8 | ×6 |

### Market, growth helpers, contracts

| Knob | Old | New |
|---|---|---|
| Fertilizer, each | 1 Pumpkin | 3 Pumpkin |
| Water, each | 1 Carrot | 2 Carrot |
| Rice sold for | 2 Gold | 1 Gold |
| Fertilizer dose | 2 s of growth | 3 s of growth |
| Water barrel, 1 Water per | 10 s ÷ level | 8 s ÷ level |
| Pumpkins that spoil | 20 % | 15 % |
| Contract reward multiplier | ×1.5 | ×2 |
| Rice worth in a contract | 1 Gold (1.5 paid) | 0.75 Gold (1.5 paid) |

- **Not changed:** Bone = segments² × level, dinosaur step, apples, weather, water decay and 0.25 per
  pour, the rice water thresholds and 20 s, contract amounts, tiers and budgets, other contract item values.
- The Guide and the Workshop read these tables. Rivals' shopping lists follow the new seeds (carrot hay 150 → 180,
  wood 150 → 100; 2 carrots per pumpkin).

### Does it hold together?

Headless playthrough of every level on one scripted strategy (Guide examples for carrots, pumpkins,
cactus, mazes and dinosaur; cumulative farm seconds, old → new):

| Bought | Seed 1 | Seed 2 |
|---|---|---|
| Pumpkins 1 | 530 → 581 | 530 → 581 |
| Mazes 1 | 1,181 → 1,589 | 1,187 → 1,595 |
| Dinosaurs 1 | 1,360 → 1,894 | 1,362 → 1,901 |
| Dinosaurs 2 | 3,918 → 3,715 | 3,529 → 3,784 |
| Megafarm | 6,143 → 5,710 | 5,788 → 5,297 |
| Last step of the script (Pumpkins 5) | 7,119 → 6,164 | 6,814 → 5,750 |

- The middle game is slower. The two Bone prices cost the most time, before and after:
  Dinosaurs 2 and Megafarm take 1,500 s or more each (new numbers: every other step is 174 s at most).
- Rice was run separately: the Guide's example works. A stocked store earned 26,664 Gold in 600 s at
  level 1 on 8×8 (old numbers 76,590), limited by its 20,000 carrots. That is still far above a 12×12 treasure (288–720).

## 4. "ส่งคะแนน Dino"

- **Where:** Online window, leaderboard section, below the table, only on the Dino tab. Beside it: the
  current file's name, or the reason it is off.
- **What:** sends `{ category: "dino", code }` with the current program, however often, whatever the local
  records. The label is "Running…" meanwhile. `lastSent` is updated, so a later local record of the
  same program is not sent twice.
- **Off:** in the demo, offline, without an identity ("Join above to submit"), with an identity the server does not
  know, and while any request of the window runs. The first reason that applies is shown.
- **Shows:** `✓ <file>: N Bone on the benchmark farm (T ticks · O ops).` with the **server's** numbers,
  plus first score / new best (it was X) / your earlier X still counts. Errors (422, 429 …) are red in
  the same place; offline blanks the window as before. The board reloads.
- Scores now wait up to 30 s (was 10 s), because the replay runs before the answer.
- The earlier run left a browser script and a log for the demo case (off, no page errors). This run
  relied on the unit tests and did not click through it again.

## Caveats

1. **The path can still be read out through the numbers.** A 201 answers the exact ops, and a program
   decides how many it uses. It can solve the maze honestly, then make *k* free `get_time()` calls where *k*
   spells part of the path. Tested on three seeds (engine replay, no server): 12–14 submissions gave the
   whole path, well under 60 writes a minute, and a hard-coded run then took 13,000 ticks against 23,919
   for the honest solver (11,800 / 25,117 and 11,000 / 26,729 for the others). It cannot
   beat the shortest path, so 1-tick scores are gone, but "must actually solve mazes" is not fully met. **Not fixed**:
   it is a design choice, not a failing test. Options: a fresh secret maze per submission, scores shown
   only after the week, or one counted submission per player and week.
2. **Luck of the week:** one all-time board ranks different mazes against each other.
3. **Legacy entries** may include parking scores. They are unranked but still shown.
4. **The arena is not comparable across the retune** (see Hashes). Closed challenges and ELO are unchanged.
5. **Existing saves** keep items and levels and simply meet the new prices.
6. **Deploy:** the server on port 4188 was started at 05:16, before these commits, and was not restarted. It
   serves the new `dist/` (the build above refreshed it) but refuses maze records from the new client (it
   wants a seed) until it is restarted.
7. **Not verified:** real GPU, phone width, Thai glyphs (no Thai font here), a live week change.
8. **Flakes:** none in this run (one full run per suite, box load about 7). The playthrough test is seeded.
9. The rules, plants and upgrade order are still those RESULT17 listed as recognisable. This batch
   moved the numbers only, as ordered.
10. Throwaway scripts are in `/tmp/b21f`, not in the repo. The briefs stay untracked as before.
