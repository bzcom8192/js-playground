# RESULT 15: JS Farmer v4, Phase 2 (server-side verification, anti-cheat level 2)

Branch: `farmer-game`. Implementation commit: **`d39c5cf`** (on top of `a1146ea`, the RESULT14 commit). This file was committed separately right after it, so it can quote that hash. Everything in BRIEF15-V4-VERIFY.md is implemented. Not pushed.

```bash
npm run test:farmer    # 257 tests (251 before + 6 new in src/farmer/verify.test.mjs), all pass
npm run test:server    # 26 tests (17 before + 9 new in server/server.test.mjs), all pass, ~11 s
npm test               # both of the above
npm run lint           # 0 problems
npm run build          # ✓ built
```

The server suite was run 4 times in a row with no flakes. **No new dependency.** The server still uses only Node built-ins (`node:worker_threads` and `node:module` are new).

## What was built

### 1. Headless verification runner
**`src/farmer/verify.js`** (new, pure engine code, no DOM and no Node APIs). It only wires the existing `runtime.js`, `world.js`, `arena.js` and `maze.js` together on a virtual clock; no game rule is re-implemented.

- **Arena:** `verifyArena({ code, goal, seed })` is `runSolo` on the fixed phase-3 arena world. It returns `{ reached, ticks, ops }`, the same function the client runs.
  - A test checks that it equals the client's `runSolo` exactly.
  - In the browser check, the server's replay of the rival's program gave the same 103,800 ticks the client had shown.
- **Maze:** `verifyMaze({ code, level, seed, size, sx, sy })` → `{ solved, ticks, ops, mode }`.
  - **The replay world** is a fixed *verification farm* of the record's size:
    - every unlock at its top level, except Mazes = the record's level and Expand = the size;
    - every tile a grown Bush;
    - 1,000,000 of every item (Power 0);
    - no weather;
    - the drone on the recorded start tile.
  - **The maze itself** is the v3 seeded maze. The record's seed is queued as the next maze seed (`state.pendingSeed`, the Records window's replay mechanism), so it is generated from (seed, size, start tile) by the normal `spawnMaze` → `generateSeededMaze`.
  - **"spawn" mode (tried first):** the program runs from the top, as it did on the player's farm. The first maze it spawns uses the queued seed. If that maze is spawned on the recorded start tile, it *is* the recorded maze, and the runtime times it exactly as on the page: counters at the treasure harvest minus counters at the spawn. Tests and the browser run confirm this reproduces local records **exactly** (e.g. 10,017 ticks / 266 ops locally and on the server).
  - **"prespawned" mode (fallback):** used only if spawn mode never produced the recorded maze, for example when a program's setup depends on the player's own farm. The maze is generated before Run and timed from the run start, through a new runtime option `timeExistingMaze`.
  - **solved** = the recorded maze's treasure was harvested.
- **Determinism:** the world rng and the program's `Math.random` are seeded from the job's seed, as in the arena.

### Worker sandbox and limits
**`server/verifier.js`** and **`server/verifyWorker.js`** (new). Every verification runs in **its own `worker_thread`**:

| limit | value |
|---|---|
| wall-clock timeout | **10 s** (`VERIFY_TIMEOUT_MS`, env `VERIFY_TIMEOUT_MS`). Past it the worker is `terminate()`d, which works mid-busy-loop, mid-regex and in `Atomics.wait`, and the job is rejected. |
| arena tick cap | 200,000 virtual ticks (the existing `TICK_CAP`), op budget 2,000,000 |
| maze tick cap | 5,000,000 run ticks (25,000 plain actions, setup included) and 5,000,000 virtual ms; op budget 2,000,000 (the arena's `OP_BUDGET`) |
| memory | `resourceLimits`: 256 MB old generation, 32 MB young, 4 MB stack. A memory bomb kills only the worker and comes back as "ran out of memory". |
| concurrency | 2 replays at once (env `VERIFY_WORKERS`), 16 queued. Beyond that the API answers **429** "verifier busy" with `Retry-After: 5`. |

Inside the worker, after the engine is loaded and before any submitted code runs:
- **Module loading is closed.** A `module.registerHooks` resolve hook rejects every specifier, so `import("node:fs")` fails, also from `Function("…")` code.
- **Node globals are deleted.** `process` goes, and with it `getBuiltinModule`, `binding` and `env`. So do `fetch`, `WebSocket`, `EventSource`, `BroadcastChannel`, `Atomics`, `SharedArrayBuffer` and `WebAssembly`. `console` becomes a no-op.
- **The intrinsics the engine uses are frozen** (Object, Array, Function, Math, JSON, Promise, Map/Set, the Error types, the iterator and generator prototypes, the typed arrays…), and their global names are read-only. So a program can't monkey-patch the code that measures it.
  - Ordinary assignments such as `err.name = …` or `obj.toString = …` keep working. This is the SES-style "override mistake" taming.
- **Un-awaited promise rejections are swallowed**, as on the page, which only logs them.
- **The worker's stdout/stderr are discarded**, and its environment is empty.
- **Results are re-checked.** The API process shape-checks every result coming back from the worker (integers, booleans), never runs submitted code itself, and turns every worker failure (timeout, crash, out of memory, malformed result) into a clean 422.
- Tested: `import()`, `Function`-import, `process.exit`, `Math.max =` / `Object.prototype` tampering, a ReDoS loop (timeout) and a memory bomb (crash) are all rejected. The API kept answering `/api/health` while a worker was stuck.

Measured cost per replay: arena about 0.1–0.6 s including about 50 ms of worker start-up. A maze replay takes a few ms of engine time plus start-up. A program that never solves its maze uses both modes up to the caps, about 2 s.

### 2. Arena challenges are verified
- **`POST /api/challenges`:** the server replays the author's code on the seed first.
  - The stored `authorTicks` / `authorOps` are the **server-measured** values.
  - A replay that doesn't reach the goal → **422** `challenge rejected: … did not reach the goal (…)`.
  - The response adds `verified: true`, `claimed` (the client's numbers, if sent) and `corrected`.
- **`POST /api/challenges/:id/results`:** the server replays the challenger's code the same way, and ELO is computed only from the measured values.
  - A replay that misses the goal is still a valid answer: DNF (200,001 ticks), a loss, as in phase 1.
  - An *unverifiable* run (timeout or crash) is a 422 and the challenge stays open.
  - The response adds `verified`, plus `you.reached`, `you.error` and `you.claimed`.
- **Choice on the old fields: accepted for compatibility, ignored.** `authorTicks` / `authorOps` / `ticks` / `ops` may still be sent (the client still sends them), but they are not validated, stored or used. They are only echoed back as `claimed`, next to the server's numbers.
- **UI:** each open challenge shows "✓ verified". Creating a challenge reports the server's numbers, and says so if they differ from the local run. The answer card says "✓ verified — both runs were replayed and measured by the server".

### 3. Maze leaderboard is verified
- **Client:** the runtime's `onRecord` maze event now carries `code`, the program exactly as it ran (helper files included). `scoreForRecord` sends `{ category, level, ticks, ops, seed, size, sx, sy, code }`; the local records already stored the seed, size and start.
  - A record with no code, or code over 100,000 characters, is not sent.
  - `submitRecord` now returns the server's answer (`stored`) and flags a 422 as `rejected`.
  - The game log says "✓ verified by the server" (with the server's numbers if they were corrected), or warns "The online leaderboard did not accept this record: …".
- **Server:** maze scores now *require* seed, size (a farm size), sx/sy (on the farm) and code. A code-less maze submission is a 400: unverified maze scores are no longer accepted.
  - The server replays before inserting. It stores `verified=1`, the replay's ticks/ops, and also size / sx / sy / code.
  - A replay that doesn't solve the maze → **422** `maze score rejected: …` (wrong maze, failed, ended, tick cap).
  - The response has `claimed`, `corrected` and `replay` ("spawn" / "prespawned"). The code is not echoed back.
- **Leaderboard:** every entry has `verified` (plus size / sx / sy). The maze board ranks **verified rows only**. The Online window shows ✓ on verified rows. Dino rows show a small grey "ยังไม่ยืนยัน", with a footnote explaining why.
- **Dino stays level 1:** the dinosaur's walk uses the world rng, which is not seeded per harvest, so a harvest cannot be replayed. Dino is not seeded in this phase, as briefed.

### 4. Small fixes
- **Rate limit per token.** Every POST with a *valid* bearer token counts against that player's bucket, keyed by the token's SHA-256. Register, missing tokens and unknown tokens count against the client IP. Players behind the bore tunnel no longer share one 60/min bucket. Tested: two tokens from one IP each get their own 3/min bucket, while register is still per IP.
- **Rice contract value.** `CONTRACT_ITEMS.Rice.value` changed from 0.375 to **1**, so a rice contract pays 1 × 1.5 = **1.5 Gold per Rice** (it was about 0.56). Its tier (2.5) and deadline budget are unchanged, and no other item changed. Side effects:
  - Per unit, Rice now pays more than a Cactus contract (0.75 Gold). Cactus is harder to farm in bulk, but rice also needs water management. The tier order (pool and sort) is unaffected.
  - Selling still pays 2 Gold per Rice, so a rice contract is now a modest bonus rather than a loss. Its 1.5 is a *bonus* paid on delivery: the delivered Rice is consumed, so delivering instead of selling still forgoes the 2 Gold.
  - The arena has no Rice, so arena play is unchanged.

## API changes (vs RESULT14)
| endpoint | change |
|---|---|
| `POST /api/scores` (maze) | needs `seed`, `size`, `sx`, `sy`, `code`. Replayed. 201 → the stored score with the **server's** `ticks`/`ops` + `verified: true`, `claimed`, `corrected`, `replay`. 422 if the replay doesn't solve the recorded maze or can't run. |
| `POST /api/scores` (dino) | unchanged rules. The response adds `verified: false`. |
| `POST /api/challenges` | `{ goal, seed, code }`. The claims are optional and ignored. Replayed; 422 if the goal is not reached. The response adds `verified`, `claimed`, `corrected`. |
| `POST /api/challenges/:id/results` | `{ code }`. The claims are optional and ignored. Replayed; ELO from the measured values. The response adds `verified`, `you.reached`, `you.error`, `you.claimed`. |
| `GET /api/leaderboard` | entries add `verified`, `size`, `sx`, `sy`. The maze board lists verified rows only. |
| `GET /api/challenges`, `GET /api/challenges/:id` | add `verified` (on `result` too) |
| errors | **422** for an unverifiable or rejected run. **429** + `Retry-After: 5` when the verifier queue is full; it is not a 503, because the client treats 502–504 as "server offline". **503** only while shutting down. |

**Storage:**
- New columns:
  - `scores`: `verified`, `size`, `sx`, `sy`, `code`;
  - `challenges` and `challenge_results`: `verified`.
- A phase-1 DB file is upgraded in place on start (`ALTER TABLE … ADD COLUMN` when a column is missing), and a test covers this.
- Old rows keep `verified = 0`: they are hidden from the maze board and shown without ✓ in the challenge list.

**Server options:** `startServer({ …, verify: { timeoutMs, maxConcurrent, maxQueue }, verifier })`. New env vars `VERIFY_TIMEOUT_MS` and `VERIFY_WORKERS`. `RATE_LIMIT` is now per player token (per IP without one).

## Tests
- **New farmer tests (`verify.test.mjs`, 6):**
  - Maze replays reproduce local records exactly: the DFS solver on 6×6 and 10×10, the "Maze Runner" example on 8×8, levels 1–3. They are deterministic.
  - Claimed numbers are never inputs.
  - A solve-only program is verified in prespawned mode, on exactly the claimed layout.
  - Walkers, crashing programs and quitters are not verified.
  - A random-walk solver replays deterministically.
  - The arena replay equals `runSolo`; DNF; bad jobs are rejected.
- **New server tests (9), against the real worker verifier:**
  - A doctored too-fast challenge claim (1 tick) is corrected to the replay's numbers, in the DB and the list. A challenger's fake 1-tick "win" with a slower program becomes a measured loss, −16 ELO.
  - Programs that don't reach the goal are rejected (422), as is hostile code (`import()`, `Function`-import, `process.exit`), with nothing stored and the API still healthy. A DNF challenger still answers and loses.
  - An infinite loop (catastrophic regex inside a callback, which no loop guard can stop) is rejected by the **1 s test timeout in about 1 s**. `/api/health` answers *while* the worker spins, and the verifier works again afterwards. The same applies to a maze score.
  - A maze score with fake ticks/ops (1/1) is stored with the server-measured values (and `verified=1`, code, layout), and the leaderboard shows them with `verified: true`.
  - Maze code that doesn't solve the maze → 422; a code-less maze score → 400; nothing stored.
  - Per-token rate limit: two tokens from one IP, each with its own bucket.
  - Verifier unit: queue full → busy, a memory bomb → clean crash, a malformed job → clean crash, then still working.
  - A full verifier queue answers 429 + `Retry-After` over HTTP.
  - A phase-1 DB file is upgraded in place.
- **Client tests (updated in `online.test.mjs`):**
  - The maze submission body now includes code + seed + size + start, and code-less or over-long records are not sent.
  - A 422 is reported as `rejected`.
  - The runtime's record event carries the program.
  - The new rules: replay inputs are required, and claims are ignored for challenges and results.
  - Arena request shapes are unchanged.
- **Existing tests changed, as the new behaviour requires:**
  - `online.test.mjs`: three tests, for the payload shape and rules.
  - `rice.test.mjs`: one assertion. The rice value was asserted to lie between Pumpkin and Cactus; it now asserts 1.5 Gold per Rice.
  - `server.test.mjs`:
    - The phase-1 plumbing tests (leaderboard order, top-50 cap, ELO math, lifecycle) need exact tick counts. They now run against a second server whose **stand-in verifier** reads the "measured" numbers from a comment in the submitted code, through the same routes and storage.
    - The challenge/result validation test now expects claims to be ignored (201) instead of a 400.
    - Maze score bodies gained the replay fields.

## Checked in headless Chromium (not part of the suite)
Against the fresh production build served by the new server on port 4211, with a throwaway DB.
- **Maze auto-submit:** a maze-ready save with a DFS solver file was run with ▶. The page's local best (seed 4215414706, 8×8, start (3, 1): 10,017 ticks / 266 ops) was auto-submitted *with its code*. The server's replay produced exactly 10,017 / 266, and it shows on Maze L1 with ✓.
- **Dino tab:** the rival's 18 Bone row shows ยังไม่ยืนยัน.
- **Challenges:** the rival's challenge was posted with a fake claim of 5 ticks, and the server stored its replay, 103,800 ticks. It is listed with "✓ verified".
- **Accepting with the maze solver** (which never gathers Hay): "You lose −16 → 984", "did not finish", "✓ verified — both runs were replayed…".
- No console errors. Thai text appears as boxes only because this headless Chromium has no Thai font.

## Decisions and caveats
- **Still trust-based:**
  - **Dino scores.** They are level 1 (sanity caps only), because the dinosaur's walk is not seeded and a harvest can't be replayed. They are marked unverified in the UI and API.
  - **Who wrote the code.** A player can submit someone else's program; it is verified as a real run, not as authorship.
- **The maze replay environment is fixed, not the player's farm.** The verified numbers are "this program, in the verification farm, on maze (seed, size, start)".
  - For the usual program, which spawns its maze from a grown Bush and solves it, they equal the local record exactly.
  - They can differ (and the server's numbers count) when:
    - the solve depends on things the server doesn't have: the player's inventory, other unlock levels, program state carried over from earlier mazes in the same run, or unseeded `Math.random` on the page;
    - the program only *works* in the prespawned fallback. That mode counts from the run start, so any setup code before the solve is included.
  - A program that, given the verification farm, spawns its first maze somewhere else is rejected only if the prespawned fallback can't solve the recorded maze either.
- **Cheating by unlocks is not possible, but unlocks the player lacks are present.** For example, a program that spawns Megafarm drones only if `num_unlocked(Unlocks.Megafarm)` will use them on the server even if the player hasn't bought Megafarm. The result is still a genuine run of the submitted code.
- **The sandbox is a hardened worker, not an OS boundary.** Submitted code runs in a V8 isolate in the server's process, with module loading, Node globals and intrinsics locked down, plus a timeout and heap limits. That closes the plain-JS routes found and tested here, but a V8 or Node escape bug would reach the server process. For a public deployment, also run the server as an unprivileged user or in a container. The Node permission model (`--permission`) was not used: it is process-wide, and Node 24's version cannot restrict the network anyway.
- **CPU cost is the new DoS surface.** Each write with code can cost up to 10 s of one core. It is bounded by:
  - 2 concurrent workers and a 16-deep queue (then 429);
  - the per-player rate limit;
  - per-IP registration.

  Tokens are free to create (60 registrations per minute per IP), so a determined client can keep the queue full. If that matters, add a separate, lower per-player limit on replays, or require some ELO or history for challenges.
- **Rate limit:** the buckets are in memory and reset on restart. A valid token costs one extra indexed DB lookup per POST.
- **The maze board hides phase-1 rows** (`verified=0`), as the brief allowed, without migrating them. Old challenges stay listed, without ✓.
- **Results of an unverifiable answer** (timeout or crash) are rejected and the challenge stays open. A program that simply misses the goal is still a DNF loss, as before.
- **Running processes left untouched:**
  - A phase-1 `node server/index.js` (pid 1260378, the phase-1 check server, still running the **old code**) is on port 4199.
  - `python3 -m http.server` is still on 4188, as noted in RESULT14.
  - Restart whichever server is meant to be live so it picks up this commit.
