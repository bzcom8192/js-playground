# RESULT 2: JS Farmer UI overhaul (match the TFWR reference screenshot)

Branch: `farmer-game` (on top of `f0d1da0`). Every deliverable in BRIEF2-UI.md is implemented. Game
mechanics, the API, unlocks, the save format (`farmer_save_v1`) and the Playground page are unchanged.

```bash
npm run dev                        # http://localhost:5173/#/farmer
                                   # http://localhost:5173/#/farmer?demo=1  ← demo farm for screenshots
npm run test:farmer                # 70 tests (55 old + 15 new)
npm run lint && npm run build
```

## What changed, per section

### 1. Background
The whole page uses `.farmer-bg`, a flat blue-grey gradient from `#7ea6bb` to `#6f9ab0`. There is no header
bar and there are no dark side panels. Everything floats on the background.

### 2. Inventory (top-left)
- One row of 8 items in the order Hay, Wood, Carrot, Pumpkin, Power, Cactus, Water, Fertilizer.
- Each item is a ~30 px emoji with a drop shadow and a bold white count below it, with a soft text shadow.
- Counts use `formatCount()` (`src/farmer/format.js`, tested): `616`, `9k`, `10.1k`, `3.26k`, `1.5M`. That
  means up to 2 decimals, trailing zeros trimmed, and values are **truncated** so a count is never overstated.
- Zero counts are dimmed. There are no chips or pills.
- `ITEM_ORDER` in constants is unchanged, so the save format is unaffected. Only the UI order changed.

### 3. Top-right buttons
- Three 48 px olive squares (`#6f9419`, rounded-lg, shadow, brighten on hover, title tooltips):
  - **`+`** opens the Files menu: New file, a list of all files (click to reopen or bring to front), and 🗑
    delete with a confirm.
  - **`i`** toggles the Info window.
  - **⊞** (inline SVG) toggles the Unlocks window. It shows a small orange badge with the number of unlocks
    you can afford.
- **Speed select** and **Clear Farm** (with confirm) moved to the Unlocks window footer.
- **Reset Save** (red, with confirm) moved to the Info window footer.

### 4. Farm board (`src/farmer/FarmBoard.jsx`, replaces `FarmGrid.jsx`)
- **Placement:** the board sits center-left in a 55%-wide area.
- **Slab and tilt:** `perspective: 1200px` with `rotateX(13deg)` (origin center top). The slab is the dark
  groove colour showing through a 2–3 px grid gap.
  - Its thick bottom edge is made of layered solid box-shadows in browns and greys, plus a row of grey "rock"
    dots.
  - One large soft drop shadow sits on the background.
  - The tiles, crop layers, giant pumpkins, drone and shadow all live inside the tilted plane, and overflow is
    visible.
- **Tiles:**
  - Soil is `#96601f` with plough stripes from a repeating gradient (darker line every ⅓ tile) and an inset
    groove shadow.
  - Grassland is `#77a944` with two layers of subtle speckles.
  - Water is a blue `mix-blend-mode: color` overlay, so wet soil turns blue but keeps its stripes.
- **Crops:** plants are made of emoji, CSS and inline SVG, and are slightly oversized and anchored at the
  bottom of the tile. They scale from 0.3 to 1 as they grow. The z-index is set per row, so southern rows draw
  in front of northern ones.
  - **Grass:** 🌱 sprout while young. When mature it becomes a golden cluster of 5 overlapping 🌾, taller than
    the tile, with a gentle CSS sway (wheat only).
  - **Bush:** two mirrored 🌿 with 4 purple berry dots (radial-gradient spans) once mature.
  - **Tree:** 🌳 at 1.3× the tile, with the canopy overflowing.
  - **Carrot:** two green sprouts while growing. When mature, a 🥕 rotated so its leaves point up and clipped
    so only the orange shoulder shows, plus leafy tops.
  - **Pumpkin:** an original inline-SVG pumpkin. 🎃 has a carved face, which doesn't match the plain pumpkins
    in the reference.
    - **Giant pumpkins:** a connected group of fully grown pumpkins that forms a k×k square (k ≥ 2) is drawn as
      **one giant SVG pumpkin** across the group's bounding box. The tiles underneath show bare soil.
    - The grouping logic is `findGiantPumpkins` in `boardModel.js` (tested). It uses the same
      `W.pumpkinGroup` as the harvest rule, so what you see matches what harvesting pays out.
  - **Sunflower:** green stem with two leaves and a 🌻 head, about 1.2× the tile.
  - **Cactus:** 🌵 with a small pink flower dot when mature. There are no numeric badges, so you still need
    `measure()`.
  - **Dead pumpkin:** the same SVG in grey, squashed and tilted, slightly transparent.

### 5. Drone
- **Art:** an original inline SVG: a round orange body with ribs and eyes, a straw hat with a red band, and
  two arms with propeller bars that "spin" (a `scaleX` blur animation, which reads as spinning seen side-on).
- **Hover:** the body hovers about 55% of a tile above the tile center and slightly to the right, bobbing
  gently with `translateY` keyframes.
- **Shadow:** a soft elliptical shadow sits on the drone's real tile and pulses in sync with the bob.
- **`do_a_flip()`:** flips the flying element (the existing `farmer-flip` keyframes, on an inner wrapper so it
  doesn't fight the bob).
- **Movement:** the drone and its shadow slide between tiles using the existing move timing, with no slide
  across a wrap-around jump.
- **Pause:** the bob, propellers and wheat sway freeze while paused.

### 6. Status pill
- A translucent dark pill (`bg-black/40` with `backdrop-blur`) at the bottom-left of the farm area showing
  `📍 (x, y) · 🌻 Sunflower 45% / Soil · ⏱ 12.3s · 1,234 ticks · ● Running`.
- It adds 💧 water when the tile has some, 📏 the last `measure()` result, a **DEMO** badge in demo mode, and
  the "✓ Saved" toast.
- The state shows **Paused** while paused.

### Code windows
- **`FloatingWindow.jsx`:** shared chrome for every window.
  - Rounded-xl corners, a big soft shadow, and a 36 px light grey gradient header (`#a7adb0` → `#939a9e`)
    with the title in white bold with a shadow.
  - Green minimize (`—`) and close (`✕`) squares on the right. Double-clicking the header also minimizes.
  - A minimized window shows only its header bar. The body stays mounted (just hidden), so the editor keeps
    its undo history.
- **One Monaco instance per open window.**
  - The shared `MonacoEditor` gained one optional prop, `lintFilter`. The audit fixes are untouched:
    `onRun`, `onSave` and `extraLib` are read through refs, and the extra lib is ref-counted.
  - **Ctrl+Enter inside a window runs or stops that window's file.**
  - Ctrl+Enter outside an editor toggles the last-focused file. Ctrl+S saves all files and the farm.
- **Files model** (`useFarmerFiles.js`):
  - Files are stored as `{ v, nextId, files: [{id, name, code}] }` under **`farmer_files_v1`**.
  - **Migration:** an existing `farmer_code` (v1) becomes file #1 `crops`. With no old code, the game seeds
    `crops` (the default starter) and `f0` (a commented helper file with `go_home()`).
  - Verified in a real browser: a stored `farmer_code` became a single `crops` file.
- **Layout:** stored in `farmer_ui_v1` (`windows: { [fileId | "info" | "unlocks"]: {x, y, w, h, z,
  minimized, open} }`, plus `zTop` and the active file).
  - First-run defaults: `crops` at x 52%, y 18%, 46% × 62%. `f0` at x 62%, y 78%, 26% × 20%. Info and
    Unlocks start hidden.
  - Saved rects are clamped back into the viewport on load and on window resize.
- **Drag and resize:**
  - Drag by the header using pointer events and pointer capture. The window is clamped so its header always
    stays on screen.
  - Resize from the bottom-right handle (minimum 320×200).
  - Clicking a window brings it to the front (z counter).
  - While dragging or resizing, `body.farmer-dragging` turns off pointer events on Monaco and textareas and
    disables text selection.
- **Run semantics:** `src/farmer/program.js`, `buildProgram(files, mainId)`.
  - The running file's code is the program. Every other file contributes only its top-level function
    declarations, prepended **before** the main code.
  - **Collisions:** a helper whose name is declared at the top level of the main file (any declaration kind)
    is skipped. This avoids the `const` redeclaration SyntaxError the brief warned about. Between helper
    files, the first file in list order wins. Both cases are tested.
  - **Error lines:** `extractDeclarations` keeps every newline, so line numbers in each segment match the
    original file. Runtime and syntax errors read `Line N: …` for the main file and `f0, line N: …` for a
    helper. Verified in the browser.
  - **ESLint per window:** the farmer globals plus the other files' importable function names count as
    globals, so `go_home()` in `crops` isn't flagged as undefined. A file's own top-level functions aren't
    reported as "unused", since other files use them.
  - The rules are documented in Docs → "Files & windows".
- **Pause** (`runtime.js` + `useFarmEngine.js`):
  - Actions now sleep in ≤50 ms slices and check pause and stop between slices.
  - `gate()` and `__loopGuard` wait while paused, so sensor-only loops pause too.
  - `get_time()` and the elapsed time leave out paused time.
  - The engine's world tick is skipped while paused (no growth, water or regrowth).
  - Stopping or finishing clears pause.
  - Verified in the browser: time, ticks and grass growth stayed frozen for 1.5 s while paused.
- **Mobile (< 768 px):** the same window components with `floating = false`. They stack under the farm at full
  width with no drag or resize. Editor bodies are 20 rem; Info and Unlocks are 28 rem. The inventory wraps.

### Info and Unlocks windows
- **Unlocks window** (⊞ button):
  - Uses the same chrome. The `UnlocksPanel` content is restyled light (white or stone cards, dark text,
    olive buttons and pips).
  - The footer has the speed select and Clear Farm.
  - Its default position overlaps the farm's right edge near the top. It starts hidden.
- **Info window** (`i` button): tabs Docs | Output | Files.
  - **Docs:** the existing DocsPanel plus the "Files & windows" section. The examples dropdown loads into the
    **active (last-focused) file**, after a confirm that names it.
  - **Output:** LogPanel with a Clear button. It opens automatically on an error.
  - **Files:** each file has an open/close checkbox, rename (✎ or double-click, inline input, unique names),
    and delete (confirm, but never the last file). There is also a **+ New File** button.
  - **Footer:** ← Playground link, ⌨ Shortcuts, and a red **Reset Save…** (confirm). Reset Save also resets
    files and layout to the seeded defaults.

### Demo seed (`#/farmer?demo=1`, `src/farmer/demo.js`)
- An 8×8 farm with all unlocks at max level:
  - a **3×3 and a 2×2 giant pumpkin**, plus growing pumpkins and a dead one
  - wheat rows, a checkerboard-ish tree area, bushes and carrots
  - a sunflower column, a cactus column, a few watered tiles
  - inventory values like the reference
  - the drone at (4, 4)
- It is loaded **without touching the saved game**:
  - `save()` is a no-op in demo mode.
  - **The demo world is frozen**: no ticks, so growing pumpkins can't merge with the giant groups and change
    the screenshot.
- Any code edit, run, Ctrl+S, unlock purchase or Clear Farm leaves demo mode. It reloads the real save and
  rewrites the hash to `#/farmer`.
- `router.js` now ignores a `?query` in the hash. That is the only change to shared routing.

## Files touched
- **New:**
  - `src/farmer/FarmBoard.jsx`, `FloatingWindow.jsx`, `farmerUi.jsx` (colours and glyphs)
  - `useFarmerFiles.js`, `program.js`, `boardModel.js`, `demo.js`, `format.js`
  - tests: `program.test.mjs`, `board.test.mjs`, `format.test.mjs`
- **Changed:**
  - `src/farmer/FarmerPage.jsx` (rewritten), `runtime.js` (pause, slices, `mapLine`), `transform.js`
    (`listDeclarations`, `topLevelNames`, `extractDeclarations`), `useFarmEngine.js` (pause, demo,
    labelled runs)
  - `UnlocksPanel.jsx` (light), `DocsPanel.jsx` (files docs, example target), `examples.js` (`HELPER_CODE`)
  - `src/components/MonacoEditor.jsx` (optional `lintFilter` prop only)
  - `src/index.css` (farmer board CSS)
  - `src/router.js` (ignore `?query`)
  - `src/shortcuts.js` (Farmer entries' wording only)
- **Removed:** `src/farmer/FarmGrid.jsx`.

## Migration and storage choice
- I **kept `farmer_code` as a mirror of the first file**, the migrated or seeded `crops` file, even if it is
  renamed. It is updated with the debounced files save. This means an older build of the page still sees
  current code, and the brief preferred this option for backward compatibility.
- After migration, the source of truth is `farmer_files_v1`.

## Test / build / lint output
```
$ npm run test:farmer
ℹ tests 70
ℹ pass 70
ℹ fail 0
  new: 6+ extractDeclarations cases (functions, arrow/function-expression consts, loops/assignments
  excluded with line numbers kept, strings/templates/comments/regex safe, ASI end of expression arrows,
  excluded names), collision (main wins incl. const arrows; first helper wins), helper const arrow usable,
  mapLine, helper actions awaited, pause/resume/stop-while-paused, helper error file+line,
  findGiantPumpkins, demo farm, formatCount.

$ npm run lint      → 0 problems
$ npm run build     → ✓ built (FarmerPage chunk 90.4 kB, gzip 31.0 kB)
```

**Preview check by curl** (`vite preview`): `/`, `/#/farmer` and `/#/farmer?demo=1` all return 200.

**Headless Chromium smoke runs** (for my own checking only, not deliverables; the owner verifies the final
screenshots):
- the demo farm renders, including both giant pumpkins
- the Info and Unlocks windows open
- run then pause freezes the clock, ticks and growth
- a multi-file run prints from the helper, and a helper error reads `f0, line 5: TypeError…`
- dragging moves and persists a window
- resizing stops at the minimum size
- clicking a window raises it
- `farmer_code` migrates to a single `crops` file
- the mobile layout stacks the windows
- the Playground page still renders

The box had no color-emoji font, so for those runs I unpacked Debian's `fonts-noto-color-emoji` into
`~/.local/share/fonts`. That is outside the repo, and the app does not depend on it.

## Deviations and sub-decisions (closer-to-reference choices)
1. **Window header buttons depend on state.** In the reference, the running `crops` window shows ■ ❚❚ and the
   idle `f0` window shows ▶. So an idle window shows **▶ Run (olive)**. The running file's window shows
   **■ Stop and ❚❚ Pause (orange)**, and the pause glyph becomes ▶ while paused. All three buttons exist, just
   not at the same time.
2. **The board grows with the farm:** `boardPx = min(available, 170 + 95 × size)`. A 1×1 farm is a small plot
   rather than one 600 px tile, and boards of 6×6 and up fill the area. Drone size, hover offset and shadow
   are capped relative to the drone.
3. **Pumpkins are an original inline SVG** instead of 🎃 (the emoji has a carved face). The inventory still
   uses 🎃.
4. **Info window body is dark** (like the near-black editor), and **Unlocks is light** as the brief asked.
5. **Playground and Shortcuts links:**
   - Desktop: tiny, low-contrast links at the bottom-right (`← Playground · ⌨ ?`), plus links in the Info
     footer.
   - Mobile: a ← Playground link under the windows.
   - The reference has no nav, but the page must stay navigable.
6. **The demo world is frozen** (no ticks) so the screenshot layout stays exactly as designed. CSS animations
   still run.
7. **Window clamping keeps the header on screen**, not the whole window. Like the reference's `f0`, a window
   may hang off the bottom edge. Default rects are clamped to the 320×200 minimum on small viewports.
8. **Examples load into the active (last-focused) file**, after a confirm naming it. This is the brief's
   first option; it is more useful than always replacing `crops`.
9. **Migration with an existing `farmer_code` creates only `crops`**, as the brief says. Only fresh saves get
   `f0`; users can add files with `+`.

## Known limitations
- **One Monaco instance per open window.** Each editor costs a few MB and its own lint pass (debounced 500 ms).
  With the 2 default windows that's fine; a dozen open windows would be noticeably heavier. Closing a window
  disposes its editor; minimizing keeps it.
- **Monaco's TypeScript worker treats every open model as a global script.** Cross-file IntelliSense therefore
  works (helpers from `f0` autocomplete in `crops`). The flip side: the same `const` name declared at the top
  level of two files can get a TypeScript "Cannot redeclare" squiggle, even though the runtime handles that
  case. ESLint markers are computed per file and are correct.
- **The other windows' lint globals refresh on their next edit**, not instantly when a helper is
  added in another file.
- **Helper extraction is token-aware but not a full parser.** Supported forms: function declarations, and
  single-declarator `const`/`let`/`var` holding an arrow or function expression. Not imported: classes, other
  variables, multi-declarator statements (`const a = () => 1, b = 2`) and destructuring. They are ignored, as
  documented. For expression-bodied arrows, a declaration ends at `;`, a top-level `,`, or an ASI-style line
  break.
- **The tilt is a flat 13° plane.** Plants lean with the plane rather than standing upright in 3D (no
  `preserve-3d`), for performance and stable z-ordering.
- **Emoji crops depend on the system emoji font.** They look best with Noto Color Emoji, Apple or Segoe.
- **The board re-renders at ≤ 30 fps while something changes.** Tiles are memoized on primitive props, so
  only changed tiles re-render. 12×12 is the largest farm.

## Commit / push
Committed on `farmer-game`. The push result is recorded in the next section.

### Push status
- Committed locally on `farmer-game`, as the same author as the earlier farmer commits. The identity was
  passed with `git -c` because this box has no git identity configured.
- `git push origin farmer-game` **failed**: `remote: Permission to bzcom8192/js-playground.git denied to
  develop-swf` (HTTP 403). This is the same auth problem as last time. Push from an account with write access.
