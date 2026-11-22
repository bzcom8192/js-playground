# RESULT20 — v5 phase 3: Daily Maze Race (BRIEF20)

Branch `farmer-game`, on top of `493050e`. Nothing was pushed.

| Commit | What |
|---|---|
| `b184bdd` | Code + tests |
| (this file) | RESULT20 summary |

## Tests

| | Before | After |
|---|---|---|
| Farmer | 285 / 285 | **297 / 297** (+12) |
| Server | 35 / 35 | **43 / 43** (+8) |
| Lint, build | clean | clean |

- **Farmer (`daily.test.mjs`):** Bangkok midnight, course per date, the replay (deterministic, shortest
  path, own-maze programs, no parking on the treasure, every failure reason), error lines, request
  shapes and the section's data through mock fetch.
- **Server:** seed constant within a Bangkok day and different the next, no code → 400, a real program
  scored with the measured numbers, non-finishers → 422, best per player, ties, own rank off the board,
  yesterday's winner, an entry sent just before midnight, DB upgrade and rollback.
- Dates are injected; no test depends on the wall clock. No existing test was changed.
- **Browser check** (headless Chromium, throwaway server and DB): guest, run, submit, rank 13 shown under
  the top 10, practice link, demo, offline. The local run and the server agreed (13,059 ticks · 324 ops),
  the run stored nothing on the server and left items, records, unlocks and the queued seed as they were.
  No page errors. Not looked at: phone width, Thai glyphs (no Thai font here), a page open across midnight.

## Race definition

`dailyRace.js` (rules), `verifyDaily` in `verify.js` (replay).

| | |
|---|---|
| Date | Bangkok calendar date of the server clock (fixed UTC+7; Thailand has no DST) |
| Seed | `dailySeed("YYYY-MM-DD")` of `contracts.js` (FNV-1a, 32 bit) |
| Maze | `generateSeededMaze(8, 0, 0, seed)`, drawn from `mulberry32(seed)`. 2026-11-22: seed 68745399, treasure on (4, 2) |
| Farm | 8×8, `Unlocks.Mazes` = 1; the rest as on the maze verification farm (other unlocks at top level, 1,000,000 of each item, Power 0, no weather) |
| **Start tile** | **(0, 0)**: a new farm's bot stands there and `clear()` returns to it, so it is easy to rehearse |
| Clock | **the maze already stands when the program starts; ticks and ops count from the start of the run** to the treasure harvest |
| Order | fewest ticks, then fewest ops; a full tie shares the rank, earlier entry listed first |
| Limits | as for maze replays: 5,000,000 ticks / virtual ms, 2,000,000 API calls, 10 s, same worker sandbox |

**Why no "grow your own maze" mode:** with it, a program that knows the seed parks a second bot on the
treasure tile first. Measured on today's maze: 390 ticks, against 14,637 for the Field Guide's example.
Programs that begin with `use_item(Items.Fertilizer)` still work; that call just fails.

## Endpoints

- **`GET /api/daily`** → `{ date, seed, size, level, sx, sy, board, me, yesterday }`. `board`: best entry per
  player, at most 50, each `{ rank, playerId, name, ticks, ops, createdAt, verified }`. `me`: the caller's
  own best when a valid token is sent (needed for a rank past 50), else null. `yesterday`:
  `{ date, winner: { playerId, name, ticks, ops } }` or null.
- **`POST /api/scores`, `category: "daily"`**: only `code` counts (400 without). Date, seed and numbers in
  the body are ignored. 201 → the stored entry plus `date`, `best` (is it my best today?) and `rank`.
  422 `daily race rejected: …` if it does not harvest the course's treasure; 422 / 429 on a timeout,
  crash or full queue as before. Nothing is stored on a refusal.
- The date is fixed when the entry **arrives**, so a replay that ends after midnight counts for the old day.
- `GET /api/leaderboard?category=daily` stays a 400.

## Storage

`scores.race_date TEXT`, nullable, added in place (ALTER), plus a partial index on it. Null for other
categories, whose queries are unchanged. A server from before this phase still runs on the upgraded file.

## Client

- New section above the leaderboard (`DailyRace.jsx`, data mapping in `onlineDaily.js`). "วิ่งสนามวันนี้" asks
  the server for today's course and runs the same replay in a Web Worker (30 s limit). "ส่งผล" sends
  **the program of the run on show**, even if the file was edited since.
- Both buttons are off in the demo, like the rest of the window; offline, the window shows its usual notice.
  Without an identity you can run but not submit.
- "ฝึกซ้อม" opens the Almanac and fills the seed box; it does not queue the seed until Maze is pressed.
- The arena's worker code moved to `workerRun.js` so both use it; no behaviour change intended.

## Decisions and caveats

1. **Everybody can read the maze all day**, so a hard-coded path is a legal entry, and the shortest one is a
   floor that several players can tie on. That follows from a fixed daily seed with unlimited tries; on a
   tie the earlier entry wins.
2. **"Yesterday" is strictly the previous Bangkok day.** If nobody raced then, there is no winner line.
3. **Not changed, but found here: the maze leaderboard has the parking trick described above**, since a
   player can queue a known seed. Worth its own fix.
4. Practice on your own farm matches the shape only on 8×8 with the maze grown on (0, 0). Ticks there
   differ (your Speed level, and the clock starts at the spawn).
5. Every accepted entry is stored with its code, as for mazes; nothing prunes old days.
6. **The server running on port 4188 from this checkout was not restarted.** It serves the new `dist/`
   but its API has no `/api/daily` yet, so the section says "This server has no daily race" until it is.
7. The briefs stay untracked as before. Muse was passed per commit; the git config was not changed.
