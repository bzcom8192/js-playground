# RESULT 14: JS Farmer v4, Phase 1 (Online: Node backend, ranking + friend arena)

Branch: `farmer-game`. Implementation commit: **`21c2226`** (on top of `0d9361f`, the RESULT13 commit). This file was committed separately right after it, so it can quote that hash. Everything in BRIEF14-V4-ONLINE.md is implemented. Not pushed.

```bash
npm run test:farmer    # 251 tests (237 old + 14 new in src/farmer/online.test.mjs), all pass
npm run test:server    # 17 tests (server/server.test.mjs), all pass, ~2.5 s
npm test               # both of the above
npm run lint           # 0 problems
npm run build          # ✓ built
```

No existing test was changed. **No new dependency**: the server uses only Node built-ins (`node:http`, `node:sqlite`, `node:crypto`).

## How to run the server
```bash
npm run build          # the server serves dist/
npm run server         # = node server/index.js → http://localhost:4188
```
- **Port:** 4188 by default; set `PORT` to change it. **Port 4188 is busy right now:** `python3 -m http.server 4188 --directory dist` (pid 1084354) is serving the old static build behind the bore tunnel. I left it running. Stop it, then start `npm run server` so the tunnel reaches the API.
- **Storage:** `server/data/farmer-online.db` (created on first start, gitignored).
- **Other env:**
  - `HOST` (default `0.0.0.0`), `FARMER_DB` (DB path), `FARMER_DIST` (static dir).
  - `RATE_LIMIT` (write requests per minute per IP, default 60).
  - `TRUST_PROXY=1` rate-limits by `X-Forwarded-For` (see Caveats).
- **Development:** `npm run dev` plus `npm run server`. Vite now proxies `/api` to `localhost:4188`, so the dev page also gets the same-origin API.
- **Runtime:** Node 24.22 here. `node:sqlite` loads without a flag and printed no warning. If a runtime has no `node:sqlite`, `db.js` falls back to `better-sqlite3`, which you would then have to `npm i`.

## Files
- **`server/index.js`**: the entry point. `startServer({ port, host, dbPath, distDir, rateLimit, trustProxy })` is also what the tests use.
- **`server/app.js`**: routing, auth, JSON body parsing (256 KB limit, `application/json` only), the rate limiter, and static files with SPA fallback.
  - Static files are protected against path traversal.
  - Hashed `assets/` files are cached immutable; everything else is `no-cache`.
  - A missing `.js`/`.png` returns a real 404. Paths without an extension get `index.html`.
- **`server/db.js`**: the schema, prepared statements, and the transaction that closes a challenge.
- **`server/server.test.mjs`**: the server tests. Each run uses its own temp directory and DB, on an ephemeral port.
- **`src/farmer/onlineRules.js`** (new, pure): the rules that the **server and the client both import**:
  - name rules and score / challenge / result validation, with their caps;
  - race ordering and zero-sum ELO.
  - It derives limits from the game's own constants (Mazes max level, largest farm, Dinosaurs max level, arena tick cap).
- **`src/farmer/onlineApi.js`** (new): the client.
  - It handles offline cases and identity storage.
  - `scoreForRecord` / `submitRecord` do the fire-and-forget auto-submit; `submitRecord` never rejects.
- **`src/farmer/OnlinePanel.jsx`** (new): the 🌐 Online window.
- **`arena.js`**: new `runSolo()` and `DNF_TICKS`. Match results now also carry `sides.*.ops`.
- **`arenaWorker.js` / `arenaClient.js`**: a `solo` mode and `playSolo()`. The solo run uses the same Worker as the bot arena, with a main-thread fallback.
- **`runtime.js`**: a new `onRecord` option, called only when a maze solve or dinosaur harvest sets a new **local best**. Exceptions thrown by the listener are swallowed.
- **`useFarmEngine.js`**:
  - It wires `onRecord` to `submitRecord` (skipped on the demo farm).
  - After a successful send it logs "🌐 Sent your new best … to the online leaderboard" and bumps `onlineSeq`, so an open Online window refreshes.
- **`FarmerPage.jsx` / `useFarmerFiles.js`**:
  - a seventh top-right button 🌐 and the `online` window (position saved like the others);
  - below 400 px width the top buttons shrink slightly (40 px, 6 px gap), so seven of them fit on a 360 px phone.
- **Config:**
  - `package.json`: new scripts `server`, `test:server` and `test`.
  - `eslint.config.js`: Node globals for `server/**`.
  - `.gitignore`: `server/data/`.
  - `vite.config.js`: the dev proxy.

## Endpoints
All under `/api/`. Every error is JSON `{ error }`. Statuses:

| status | when |
|---|---|
| 400 | validation failed or bad JSON |
| 401 | missing or unknown token |
| 403 | answering your own challenge |
| 404 | unknown endpoint or challenge |
| 405 | wrong method |
| 409 | name taken, or the challenge is already answered |
| 413 | body too large |
| 415 | not JSON |
| 429 | rate limited (with `Retry-After`) |
| 500 | anything else (logged on the server) |

| method | path | auth | notes |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| POST | `/api/auth/register` | – | `{ name }` → 201 `{ playerId, name, elo, token }`. The name is trimmed with inner whitespace collapsed, 1–24 chars, no control characters, and unique ignoring case (SQLite `NOCASE`). The token is 32 random bytes in hex and is shown once; only its SHA-256 is stored. |
| GET | `/api/players/me` | ✔ | `{ playerId, name, elo, createdAt }` |
| GET | `/api/leaderboard?category=maze&level=1` | – | Best entry per player (SQL `ROW_NUMBER()`), top 50, as `{ category, level, entries: [{ rank, playerId, name, ticks, ops, value, seed, createdAt }] }`. **Maze:** levels 1–3, fewest ticks, then fewest ops. **Dino:** no level (sending one is a 400), highest value. Ties share a rank (1, 1, 3). |
| POST | `/api/scores` | ✔ | `{ category, level?, ticks, ops, value?, seed? }` → 201. One row per submission. |
| POST | `/api/challenges` | ✔ | `{ goal, seed, code, authorTicks, authorOps }` → 201. `goal` is one of hay500 / wood800 / pumpkin300. |
| GET | `/api/challenges` | – | `{ challenges: [...] }`: open challenges only, newest first, max 50, without `code`. Fields: `id`, `authorId`, `authorName`, `authorElo`, `goal`, `seed`, `authorTicks`, `authorOps`, `createdAt`. |
| GET | `/api/challenges/:id` | – | The full challenge, with `code`, `status` and `result` (null until answered). |
| POST | `/api/challenges/:id/results` | ✔ | `{ ticks, ops, code }` → 201 `{ challengeId, result: "win"\|"loss"\|"draw" (yours), you: { ticks, ops, elo, delta }, author: { name, ticks, ops, elo, delta, … } }` |

**Tables.** The four tables are as in the brief. A few things are added:
- indexes on the tables;
- `UNIQUE` on `challenge_results.challenge_id`;
- two extra columns on `challenge_results`: `outcome` and `elo_delta` (challenger's view), so a closed challenge can show its result.
- Timestamps are epoch ms.
- The DB uses WAL with `synchronous = NORMAL`. With the default fsync on every commit, each write took about 100 ms on this disk.

**Answering a challenge** runs as one SQLite transaction (`BEGIN IMMEDIATE`):
1. re-check that the challenge is open;
2. insert the result;
3. set the challenge to closed;
4. update both players' ELO.

**The ELO rule:**
- Fewer ticks wins; equal ticks → fewer ops wins; both equal → draw.
- K = 32 with the standard expected score.
- The challenger's change is rounded to a whole point, and the author gets exactly the negative, so the change is zero-sum and the ratings stay integers.
- Tested from 1000 vs 1000: win +16/−16, draw ±0; and a 1000 player drawing a 1016 author gets +1/−1.

**Rate limit:** every POST counts, 60 per minute per IP, a fixed window kept in memory. Reads are not limited.

## Client
- **Identity:** stored in `localStorage["farmer_online_v1"] = { v: 1, playerId, name, token }`.
  - It is **not** in Save Data / Import Data, which still export only `farmer_save_v1` + `farmer_files_v1`; a test checks this.
  - **Reset Save does not clear it either.** It is a credential that cannot be recovered, so losing it would lose the account.
  - The window has a "Forget identity" link (with a confirmation) instead.
  - If the server no longer knows the token (for example the DB was reset), the window says so and offers Forget.
- **Online window**, from top to bottom:
  - **Identity:** a name field + **เข้าร่วม**, or the name + ELO.
  - **Leaderboard:** tabs Maze L1 / L2 / L3 / Dino; columns rank, name, ticks / ops (or Bone); your row is highlighted lime with "(you)".
  - **Friend Arena:** a goal select + **สร้างคำท้า**, then the open challenges (author, author ELO, goal, author ticks), each with **ท้าแข่ง**. On your own challenges the button reads "yours" and is disabled.
- **The program used** is the active file with its helper files (as ▶ and the bot arena run it). The window names it.
- **Creating a challenge:**
  1. `runSolo` runs the program on a fresh `randomSeed()` for the chosen goal (Worker, progress bar).
  2. If it reached the goal, the client posts code + ticks + ops.
  3. If it did not, it shows why and posts nothing.
- **Accepting a challenge:**
  1. `GET /:id`: is it still open? This also fetches the author's code.
  2. `runSolo` runs your program on the challenge seed.
  3. The client posts the result.
  4. A card shows win / lose / draw, both sides' ticks · ops, your ELO change → new ELO, the author's change, and the author's code (collapsible).
  5. One log line is written.
- **Auto-submit:** when a run sets a new **local** best maze (levels 1–3) or dino record and an identity exists, it posts once, fire-and-forget, failures silent.
- **Offline-first:**
  - Each of these counts as offline, and the window then shows only "🌐 เซิร์ฟเวอร์ไม่ตอบสนอง" with ↻ Retry:
    - a network error;
    - a timeout (10 s);
    - a reply that isn't the API's JSON (the static python server's 404 page, a tunnel 502, a Vite page without the proxy).
  - The rest of the game does no network I/O except the auto-submit, which never throws and never blocks the run.
- **Demo mode:** the window is visible and the leaderboard and challenges can be browsed. A banner explains the limits. Joining, creating and accepting are disabled. The demo never records, so it never auto-submits (and `useFarmEngine` checks the demo flag as well).

### Why a solo run is enough for a fair race
The phase-3 arena already runs two sides on separate worlds that only share the clock. Growth ticks on a fixed grid, and the sides never interact.
- So "your program vs the author's on seed S" = your solo run on S vs theirs.
- `runSolo` is `runMatch` with an empty opponent program; it returns the tick the goal was reached and the ops used by then.
- A test checks this: pro's solo reach tick and ops equal pro's side of a real match on the same seed exactly, and repeat deterministically.
- A run that errors, ends idle or hits the 200,000-tick cap reports `ticks = DNF_TICKS` (200,001), which always loses.

## Tests added
- **Server (17):**
  - register: token shape, only the hash stored, `/me`;
  - duplicate names (any case); name length and type; auth rejections on every write endpoint;
  - 18 score sanity rejections plus valid maze and dino scores;
  - leaderboard best-per-player order (maze tie → ops; dino ties share a rank), bad queries, the top-50 cap;
  - challenge lifecycle: create → listed without code → full view → answer → closed and gone from the list → a second answer is 409;
  - ELO for win, loss, tie-broken-by-ops, exact draw, DNF and unequal ratings;
  - self-challenge 403 (stays open, ELO untouched); challenge / result validation and 404s; newest-first listing;
  - HTTP errors (404 / 405 / 413 / 415); static files, SPA fallback and traversal;
  - the rate limiter as a unit and as a real 429; the DB persisting across a restart.
- **Client (14, in `src/farmer/online.test.mjs`):**
  - with a mock fetch: the request shapes of all 9 calls (method, URL, Bearer header, JSON body, Content-Type only with a body);
  - server errors keep their message and status;
  - offline handling: network error, HTML page, 502 text, 503, a non-object reply, a timeout, no `fetch` at all;
  - identity save / load / clear, damaged data, and storage that throws; the identity is not in the export;
  - `scoreForRecord` / `submitRecord`: skipped without an identity, in the demo, or for maze level 4; the token is sent; it never rejects, even with a broken api object;
  - the runtime `onRecord` hook: it fires for a new best maze (and that real solve passes the server's sanity rules), not for an equal replay, fires for the best dino haul only, and a throwing listener can't break the run;
  - the shared rules and zero-sum ELO; `runSolo` matches a real match side and is deterministic; DNF cases.

## Checked in headless Chromium
Against the production build served by `node server/index.js` on port 4199 with a throwaway DB. Not part of the suite.
- **Offline:** the page from the existing static server on 4188, which has no `/api`. The Online window showed "เซิร์ฟเวอร์ไม่ตอบสนอง", and the rest of the page (the other buttons, the farm) was unaffected.
- **Join:** registered as a Thai name with เข้าร่วม. `farmer_online_v1` was written and is not inside `farmer_save_v1`.
- **Accept:** accepted a seeded rival challenge (rookie, 103,800 ticks) with ท้าแข่ง while the active file was pro's code. Result: "You win! +16 → 1,016"; rival −16 → 984; the author's code was shown.
- **Create:** สร้างคำท้า posted "Challenge #2: 500 Hay in 50,850 ticks · 933 ops", and it is listed as "yours".
- **Auto-submit:** ran a maze-solver file on a maze-ready save. The new local best (5,125 ticks / 150 ops) arrived on the Maze L1 leaderboard by itself, ranked above the rival, and the player's row was highlighted.
- No console errors.
- Thai text showed as boxes in the screenshots only because this headless Chromium has no Thai font. Normal desktop and mobile browsers have one.

## Decisions, deviations and caveats
- **Anti-cheat is level 1 (trust + sanity) only.**
  - The server believes that a submitted run happened. It rejects only what cannot be true: an unknown category or level, non-positive or non-integer numbers, values over the caps, and a maze with more ops than ticks.
  - Anyone with a token can submit made-up but plausible numbers, or a challenge result they never ran. **Treat the leaderboard as a friendly board, not a verified one.**
- **Where level 2 would hook in:**
  - Every write goes through `validateScore` / `validateChallenge` / `validateResult` in `app.js`, and the spot is marked with a comment in `POST /api/scores`.
  - Challenges and results already store the full `code` and `seed`. The engine stays importable from `src/farmer/`: the server already imports `onlineRules.js`, which pulls in `arena.js` → runtime / world without any DOM.
  - So `POST /challenges` and `/results` could call `runSolo({ code, goal, seed })` on the server, preferably in a `worker_threads` worker with a time limit, and compare ticks / ops. Server-side solo runs take about 0.01–0.3 s.
  - Maze scores would also need the code to be submitted: the attempt's seed, size and start tile are known locally but are not sent today.
- **"ops < ticks" in the brief is inverted for this game's units.** Every action costs 200 ticks and every sense 1 tick, while an op is one API call. So a real run always has ops ≪ ticks, and the literal rule would reject every legitimate score. I implemented the invariant it evidently meant: **reject ops > ticks** for maze scores.
  - A test checks that a real maze solve passes this rule.
  - The rule can only misfire for a program that calls more zero-tick functions (`print`) or `get_forecast` (25 ops for 1 tick) inside one maze than the maze costs in ticks.
- **The caps:**
  - maze: ticks ≤ 100M, ops ≤ 100M;
  - dino: Bone ≤ 62,208 = (12×12 tiles)² × Dinosaurs level 3, the largest single harvest the game allows;
  - challenge: author ticks 1–200,000 (the author must have reached the goal), ops ≤ 10M;
  - result: ticks 1–200,001 (200,001 = did not finish);
  - code ≤ 100,000 characters.
- **Dino scores need no ticks/ops.** A dino record has no run counters, so `ticks` / `ops` are optional for `dino` and stored as NULL. If they are sent, they are validated.
- **The rate limit and the bore tunnel.** bore forwards raw TCP, so behind the tunnel every request arrives from the tunnel client's address. The "per-IP" limit is then effectively one global 60 writes/min. If that becomes a problem, put an HTTP proxy that sets `X-Forwarded-For` in front of the server and set `TRUST_PROXY=1`. The limiter is in memory, so it resets on restart.
- **No authentication beyond the bearer token** (as briefed: no passwords or email). Losing the token (for example by clearing site data) loses the account; there is no recovery flow.
- **Answering by a challenger without the goal:** a DNF result is accepted and simply loses, so an answer always resolves the challenge. Creating a challenge requires reaching the goal.
- **Answering closes a challenge for everyone** (one result per challenge, as briefed). To race a program against several friends, post several challenges.
- **Ticks** in the friend arena are the arena's virtual ms (as in phase 3), not `get_tick_count()`.
- **Not done (out of scope):** server-side replay verification, websockets / realtime, passwords. Also no pagination beyond the top 50 / newest 50, and no server-side request log (only 500s are logged).
