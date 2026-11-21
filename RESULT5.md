# RESULT 5: Farmer info strip refreshes at a readable pace

Branch: `farmer-game` (on top of `d6752bd`). Everything in BRIEF5-INFOBAR.md is implemented. Not pushed.

```bash
npm run test:farmer    # 105 tests (100 old + 5 new in src/farmer/statusStrip.test.mjs) — all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency. The change is display-only: the engine, its game loop and the farm board are untouched.

## Where the strip gets its data
- The strip is `StatusPill` in `src/farmer/FarmerPage.jsx`.
- It used to read everything live on each render:
  - `game` is the engine's mutable game object, read through `W.droneTile(game)` for position, entity/ground
    and water.
  - `view.stats` is `runtime.stats()`: `elapsed`, `ticks` and `lastMeasure`.
  - `status` and `paused` come from `useFarmEngine`.
- `useFarmEngine`'s game loop calls `setView` up to every 33 ms (~30 fps) while anything changes. So the
  page, and the strip with it, re-rendered ~30×/s, and the ticks counter and clock changed on every frame.

## What changed
- **`src/farmer/statusStrip.js`** (new, pure functions):
  - `stripFields(game, stats, status, paused)` turns the live values into a flat snapshot of primitives,
    already formatted the way the strip showed them:
    - `x`, `y`
    - `what` (e.g. `🌱 Grass 20% / Grassland`)
    - `water` (% or `null`)
    - `elapsed` (`toFixed(1)`)
    - `ticks` (`toLocaleString("en-US")`)
    - `measure`
    - `status` (`"paused"` when paused)
  - `sameFields(a, b)` is a shallow compare.
  - `STRIP_REFRESH_MS = 250`.
- **`src/farmer/useSampled.js`** (new hook): `useSampled(value, ms)` returns the last sampled value.
  - The first render shows the current value immediately.
  - After that, it picks up the latest value at most once every `ms`.
  - An identical sample doesn't re-render.
  - The next sample is scheduled from the commit of the previous one (an effect keyed on the shown value),
    not with `setInterval`. A late timer therefore can't be followed by an early one, and visible updates
    are never closer together than 250 ms.
- **`StatusPill`** now renders `useSampled(stripFields(...), STRIP_REFRESH_MS)`.
  - Content and format are identical: same fields, same order, same emoji and separators.
  - Position, ground/entity, water, clock, ticks, 📏 measure and the Running/Paused/Error status all
    share the 250 ms cadence.
  - `demo` and `toast` are UI flags, not engine numbers, so they still render directly. They rarely
    change.

## Cadence chosen: 250 ms (≈4 updates/s)
I measured this in headless Chromium with the default program running on a fresh farm. A MutationObserver
counted text changes in the strip over 4 s:

| build  | strip text changes in 4 s | smallest gap between changes |
|--------|---------------------------|------------------------------|
| before | 30                        | 44 ms                        |
| after  | 12                        | 301 ms                       |

- Headless Chromium uses software GL, which caps the "before" rate at ~7.5/s. On a real GPU it was ~30/s.
- The gaps are slightly over 250 ms in headless because its main thread is busy.
- When you press Stop, the strip shows `Stopped` within one sample, with the final values.
- No console errors.

## Tests added (`src/farmer/statusStrip.test.mjs`)
- The refresh constant is 250 ms.
- `stripFields` reproduces the strip's format. Example from the owner's screenshot: `95,835` ticks,
  `11.9` s, `Grass 20% / Grassland`.
- Edge cases: grown entity, water %, measure, paused, empty tile.
- A snapshot is not affected by later engine mutation.
- `sameFields` reports equal and unequal samples correctly.

`useSampled` itself is a React hook. The repo has no DOM test setup, so it was verified in the browser
instead (table above).
