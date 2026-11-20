# RESULT — JS Farmer + editor/shortcut audit

Branch: `farmer-game` (from `main` @ `430a864`). Everything in BRIEF.md is implemented.
Choices the brief left open, and places where I deviated, are listed under
[Deviations](#deviations-from-the-brief-and-why).

## How to run

```bash
npm install
npm run dev            # http://localhost:5173/        → Playground
                       # http://localhost:5173/#/farmer → JS Farmer
npm run test:farmer    # 55 node tests (transform, world, engine)
npm run build && npm run preview
npm run lint           # 0 problems
```

## What was built

### Routing
- **`src/router.js`** is a tiny hash router: `""`/`#/` is the Playground, `#/farmer` is
  JS Farmer. There is no react-router, so static deploys keep working.
- **`src/Root.jsx`** picks the page. The Farmer page is lazy-loaded (its own 58 kB chunk)
  and the document title follows the route.
- **Navigation:** the Playground header has a **🚜 Farmer** pill, and the Farmer header has a
  **Playground** pill.
- **Storage:** each page keeps its own localStorage keys. The playground still uses
  `playground_code`, `playground_history` and `playground_autorun`, untouched. Farmer uses
  `farmer_code` and `farmer_save_v1`.

### Game files (`src/farmer/`)

| File | Role |
|---|---|
| `constants.js` | `Entities`, `Items`, `Grounds`, `Unlocks`, directions, per-entity rules, and the data-driven **`UNLOCKS`** table |
| `world.js` | Pure world logic (no DOM): create, tick, harvest, plant, till, swap, items, trade, unlocks, pumpkin groups, cactus rule, (de)serialize |
| `transform.js` | Token-aware source rewrite (adds `await`, makes functions `async`, inserts loop guards) |
| `runtime.js` | Compiles to an `AsyncFunction` with the drone API as parameters. Handles timing, stop, power, hints, runaway guard and error lines. Time sources are injectable |
| `useFarmEngine.js` | React glue: ~10 Hz world tick, ~30 fps UI refresh, log batching, autosave every 3 s + on hide/unload |
| `FarmerPage.jsx`, `FarmGrid.jsx`, `UnlocksPanel.jsx`, `DocsPanel.jsx`, `LogPanel.jsx` | UI |
| `farmerLib.js` | JSDoc'd `farmer-api.d.ts` (IntelliSense + hover docs) and ESLint globals |
| `examples.js` | Default starter + 6 examples |
| `*.test.mjs` | Tests |

### UI
The page matches the playground's dark style:
- **Header:** 🚜 JS Farmer, Playground link, speed select (1×/2×/4×/8×), Clear Farm (asks to
  confirm), ⌨ Shortcuts, a **⋯** menu with **Reset Save…** (asks to confirm), and the
  Run/Stop button.
- **Left side:** inventory chips (all 8 items, greyed at 0), the square farm grid, and a
  status line.
  - The grid has North at the top. Soil and grassland have different colours, water shows as
    a blue overlay, plants scale and fade in as they grow, and dead pumpkins look grey and
    wilted.
  - The 🚁 drone slides between tiles (no slide across a wrap) and flips via CSS on
    `do_a_flip()`.
  - The status line shows position, the entity under the drone and its growth %, ground,
    water, elapsed time, ticks, actions/s, the last `measure()` result, and the run state.
- **Right side:** the shared Monaco editor (farmer IntelliSense, lint with the farmer
  globals), with tabs below it:
  - **Log**: auto-scrolls, keeps the last 500 lines, Clear button.
  - **Unlocks**: scrollable cards with level pips, cost chips (red if you can't afford them),
    Unlock/Upgrade buttons, "Requires X" when locked, and greyed "Coming in v2" cards for
    Mazes, Dinosaurs and Megafarm. The tab shows how many unlocks you can afford right now.
  - **Docs**: examples dropdown that flags missing unlocks with 🔒, a compact API reference,
    and the exact farming rules.
- **Layout:** row layout on `md+`, stacked columns on mobile. Long lists scroll inside their
  panel, never the page.

## API as implemented

Actions take 200 ticks (`do_a_flip` takes 600). 1 tick = 1 ms at 1× speed. Duration is divided
by `2^Speed level × UI speed × (Power > 0 ? 2 : 1)`. Every action costs time, **including
failed ones**. Senses cost 1 tick and no wall time.

| Function | Gate | Behavior |
|---|---|---|
| `harvest()` | — | Ripe: adds the yield. Unripe: destroys the plant, except unripe **Grass**, which is left alone and returns false |
| `plant(e)` | Plant + entity unlock | Fails on an occupied tile (Grass gets replaced), on the wrong ground, or if you can't afford the seed. Seed cost is paid automatically |
| `move(dir)` | — | Wraps around the edges |
| `can_move(dir)` | — | Always true |
| `till()` | Carrots | Grassland ⇄ Soil, clears the entity |
| `clear()` | — | All tiles become empty grassland, drone goes to (0,0) |
| `swap(dir)` | Cactus | Swaps the whole entity object (growth/petals/size move with it). **No wrap**: false at the edge |
| `use_item(item, n=1)` | Watering / Fertilizer | Water: +0.25 per item (cap 1). Fertilizer: +2 s of growth per item, needs a growing plant |
| `trade(item, n=1)` | Fertilizer / Watering | Fertilizer = 1 Pumpkin, Water = 1 Carrot |
| `unlock(u)` | — | Same as the Buy button |
| `do_a_flip()` | — | Flip animation, returns true |
| `can_harvest()`, `get_entity_type()`, `get_ground_type()`, `get_pos_x()`, `get_pos_y()`, `measure(dir?)`, `get_water()` | Senses | Before Senses they return `null` and log "🔒 Unlock Senses first" once |
| `get_world_size()`, `num_items()`, `get_cost()`, `num_unlocked()`, `get_time()`, `get_tick_count()` | — | Available from the start |
| `print`, `quick_print`, `console.log/info/warn/error/clear` | — | Write to the Log panel |

**Constants:** `Entities`, `Items`, `Grounds`, `Unlocks` (values are their string names),
plus `North`, `East`, `South`, `West`.

**Locked calls** return `false`/`null` and log `🔒 Unlock X first (fn)` once per run.
Other failure reasons (e.g. "needs Soil — till() first") are also logged once per run.

### Yields and rules
These are also shown in the in-game Docs tab.
- **Grass:** 1 s to grow. Regrows 0.5 s after a grassland tile becomes empty.
  Yields 1 Hay × (Grass level + 1).
- **Bush:** 4 s. Yields 1 Wood × max(1, Trees level).
- **Tree:** 7 s × 2^(adjacent trees, no wrap). Yields 5 Wood × max(1, Trees level).
- **Carrot:** 6 s, Soil, seed 1 Wood + 1 Hay. Yields 1 × Carrots level.
- **Pumpkin:** 3 s, Soil, seed 1 Carrot.
  - 20% chance at maturity to become `Dead_Pumpkin`; harvesting that just clears it.
  - Harvesting a ripe pumpkin clears its whole 4-connected group of ripe pumpkins.
    A solid k×k square yields **k³**; any other shape yields the group size. × Pumpkins level.
- **Sunflower:** 5 s, Soil, seed 1 Carrot, 7–15 petals.
  - Yields Power = ⌊√(sunflowers on the farm)⌋.
  - ×8 if there are ≥10 sunflowers and this one has the maximum petals.
- **Power:** while Power > 0, each action consumes 1 Power and runs 2× faster.
- **Cactus:** 2 s, Soil, seed 1 Pumpkin, size 0–9. Harvesting a **ripe** cactus harvests every
  cactus on the farm:
  - n = number of ripe cacti.
  - The farm counts as **sorted** if, for every orthogonally adjacent pair of ripe cacti
    (no wrap), West ≤ East and South ≤ North.
  - Sorted yields **n²**; otherwise **n**. × Cactus level. Unripe cacti are lost.
- **Water:**
  - Growth speed × (1 + 4 × water).
  - Water decays linearly at 0.02/s.
  - Tank (after Watering): +1 Water every 10 s ÷ level, cap 5 + 5 × level.
- **Fertilizer:** −2 s of remaining growth (instant if ≤ 2 s left).

## Unlock table as implemented
Generated from `UNLOCKS` in `constants.js`. Costs are listed per level, in order.

| Unlock | Requires | Max | Costs (level 1; 2; …) | Effect |
|---|---|---|---|---|
| ⏩ Speed | — | 5 | 20 Hay; 60; 180; 540; 1620 Hay | ×2 execution speed per level |
| 🗺️ Expand | — | 9 | 30 Hay; 20 Wood; 40 Wood + 20 Carrot; 80 Wood + 50 Carrot; 150 Wood + 100 Carrot; 300 Wood + 100 Pumpkin; 500 Wood + 300 Pumpkin; 1000 Wood + 1000 Pumpkin; 2000 Wood + 2000 Pumpkin + 200 Cactus | Size 1→2→3→4→5→6→7→8→10→12, clears the farm |
| 🌿 Plant | — | 1 | 10 Hay | `plant()` + Bush |
| 👁️ Senses | — | 1 | 15 Hay | Sense functions |
| 🌾 Grass | Plant | 5 | 40; 120; 360; 1080; 3240 Hay | Hay × (level + 1) |
| 🥕 Carrots | Plant | 5 | 50 Wood; 100 Wood + 50 Carrot; ×3 per level after | `till()` + Carrot, yield × level |
| 🌳 Trees | Carrots | 5 | 100 Hay + 50 Wood; 200 Wood + 50 Carrot; ×3 per level after | Tree, wood yield × level |
| 💧 Watering | Carrots | 3 | 100 Wood + 50 Carrot; ×3 per level | Water tank |
| 🎃 Pumpkins | Carrots | 5 | 200 Carrot; 300 Carrot + 100 Pumpkin; ×3 per level after | Pumpkin, yield × level |
| 🌻 Sunflowers | Pumpkins | 1 | 100 Pumpkin | Sunflower → Power |
| 🧪 Fertilizer | Pumpkins | 1 | 100 Pumpkin | Fertilizer trade/use |
| 🌵 Cactus | Pumpkins | 3 | 200 Pumpkin; 500 Pumpkin + 100 Cactus; 1500 Pumpkin + 300 Cactus | Cactus + `swap()`, yield × level |
| 🧩 Mazes / 🦕 Dinosaurs / 🏭 Megafarm | — | — | — | Greyed "Coming in v2" (not purchasable) |

## Execution model
The player writes blocking TFWR-style code. `transform.js` rewrites it token by token
(strings, template literals, comments and regex literals are never touched), then it runs
as `new AsyncFunction(...apiNames, '"use strict";' + code)`.

- **Actions get `await`:** `harvest()` → `await harvest()`. Property calls (`obj.move()`) are
  not rewritten.
- **Functions become `async` only when needed.** That means they call an action or another
  async user function, contain a user `await`, or are *named* and contain a loop. This is
  computed as a fixpoint, so helpers can call helpers declared later. Their calls get `await`
  too, including `.method()` calls for object/class methods. Anonymous callbacks that don't
  need it stay sync, so `arr.sort((a, b) => a - b)` still works.
- **Loop guards live in the loop header:**
  - `while ((await __loopGuard(), (c)))`
  - `for (a; (await __loopGuard(), (c)); b)`
  - `for await (x of __loopIter(y))`, and `for…in` becomes `for await (k of __loopKeys(o))`
  - `do…while` is covered by its `while`
  - Loops inside sync callbacks get `__loopGuardSync()`, which throws after 10 M iterations.
- **The guard** checks the stop flag, yields to the event loop every ~16 ms (MessageChannel),
  and after 200,000 iterations without an action logs `⚠️ … loop without actions?` and
  throttles that loop to 100/s until the next action.
- **Stop:** a per-run flag. Actions and guards throw `STOP` once. If the player swallows it in
  `try/catch`, later calls park forever on a never-settling promise, so the run still stops.
  Starting a new run stops the old one. Sleeps are aborted immediately on stop.
- **Errors:**
  - Syntax errors are pre-checked on the original code; ESLint's parser provides the line
    number.
  - Runtime errors show `Line N: TypeError: …`. The transform never adds newlines, so the
    line numbers match the editor.
  - Calling actions from un-awaited callbacks (`forEach`, `map`, …) fails the run with a clear
    "drone is busy… use a for…of loop" message.
- **Timing:** debt-based sleeping, so very high speeds (up to 512×) batch tiny delays instead
  of hitting the browser's 4 ms `setTimeout` clamp.

## Audit summary (details in [AUDIT.md](AUDIT.md))

| Fixed | Noted |
|---|---|
| **#0 (new, critical): playground crashed with React #31 the first time an object was logged, which includes the default demo, so Run on a fresh visit gave a blank page.** It was a Suspense fallback rendering the raw object. Confirmed on the original `main` build in headless Chromium, then fixed | #11 Monarch tokenizer limits (highlighting only) |
| #1 Ctrl/Cmd+Enter now really exists (editor action + page handler + textarea) | #12b `playground_autorun` saved but never restored |
| #2 editor no longer re-created on callback identity change | #12c playground runs synchronously, so an infinite loop freezes the tab |
| #3 external loads are undoable (no `setValue`), no echo | #12d `ecmaVersion: 2020` shows parse errors for valid ES2021+ |
| #4 lint timer cleared; guarded against a disposed model | #12e unused `@monaco-editor/react` dependency |
| #5 theme/tokenizer/options registered once; ref-counted per-page `extraLib` | |
| #6 Tab `addCommand` leaked a global keybinding; now a scoped `addAction` | |
| #7 fallback textarea reads its live value | |
| #8 ⌨ Shortcuts modal on both pages (`?` when not typing) | |
| #9 Ctrl/Cmd+S: playground snapshot / farmer save + toast | |
| #10 farmer API globals for ESLint + full `.d.ts`; verified no TS double-report | |
| #12a Esc closes History, modal and menu | |

Two hypotheses in the brief turned out partly wrong:
- **#3:** there was no echo in the old code. The real problem was losing undo.
- **#10:** the squiggles come from ESLint, not TS.

Both are documented in AUDIT.md.

## Test results (actual output)

### `npm run test:farmer`
55 tests, all passing:
```
✔ default starter program farms hay from minute zero
✔ snake example covers a 3×3 farm
✔ bushes example produces wood
✔ carrot example tills, pays seeds and harvests carrots
✔ pumpkin example harvests a full 3×3 square (27 per harvest)
✔ cactus example sorts the farm and earns n² (81 on 3×3)
✔ sensor-only infinite loop stays stoppable and warns about runaway
✔ stop works even if the player swallows errors with try/catch
✔ locked actions return false and log a hint once
✔ runtime errors report the player's line number
✔ syntax errors are reported, not thrown
✔ actions inside forEach callbacks give a clear error
✔ power makes actions 2× faster and drains 1 per action
✔ unlock() from code buys upgrades
✔ all examples are lint-clean (no ESLint errors) with the farmer globals
✔ action calls get await
✔ sense calls are left synchronous
✔ existing await is not doubled
✔ user function becomes async and its calls are awaited
✔ helpers calling helpers (declared later) are async via fixpoint
✔ pure helper without actions stays sync (usable as sort comparator)
✔ arrow function assignment
✔ function expression assignment
✔ strings, templates, comments and regex literals are untouched
✔ property calls are untouched
✔ keywords and declarations are not awaited
✔ while loop gets a guard in its header
✔ brace-less loop bodies and do/while
✔ classic for loops (incl. empty condition)
✔ for...of / for...in become guarded async iteration
✔ nested loops each get a guard
✔ named function with a loop (waiting helper) becomes async
✔ loops inside sync callbacks get the sync guard
✔ object and class methods
✔ ASI-style code without semicolons keeps working
✔ transform never adds newlines (error line numbers stay correct)
✔ tokenizer distinguishes division from regex
✔ new game: 1×1 grassland with ripe grass, drone at (0,0)
✔ harvesting grass gives Hay and grass regrows
✔ unripe plants are destroyed by harvest (except grass)
✔ plant bush → wood
✔ locked plant fails with an unlock hint
✔ till + carrot flow deducts seed cost and needs soil
✔ pumpkin 2×2 square yields 8 and clears the whole group
✔ pumpkin non-square group yields its size; dead pumpkins yield nothing
✔ trees grow 2× slower per adjacent tree
✔ cactus: sorted farm yields n², unsorted yields n
✔ swap moves entities with their data and refuses to cross edges
✔ sunflowers give power; measure reads petals
✔ water speeds growth and decays; tank refills over time
✔ fertilizer via trade skips growth
✔ expand increases size and clears the farm
✔ unlock prerequisites and max levels
✔ movement wraps around the edges
✔ serialize / deserialize round-trip keeps growth progress
ℹ tests 55
ℹ pass 55
ℹ fail 0
```

- **Engine tests:** these run the real example programs (transform + runtime + world) on a
  virtual clock. Every sleep advances the world in ≤100 ms ticks, so 120 s of game time runs
  in milliseconds.
- **Lint test:** checks that every example is ESLint-error-free with the farmer globals.

### Build and lint
```
$ npm run build
dist/assets/index-D1Y68Bji.js        22.90 kB │ gzip:  6.83 kB
dist/assets/FarmerPage-DgWCoPc8.js   57.69 kB │ gzip: 20.30 kB
✓ built in 8.31s

$ npx eslint .
(0 problems)
```

### Servers
```
preview  GET /          → 200
preview  GET /#/farmer  → 200
dev      GET /          → 200
dev      GET /src/farmer/FarmerPage.jsx → 200
```

### Headless Chromium check (my own check, not the owner's screenshot review)
I drove `chromium --headless` on the built app (`vite preview`) through the DevTools protocol
with a throwaway script (not committed). These are the results it reported:

```
farmerTitle "JS Farmer", monacoLoaded true, squigglesDefault 0
Run click → statusRunning true, Hay 0 → 4 after 6 s, button "Stop"
Ctrl+Enter inside Monaco → button back to "Run", editor line count unchanged (no newline inserted)
Ctrl+S → "✓ Saved" shown, farmer_save_v1 + farmer_code present
"?" (focus outside editor) opens shortcuts modal; Esc closes it
Sensor-only infinite loop: page stays responsive, "loop without actions?" warning, Stop works
farmerErrors []   (no console errors / exceptions)
Playground: Ctrl+Enter runs code (console shows output), editor lines unchanged
Playground: Ctrl+S saves a snapshot (History opens), Esc closes History
localStorage keys: farmer_code, farmer_save_v1, playground_autorun, playground_code, playground_history
Squiggles with "harvest(); not_defined_xyz();": playground 2, farmer 1, playground again after route switch 2
6×6 save injected: 36 tiles render, program runs, 0 exceptions; mobile (390 px) layout stacks correctly
routeSwitchErrors []
```

The headless Chromium on the build box has **no colour-emoji font**, so emoji showed up as
boxes in those screenshots. Layout, colours and animation were fine. A normal desktop browser
renders the emoji. The owner's own browser screenshot check is still pending; I did not do it
for them.

## Deviations from the brief (and why)

1. **Loop guard placement.** The guard goes in the loop **header**, not as the first body
   statement. It runs on every iteration, including after `continue`, without having to find
   where a brace-less body ends. `for…of`/`for…in` use a guarded async iterator instead.
2. **Runaway guard throttles instead of stopping.** After 200,000 iterations without an action,
   it logs a warning and throttles the loop to 100/s. Killing the run would break legitimate
   TFWR-style waiting loops such as `while (!can_harvest()) {}`. The loop stays stoppable and
   the tab stays responsive.
3. **Functions are made `async` only when needed** (fixpoint), not for every `function`.
   Pure helpers stay sync, so they still work as `sort` comparators and similar callbacks.
4. **Unripe Grass isn't destroyed by `harvest()`** (returns false). Without this, the
   required "works from minute zero" starter (`harvest(); do_a_flip();`) would destroy
   growing grass on every pass and never earn Hay. All other plants follow TFWR and are
   destroyed when harvested unripe.
5. **Growth is saved as a progress fraction (0–1)** instead of remaining seconds. This is exact
   and survives reload. Growth doesn't run while the page is closed.
6. **Petals and cactus size are rolled when planted**, not at maturity. This lets
   `measure()`/`swap()` sorting start before the cacti ripen, and it is simpler.
7. **Planting over Grass replaces it;** any other entity blocks `plant()`. Bushes can go
   straight onto turf.
8. **`till()` is gated by Carrots** (TFWR-like). `move`, `clear`, `do_a_flip`, `unlock` and
   `can_move` are always available. The brief didn't specify these.
9. **Added `Unlocks.Grass`** for the required Grass yield-upgrade node. Entity and unlock names
   are plain strings, so `get_cost("Cactus")`/`get_cost("Grass")` are ambiguous. They resolve to
   the **unlock** (documented); Cactus seed cost is always 1 Pumpkin.
10. **`swap()` doesn't wrap** (false at an edge), so sorting can't accidentally swap across the
    border. `move()` and `measure(dir)` do wrap.
11. **Failed actions still cost 200 ticks.** This avoids zero-time spin loops, e.g. a loop that
    keeps trying to `plant()` without enough items.
12. **Watering / water rules.**
    - Brief's simple option: +1 Water every 10 s ÷ level, cap 5 + 5 × level.
    - Water only arrives after the Watering unlock.
    - `trade(Items.Water)` costs 1 Carrot; Fertilizer costs 1 Pumpkin.
13. **Power** uses the brief's "simpler" option: 1 Power per action, 2× faster.
14. **Cactus rule** is one clear whole-farm sortedness rule (n² vs n); see above and the
    Docs tab.
15. **MonacoEditor has one extra optional prop, `lintGlobals`.** The farmer squiggles come
    from ESLint (audit #10), and `extraLib` only feeds the TS service.
16. **External loads keep undo** (`pushEditOperations`) instead of documenting an undo reset.
17. **Out-of-list fix:** the critical playground crash (audit #0). It is a one-line,
    behavior-preserving fix.
18. **Time units:** 1 tick = 1 ms at 1×; `do_a_flip` = 600 ticks; the flip animation is
    shortened at high speed.
19. **`?` opens Shortcuts only when focus is not in the editor or a form field;** a ⌨ button is
    always there.
20. **Clear Farm asks for confirmation** because it destroys everything planted.

## Known limitations
- **Callbacks:** actions inside callbacks (`forEach`, `map`, `setTimeout`, `.then`) are not
  awaited, so the run fails with a clear message. Use `for…of`.
- **Indirect calls aren't awaited:** `const f = harvest; f()`, `fns[i]()`, and functions passed
  as parameters.
- **Unsupported function kinds:** getters, setters, constructors and generators can't contain
  actions.
- **Template literals:** `${…}` expressions inside them are not transformed (handled
  conservatively, as the brief allows).
- **Rare syntax errors after the rewrite:** `userFn() ** 2` becomes `await userFn() ** 2`.
- **Name clashes:** declaring a top-level `let`/`const` with an API name (e.g. `const move = …`)
  is a SyntaxError ("already declared"), because API functions are parameters.
- **Errors aren't highlighted in the editor** (log only, as the brief allows).
- **Background tabs:** browsers throttle timers there; each tick is clamped to 2 s, so growth
  can lag in long-hidden tabs. Growth doesn't happen while the page is closed.
- **Out of scope (v1):** Gold, Bone, Weird_Substance, mazes, dinosaurs, megafarm, and random
  grow-time variance.
- **Inherited:** the playground limitations listed in AUDIT.md (#11, #12b–e).

## Git
- **Committed locally** on branch `farmer-game`:
  `feat: add JS Farmer page and fix editor/keyboard-shortcut audit findings`, followed by a
  small docs commit with this push status.
- **Push failed (auth):** `git push -u origin farmer-game` returned
  `remote: Permission to bzcom8192/js-playground.git denied to develop-swf.` / `403`.
  The credentials stored on the build box belong to a GitHub account without write access to
  this repo.
- **To publish:** run `git push -u origin farmer-game` from an account that can push.
- `BRIEF.md` was left untracked, as it was found.
