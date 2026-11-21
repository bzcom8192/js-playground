# RESULT 12: JS Farmer v3, Phase 4 (Weather)

Branch: `farmer-game`. Implementation commit: **`e546d6c`** (on top of `65eed17`, Arena). This file was committed separately right after it, so it can quote that hash. Everything in BRIEF12-V3-WEATHER.md is implemented. Not pushed.

```bash
npm run test:farmer    # 222 tests (203 old + 19 new in src/farmer/weather.test.mjs), all pass (3 runs in a row)
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency. **One existing test changed** (see Deviations): the records test "every function the program is given is counted" now expects `fns.length + 24`, because `get_forecast()` costs 25 ops by design.

## Files
- **`weather.js`** (new, pure): the states, weights, effect numbers, the seed derivation (`hash32`, `segmentWeather`, `strikeMoments`, `strikeTargets`, `forecast`), the save section (`newWeather`, `sanitizeWeather`) and `tickEventLines` (the Log lines).
- **`world.js`**:
  - `tick()` is now weather-aware.
  - The old body is `simulate(state, dt, rng, fx)`, run with neutral effects when there is no weather, so a weatherless world is exactly the old tick.
  - New `state.weather = { seed, time } | null`, plus `newFarm()`, `ensureWeather()`, `currentWeather()`, `weatherForecast()` and `advanceWeatherClock()`. Weather is saved and loaded.
- **`runtime.js`**: `get_weather()` and `get_forecast()`. The forecast adds 24 ops on top of the normal 1.
- **`useFarmEngine.js`**:
  - New saves use `W.newFarm()`, and loaded or imported saves get `W.ensureWeather()`.
  - World ticks run inside `withEvents`, so weather changes and lightning strikes go to the Output log.
  - The demo advances only its weather clock.
- **`demo.js`**: the demo farm gets the fixed `DEMO_WEATHER_SEED` (12).
- **`statusStrip.js`**: a `weather` strip field, plus `weatherFields()` for the Weather tab (sampled every 1 s).
- **`WeatherPanel.jsx`** (new), **`FarmerPage.jsx`**:
  - The info strip shows the weather icon and name.
  - The Info window has a fourth tab, **Weather**: the current weather and its effect, the approximate forecast, and how weather works.
- **`farmerLib.js`** / **`DocsPanel.jsx`**:
  - TS: `type WeatherType`, plus `get_weather(): WeatherType | null` and `get_forecast(): { next; inTicks } | null` declarations. Both are lint globals.
  - Docs: API rows, a "Weather" constants row and a "Weather 🌦" docs section.

## Time base (decision)
**A weather tick is a world tick: 0.1 s of farm time, which is one step of the page's 100 ms simulation loop.**
- The brief's "segments of 1,200 ticks" cannot use the project's other tick:
  - The run tick (1 ms, as in `get_tick_count()` / records / contracts) would give 1.2 s segments.
  - The farm clock (200 per action, and it only moves while a program runs) would give a change every 6 moves.
- With world ticks, a segment is 1,200 × 0.1 s = **2 minutes** of farm time.
- How the weather clock moves:
  - It lives in the save as `weather.time`, a float count of world ticks.
  - It only advances when the world does. Pause freezes it, the same as growth.
  - It does not depend on Speed or Power.
- `get_forecast().inTicks` is in these world ticks. The Docs, the TS declaration and the Weather tab all say "10 per second".

## Derivation (exact; also in the header of `weather.js`)
```
hash32(a, b, …): h = 0x9e3779b9; per part p:
    h = imul(h ^ p, 0x85ebca6b); h ^= h >>> 13; h = imul(h, 0xc2b2ae35); h ^= h >>> 16   → h >>> 0
tick        = ⌊weather.time⌋
segment i   = ⌊tick / 1200⌋
segSeed(i)  = hash32(seed, i)
stream_i    = mulberry32(segSeed(i))                    (the maze PRNG)
weather(i)  = draw #1 of stream_i, cumulative in order Sunny .40 | Rain .30 | Storm .15 | Drought .15
Storm strikes: draws #2..#4 of stream_i → ticks i·1200 + 1 + ⌊r·1199⌋, sorted
Strike k targets: mulberry32(hash32(segSeed(i), k)): count = 1 + ⌊r·3⌋ (≤ crops),
                  then one draw per pick from the remaining crop tiles (tile-index order)
Forecast at tick t: next = weather(i+1); true = (i+1)·1200 − t   (1…1200)
                  r = mulberry32(hash32(segSeed(i), t, 0x46c3a5f1)); u = r(); sign = r() < .5 ? −1 : +1
                  err = max(1, ⌊u · 0.2 · true⌋); inTicks = true + sign·err  (sign forced + if result < 1)
```

How it behaves:
- The values are pinned by golden-value tests. For example, seed 12 gives segments Rain, Sunny, Storm, Sunny, Storm, Sunny.
- The weights were checked over 20,000 segments (each state within 2%).
- `inTicks` is always a whole number. It is never exact, and it stays within ±20% whenever the true value is ≥ 5 ticks.
  - Below 5 ticks, ±20% contains no other whole number, so the error there is exactly 1 tick.
  - The tests check every tick of 2 segments for 4 seeds.
- The blur is re-drawn every world tick, so repeated calls average out, but each call costs 25 ops.

## Effects (numbers)
| weather | effect |
|---|---|
| ☀️ Sunny | baseline. Tested to give the identical tiles to a weatherless world |
| 🌧 Rain | every **Soil** tile gains +0.03 water/s. With the normal −0.02/s evaporation that is a net **+0.01/s**: 0 → 0.6 in a minute, and capped at 1. Grassland is untouched and the growth formula is unchanged |
| 🏜 Drought | evaporation **×3** (−0.06/s). Growth **×0.5** unless the tile's water is **≥ 0.5** at that step |
| ⛈ Storm | growth **×1.5**. **3** lightning moments per storm segment, each destroying **1–3** random crops |

How the effects plug into the existing water model:
- The water model is not forked. It is the same per-tile loop:
  - growth rate = (1 + 4·water) × growth × (water ≥ 0.5 ? 1 : dryGrowth);
  - evaporation = 0.02 × evaporation multiplier;
  - rain is added to Soil, and water is clamped to [0, 1].
- "Crops" are Bush, Tree, Carrot, Pumpkin, Sunflower and Cactus.
  - Grass, Dead_Pumpkin, maze tiles, the dinosaur and apples are spared.
  - Nothing is struck inside a maze.
  - A struck tile keeps its ground and its water.
- Strikes are logged as a warning, e.g. `⚡ Lightning struck 2 crops: Tree (3, 1), Carrot (0, 4)`.
- Weather changes are logged as info, e.g. `Weather: 🏜 Drought (was 🌧 Rain)`.

**Exact timing for any dt:**
- `tick()` cuts its step at every weather event (a segment end or a strike moment). Each piece runs under one weather, and every strike fires at exactly its tick.
- A test checks that one 150 s tick and 1,500 steps of 0.1 s give the same water levels across a Rain → Drought boundary.
- Another test checks that a save/load in the middle of a storm doesn't change which tiles are struck.

## API
- **`get_weather()`** → `"Sunny" | "Rain" | "Storm" | "Drought"`. It costs 1 op and 1 tick, and needs no Senses unlock.
- **`get_forecast()`** → `{ next, inTicks }`.
  - `next` is the true weather of the next segment. It can equal the current weather, and the Weather tab then says "(no change)".
  - It costs **25 ops** (counted on entry, like every call) and 1 tick.
- On a weatherless world (the arena) both return `null`.

## Saves
- **Shape:** `farmer_save_v1.weather = { seed, time }`, still `v: 1`.
- **Load rules:**
  - Weather is save-level. Like records and contracts, it survives a rejected farm part.
  - A save **without** a `weather` key (written before this phase), junk in that key, or a garbage save gets a fresh seed on load. The seed is then kept, which is tested.
  - An explicit `weather: null` stays weatherless. Only test or hand-made worlds have that, and the page calls `ensureWeather()` after every load and import anyway.
- **Where the seed is drawn:** a plain `createGame()` world is weatherless, so the existing tests and the arena are untouched. The page creates saves with `newFarm()` (on first visit and Reset Save), which draws the seed once.
- **Checked in headless Chromium against the production build:**
  - A fresh visit saved `weather: { seed, time }`.
  - An old save with the `weather` key removed (and Hay set to 4242) loaded, gained a new seed and kept its Hay.
  - The strip showed "⛈ Storm" and the Weather tab rendered.
  - The demo strip showed "🌧 Rain", and the real save's weather was untouched.
  - No console errors.

## Interactions
- **Arena:** `arenaWorld()` builds on `createGame()`, so its worlds have `weather: null`. Nothing was retrofitted, and the arena tests are unchanged and pass.
- **Contracts and records:** unaffected.
  - The weather clock is separate from the farm clock (`state.clock`), and a test checks that the farm clock does not move with the weather.
  - The only effect on ops records is that a program calling `get_forecast()` uses more ops, as intended.
- **Demo:** the farm stays a frozen showcase, as before. Only its weather clock moves, from seed 12: Rain, then Sunny after 2 minutes, then Storm. `serialize()` writes `weather: null` for a demo farm.

## Deviations and caveats
- **The time base is my decision** (world ticks of 0.1 s, see above). If the brief meant 1 ms ticks, change `WEATHER_TICKS_PER_SEC` (10) or `SEGMENT_TICKS` (1200); everything derives from them.
- **One existing test was edited.** In `records.test.mjs`, the test that says every API call is 1 op now adds `FORECAST_OPS - 1`. The brief requires that change in behaviour. No other test was touched.
- **"Free sense":** I read this as "needs no unlock". Both functions work without Senses; the forecast's price is only in ops.
- **The UI forecast is the same blurred value `get_forecast()` would return at that tick.** It never shows the true time. The Weather tab re-samples once a second, so the number jitters slightly while it counts down.
- **One extra kind of log line:** besides the strike announcements the brief asks for, a weather change is also logged as one line every 2 minutes at most.
- **Lightning targets depend on the farm.** The choice is a seeded pick over the current crop tiles in tile order, so it is deterministic for the same seed and the same farm. A different farm layout gets different victims at the same moments.
- **Rice (phase 5) gets no special case.** Its water rules will see Rain and Drought through the shared water model.
