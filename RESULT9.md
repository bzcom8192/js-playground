# RESULT 9: JS Farmer v3, Phase 1 (Scores, Records & Seeded Mazes)

Branch: `farmer-game` (on top of `64c03da`, Megafarm). Everything in BRIEF9-V3-LEADERBOARD.md is implemented. Not pushed.

```bash
npm run test:farmer    # 171 tests (153 old + 18 new in src/farmer/records.test.mjs), all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No existing test was changed. No new dependency.

## Files
- **`records.js`** (new, pure):
  - Record shapes, `addMazeAttempt` (best per level + capped history), `addDinoHarvest`.
  - `sanitizeRecords` for loading saves and imports.
  - `histogram` and `programSize`.
  - `canRecord`: a demo farm never records.
- **`maze.js`**: `mulberry32`, `randomSeed`, `parseSeed` and `generateSeededMaze`. `generateMaze(…, rng)` is unchanged.
- **`world.js`**:
  - `spawnMaze` now builds the maze from a seed.
  - `state.maze` gains `seed` and `start`.
  - New `state.records` and `state.pendingSeed`, both saved and loaded.
  - A small event channel, `withEvents` / `emit`, reports maze spawned, maze solved and dinosaur harvested.
- **`runtime.js`**:
  - The ops counter and the run clock (`runTicks`).
  - Program size per run.
  - Handling of world events: it writes records and adds the log lines.
  - `stats()` gains `runTicks`, `ops`, `lines`, `chars`.
  - `run(code, { program })`.
- **`demo.js`**: the demo game is flagged `demo: true`.
- **`useFarmEngine.js`**: passes `program` through to the runtime. New `setPendingSeed(seed | null)`, which leaves demo mode and saves at once.
- **`useFarmerFiles.js`**: the `records` window key, with a default position.
- **`RecordsPanel.jsx`** (new) and **`FarmerPage.jsx`**: the Records window, plus a 🏆 button in the top-right row.
- **`DocsPanel.jsx`**: one "Seed & records 🏆" row in the Mazes section.
- **`saveData.js`**: a header comment only. The export format did not change; records are inside `save`.

## 1. Metrics rule
- **Ops:** each call to a farmer API function counts as 1 op, summed over all drones in the run.
  - The rule as coded: *if the runtime hands the function to the program, it counts.* That covers every action, every sense (including free ones like `num_items`, `get_pos_x`, `get_time`, `get_tick_count`, `num_drones`), and `print` / `quick_print` / `console.*`.
  - Ops are counted when the call starts, whatever it then returns. Locked, failed and "Senses locked" calls count too.
  - Constants (`Entities`, `North`, …) are not calls. The loop guards injected by the transform (`__loopGuard` etc.) are not player calls and don't count.
  - The rule is in code: every function on the API object except `__*` is wrapped with the counter (`runtime.js`, end of `buildApi`, and the header comment).
  - A test calls every function in `FARMER_GLOBALS` once and checks that ops equals the number of calls.
- **Ticks:** the run clock is the longest drone timeline.
  - Each drone's timeline is its own tick count plus the spawner's clock at the moment it was spawned.
  - With one drone this is exactly drone 0's ticks, which `get_tick_count()` and the info strip still show unchanged.
- **Program size:** the main file (the one you pressed ▶ on, original text with types). It records non-empty lines and the character count (`code.length`).
- **A run** goes from Run until Stop, program end or error. A new Run resets the counters, and after the run they stay frozen ("Last run").
- **UI exposure:** the Records window reads `view.stats` through `useSampled(…, STRIP_REFRESH_MS)`, the same 250 ms sampling as the info strip, so it does not re-render on every tick. The info strip itself is unchanged.

## 2. Record shapes
They are stored in `farmer_save_v1` as `records`, next to `pendingSeed`. The save stays `v: 1`.

```js
records = {
  mazes: { "<Mazes level>": { best: MazeAttempt, attempts: MazeAttempt[] /* last 100 */ } },
  dino: { bone, level, cut, at } | null,
}
MazeAttempt = { level, seed, size, sx, sy, ticks, ops, lines, chars, at }
```

- **Maze ticks / ops:**
  - The run counters are read when the maze spawns (inside the `use_item` call, before its ticks are added, after its op) and again when it is solved (inside the treasure `harvest`, same timing).
  - So a run of `use_item` → … → `harvest` gives `ticks = runTicks − 200` and `ops = total − 1` (tested).
  - Replaying the same seed with the same program gives exactly the same attempt (tested).
- **Best per level:** fewest ticks, with ties going to fewer ops.
  - `best` is stored separately from `attempts`, so a best that is older than the last 100 attempts survives the cap.
  - Loading also re-checks `best` against the stored attempts.
- **Dinosaurs:** every dinosaur harvest is a candidate, including cutting at the head. Only the biggest single Bone haul is kept, with the Dinosaurs level and the number of segments cut.
- **Log lines:**
  - `Maze seed: N`, or `Maze seed: N (replay)` when the seed came from the replay input.
  - `🏁 Maze solved in X ticks · Y ops`, with `— new best for Mazes level L!` added when it is a new best.
  - `🦴 New best dinosaur harvest: B Bone (k cut)`.
- **Persistence and import:**
  - Old saves and old export files have no `records` and load with empty records.
  - Damaged records are cleaned or dropped field by field.
  - Records survive even when the farm part of a save is rejected.
  - Export and import need no format change, because records are part of the save.
- **Demo mode:** the demo farm has `demo: true`, and `records.js` refuses to write to it. The demo is never saved anyway.

## 3. Seed mechanism
- `spawnMaze` takes `state.pendingSeed` if one is set, uses it once and clears it.
- Otherwise it draws a fresh 32-bit seed from the ambient rng, the same `rng` the runtime already passes in.
- The layout (recursive backtracker) and the treasure (the farthest path tile) both come from `mulberry32(seed)`.
- `state.maze.seed` and `start` are saved with an active maze.
- **Replay input:** in the Records window, "Replay seed" plus "Use next" sets the pending seed.
  - The pending seed is saved immediately and shown as "Next maze uses seed N ✕".
  - Clicking any recorded seed (the best seed or a recent attempt) also sets it as pending.
- **Determinism (tested):**
  - The same seed gives an identical layout and treasure for every farm size ≥ 3, both directly and through two separate farms.
  - 20 other seeds all give a different 12×12 layout.
  - A randomly drawn seed reproduces its maze exactly when replayed.
  - The Mazes level does not affect the layout.

## 4. UI placement
- **Button:** a fourth icon button in the top-right row (+ / i / Unlocks / **🏆**), in the same olive square style with a white stroked trophy SVG. It toggles a floating "Records" window.
- **Window:** it has the light stone style of the Unlocks window. Its position and size are saved like the other windows. On mobile it stacks after Unlocks.
- **Window contents, top to bottom:**
  - This run / Last run: ticks, ops, lines, chars.
  - Replay seed.
  - Best maze runs, one card per Mazes level:
    - 🏆 ticks, ops, a clickable seed, and size and start tile.
    - The attempt count.
    - A 10-bucket CSS histogram of attempt ticks, with the bucket holding the best drawn in olive.
    - "▸ Recent attempts", a show-more toggle listing the last 10.
  - Best dinosaur harvest.
  - A one-line footnote.
- **Empty state:** "No records yet — solve a maze!"
- **Language:** the existing UI is English throughout (there is no Thai text in `src/`), so the window is English too.
- **Visual check:** I looked at both the empty and the filled window in headless Chromium against the production build.

## Deviations and uncertainties
- **The seed alone does not decide the maze; the start tile matters too.**
  - The maze is still generated around the drone's tile, and its cell lattice follows the parity of that tile. Changing that would change maze mechanics, which is out of scope.
  - So the true guarantee is: same seed + farm size + **start tile** → identical maze. The Mazes level never matters.
  - To make replays usable, each record stores `size` and the start tile (`sx`, `sy`). The window shows "12×12 from (0, 0)", and the replay hint says so.
  - If you want seed + size alone to decide the maze, the drone would have to be moved to a seed-chosen start tile. That is a mechanics change, so I left it for you to decide.
- **Best is kept per Mazes level only, as the brief says, not per farm size.**
  - Attempts on different farm sizes therefore share a histogram. The size is shown with each record.
  - The farm only grows, so in practice that's one size at a time.
- **A maze spawned in an earlier run, or before a reload, is not timed.** Solving it still pays Gold, and the Log says "not timed". Its counters belong to a different run.
- **The pending seed is consumed by the next maze spawned anywhere**, including one spawned by a helper drone or in a later run. It persists across reloads until it is used.
- **Import replaces records.** Importing an old export (no records) replaces your current records with empty ones, consistent with "Import replaces your farm". Reset Save also clears records.
- **`print` / `console.*` count as ops**, a literal reading of "if it is in the farmer API surface, it counts". This stops players from saving ops by switching `print` to `console.log`.
- **Multi-drone maze ticks** use the run clock (the longest timeline), not the solving drone's own ticks.
- **Future work:** the dinosaur's random walk and apple spawns still use ambient randomness, so dinosaur runs are not replayable yet. They are the natural next things to seed (one seed per hatch).
