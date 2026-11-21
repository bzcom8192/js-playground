# RESULT 13: JS Farmer v3, Phase 5 (Rice)

Branch: `farmer-game`. Implementation commit: **`d8f8242`** (on top of `38b2540`, the RESULT12 commit). This file was committed separately right after it, so it can quote that hash. Everything in BRIEF13-V3-RICE.md is implemented. Not pushed.

```bash
npm run test:farmer    # 237 tests (222 old + 15 new in src/farmer/rice.test.mjs), all pass (3 runs in a row)
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency. **One existing test changed** (see Deviations): in `contracts.test.mjs`, the "all unlocks" pool case now expects `Rice` between Pumpkin and Cactus.

## Files
- **`constants.js`**:
  - `Entities.Rice`, `Entities.Dead_Rice`, `Items.Rice` (with 🌾 icon and an `ITEM_ORDER` slot after Cactus), `Unlocks.Rice`.
  - `ENTITY_INFO.Rice` / `Dead_Rice`, `ENTITY_UNLOCK.Rice`.
  - The `RICE_*` tuning knobs (see "Numbers").
  - The **Rice** entry in `UNLOCKS`. It requires Pumpkins and sits after Fertilizer, before Cactus. `FUTURE_UNLOCKS` stays `[]`.
- **`world.js`**:
  - `plant()` checks the paddy's water. `makeEntity` gives rice a `dry` counter.
  - `simulate()` handles dry rice (stall, count, wither) and `effectiveGrowTime()` applies the L2 speed-up.
  - `harvest()` pays the yield. `mature()` drops the dry counter.
  - `TRADES` gained a `gives` field, so a trade can sell as well as buy.
  - `restoreRice()` cleans the dry counter on load.
- **`contracts.js`**: `CONTRACT_ITEMS.Rice` (tier 2.5, see below).
- **`weather.js`**: `STRIKABLE` now includes `Rice`, so lightning can destroy it. Dead_Rice is spared like Dead_Pumpkin.
- **`arena.js`**: `ARENA_UNLOCKS.Rice = 0`. Rice is off in the arena, and there is no rice goal.
- **3D (`board3d/models.js`, `layout.js`)**:
  - `riceGeometry()`: 3×3 hills of 6 thin stalks, each with a drooping panicle, merged into one geometry per variant.
  - Living rice gets a per-instance tint material, so the existing wheat code fades it green → gold as it grows.
  - Dead rice is a grey-brown, slumped variant on the shared flat material.
  - `growthScale` makes rice shoot up like wheat.
  - The paddy look is just the existing water planes under it.
- **2D (`FarmBoard.jsx`)**: rice is a clump of three 🌾, tinted green while growing and gold when ripe. Dead rice is a grey-brown, sepia, slumped clump.
- **`FarmerPage.jsx`**: Rice inventory slot after Cactus, with a small hue tint (see Caveats).
- **`statusStrip.js`**: on growing rice that is drying out, the strip adds `· dry 37/200`.
- **`DocsPanel.jsx`** / **`farmerLib.js`** / **`runtime.js`**:
  - Docs: a "Rice 🌾" rules row, plus updated plant/trade/get_cost rows, constants rows (Entities, Items, Unlocks), contract pool text and arena text.
  - TS: `Entities.Rice`, `Entities.Dead_Rice`, `Items.Rice` and `Unlocks.Rice` are generated from the constants. The `plant`, `trade` and `get_cost` docs mention rice.
- **`examples.js`**: **10. Rice Paddy**. It tills, tops each tile up to water 0.5 (buying Water with Carrots when the tank is low), plants, harvests and sells, with `trade(Items.Rice, n)`. It is lint-checked by the existing examples test and run end-to-end in `rice.test.mjs`.
- **`demo.js`**: the demo inventory shows 480 Rice. The demo farm layout is unchanged.
- **`rice.test.mjs`** (new, 15 tests): see "Tests".

## Numbers
| what | value |
|---|---|
| Unlock **Rice** L1 | 1,500 Pumpkin + 500 Carrot. Requires Pumpkins. Can plant rice |
| Unlock **Rice** L2 | 3,000 Pumpkin + 150 Gold. Yield 3 → 5, growth 1.5× faster |
| Seed | 1 Carrot (my choice; the brief names none) |
| Plant | Soil **and** tile water ≥ **0.5** at planting time. Otherwise it fails like any invalid plant: `false` plus a warning saying how wet the tile is |
| Grow time | **9 s** at L1, which is 1.5× the Carrot's 6 s. **6 s** at L2. The usual `× (1 + 4·water)` and weather factors apply |
| Dry | A growing rice tile with water **< 0.2** at the start of a step |
| Wither | dry for **more than 200** consecutive world ticks (> 20 s) → `Dead_Rice`. Any wet step resets the count |
| Yield | **3** Rice per plant (L1), **5** (L2). A single tile, never merged |
| Dead rice | `harvest()` clears it and gives nothing. `can_harvest()` is true, like Dead_Pumpkin |

### Trade table (`trade(item, n = 1)`, n times; fails inside a maze)
| call | you pay | you get | needs |
|---|---|---|---|
| `trade(Items.Fertilizer)` | 1 Pumpkin | 1 Fertilizer | Fertilizer |
| `trade(Items.Water)` | 1 Carrot | 1 Water | Watering |
| `trade(Items.Rice)` **(new)** | 1 Rice | **2 Gold** | Rice |

### Contract items (pool, lowest tier first)
| item | tier | needs | perTile | value | pays |
|---|---|---|---|---|---|
| Hay / Wood | 0 | — | 4 / 3 | 0.02 / 0.03 | Gold |
| Carrot | 1 | Carrots | 2 | 0.1 | Gold |
| Pumpkin | 2 | Pumpkins | 2 | 0.25 | Gold |
| **Rice** | **2.5** | **Rice** | **2** | **0.375** | **Gold** |
| Cactus | 3 | Cactus | 2 | 0.5 | Gold |
| Gold / Bone | 4 / 5 | Mazes / Dinosaurs | 1 | 0.5 / 1 | Bone |

- Tier 2.5 makes the budget `20,000 + amount × 400 × 3.5` ticks. It also sorts rice between Pumpkin and Cactus.
- Every slot still draws exactly two numbers, so farms without Rice get exactly the contracts they got before.

## Decisions
- **Dry rice stops growing (the one rule I added).**
  - Taken literally, the brief's numbers never let rice wither. Even at water 0 rice grows at 1×, so it ripens in 9 s, long before 20 s of dryness.
  - Planted at 0.5 on a normal day, the paddy takes 15 s to evaporate down to 0.2. Rice ripens in about 3 s.
  - So growing rice on a tile below 0.2 now stalls: it doesn't grow, it counts dry ticks, and past 200 it withers.
  - This makes withering real and emergent with no weather special-casing. On a **Drought** day (evaporation ×3, half growth under 0.5) a paddy planted at exactly 0.5 stalls at about 67% after 5 s and withers 20 s later unless watered.
  - **Rain** keeps the paddy above 0.5, and it ripens. A **Sunny** day ripens it well before the paddy dries.
  - All three cases are tested.
- **Time base.** "Ticks" are world ticks (0.1 s), the same tick the weather counts (RESULT12). So 200 ticks = 20 s of farm time. It pauses with the farm and does not depend on Speed or Power.
  - The counter advances by `dt × 10` per step, judged on the water at the start of the step (exactly like the growth formula).
  - With the page's 0.1 s steps that is exact to the tick. A test checks that a single 20 s step doesn't wither and 20.1 s does.
- **L2 "faster growth" = 1.5× faster** (9 s → 6 s, the Carrot's base time).
- **Ripe rice needs no water.** It never withers once grown, which matches "while growing".
- **The dry counter is saved** with the tile entity (`e.dry`). On load it is clamped to 0…200, junk becomes 0, and ripe rice has none.
  - Old saves need nothing: the Rice item and unlock default to 0, and there are no rice tiles.
  - A test loads a pre-Rice save with the keys removed. Headless Chromium confirmed the same (below).
- **Lightning can strike rice.** Rice is a planted crop, so it joined `STRIKABLE`. Dead rice is spared, like Dead_Pumpkin.
- **Arena: rice is skipped.** A rice goal preset is not trivial: the bots would need paddy logic, and rice selling would bring back a Gold source the arena deliberately removed. `ARENA_UNLOCKS.Rice = 0`, and the arena text says "no Mazes, Dinosaurs or Rice".
- **`get_cost(Rice)` / `num_unlocked(Rice)`:** the name is shared by the unlock and the entity, so like Cactus and Grass it resolves to the unlock. `get_cost(Entities.Dead_Rice)` is `null`.

## Tests (`rice.test.mjs`, 15)
- **Content:** unlock position, costs, the 2 levels, constants, icons and the TS declarations.
- **Gating:**
  - Locked before L1, and nothing is paid.
  - L1 needs Pumpkins.
  - L1 and L2 costs are paid exactly. L2 is the max.
- **Planting:**
  - Fails on Grassland and at water 0, 0.2, 0.49 and 0.4999. Succeeds at 0.5, 0.8 and 1, and over Grass.
  - A failed plant pays nothing. Planting without a seed fails.
  - From a program, `plant()` returns false with a warning, and true after watering.
- **Withering:**
  - Exactly 200 dry ticks: still alive and not growing. The 201st withers it.
  - A wet tick (water exactly 0.2) resets the count.
  - One 20 s step doesn't wither it; 20.1 s does. Ripe rice never withers.
- **Dead rice:** harvesting gives nothing and leaves the Soil. Unripe rice is destroyed without yield.
- **Yield:** 3 (L1) and 5 (L2) on a full 3×3 paddy. Only the harvested tile clears.
- **Growth time:**
  - At water 0.5, carrot takes 2.0 s and rice 3.0 s (ratio 1.5). L2 rice takes 2.0 s.
  - Fertilizer works on rice.
- **Trade:**
  - Gated by the Rice unlock. Selling n at a time works. Short of Rice it fails and changes nothing.
  - Fertilizer and Water trades are unchanged. `trade("toString")` is rejected.
- **Contracts:**
  - The pool includes Rice only with the unlock, in tier order. Over 60 days rice appears only with the unlock.
  - A rice contract's reward and budget follow the formulas, it survives a save, and delivery pays Gold.
- **Weather:** Drought kills a fresh paddy, Rain ripens it (water rises), Sunny ripens it. The strike set includes Rice but not Dead_Rice.
- **Saves:**
  - Round-trip with a mid-dry rice plant and dead rice. Both copies then wither on the same tick.
  - Junk dry counts are clamped.
  - A pre-Rice save loads with Rice 0, the unlock 0 and its items and crops intact.
- **Presentation:**
  - Strip text `🌾 Rice 0% / Soil · dry 12/200` → `🌾 Dead Rice / Soil`.
  - `growthScale` and `modelKey`.
  - The model kit builds all 3 variants of both types, with a tint material only on living rice.
  - `FarmScene` builds a 3×3 paddy without rebuilding as it grows.
- **Example 10** runs end-to-end on a 3×3 farm: it sells a multiple of 3 Rice for 2 Gold each, has no errors, and the field becomes Soil.

**Checked in headless Chromium against the production build** (`vite preview`, SwiftShader GL; not part of the test suite):
- A hand-made save with rice at several stages, dead rice and carrots rendered in 3D. The paddies showed as clumped stalk hills over the water planes, and dead rice was grey-brown and slumped.
- With WebGL disabled, the 2D fallback showed the green-gold 🌾 clumps and the grey sepia dead clumps.
- The strip read `🌾 Dead Rice / Soil`, and the inventory showed 120 Rice with its tint.
- The page re-saved the rice tiles, the item and the unlock.
- A pre-Rice save (no Rice keys, no weather) loaded and kept Hay 4242. It got Rice 0, unlock 0 and a weather seed.
- No console errors.

## Deviations and caveats
- **Stall while dry** is my addition (see Decisions). Without it, the brief's withering rule can never trigger.
- **One existing test edited:** in `contracts.test.mjs` ("pool respects unlocks…"), the `ALL` case's expected pool gained `"Rice"`. The brief requires that change in behaviour. The arena content test, which checks that every unlock is named in `ARENA_UNLOCKS`, passes untouched because `Rice: 0` was added.
- **Seed cost (1 Carrot) is my choice.** The real cost of a plant is its water: about 2 Water (= 2 Carrots by trade) to bring dry Soil to 0.5, or none after rain.
- **Rice contracts pay less than selling.** A contract pays about 0.375 × 1.5 ≈ 0.56 Gold per Rice delivered, but `trade(Items.Rice)` pays 2 Gold.
  - I followed the brief ("reward tier between Pumpkin and Cactus"), but economically a rice contract is only worth it for the Records contract count.
  - If that matters: raise `CONTRACT_ITEMS.Rice.value` to about 1.5. That is a one-line change and would not affect any other contract.
- **Rice is an early Gold source.** It unlocks right after Pumpkins, before Mazes, so Gold now arrives earlier than in v2: 3 Rice per plant → 6 Gold. The Gold-priced unlocks (Dinosaurs, Megafarm, Mazes L2+) still need their prerequisites, so nothing skips the tree. Rice L2's 150 Gold is affordable from selling rice.
- **Icons.** Hay, the Grass unlock and Rice all use 🌾, as the brief asks. To tell the Hay and Rice inventory slots apart, the Rice slot has a CSS hue tint, and its tooltip says "Rice".
- **Unlock order in the panel:** Rice is listed after Fertilizer and before Cactus (all Pumpkins children). Putting it after Cactus would break the existing "Mazes right after Cactus" ordering tests.

---

## v3 complete

All five v3 phases are on `farmer-game` (not pushed):

| phase | commit | what | tests after |
|---|---|---|---|
| 1. Scores, Records & Seeded Mazes | `06a1670` | ops/tick counters, personal records, seeded and replayable mazes, Records window | 171 |
| 2. Seeded Contracts | `35ee06b` | 3 daily contracts from a date seed, `get_contracts()` / `deliver_contract()`, farm clock | 185 |
| 3. Async Arena + ELO | `65eed17` | headless bot races on a shared virtual clock (Web Worker), ELO vs 3 bots, `get_arena_goal()` | 203 |
| 4. Weather | `e546d6c` | seeded 2-minute weather segments (Sunny / Rain / Storm / Drought), lightning, `get_weather()` / `get_forecast()` | 222 |
| 5. Rice | `d8f8242` | paddy crop with water rules and withering, Rice → Gold trade, rice contracts, 3D/2D paddies | 237 |

Each phase landed with lint at 0 and a clean build. Saves stayed `v: 1` throughout: every phase loads saves from before it.

**Known-deferred:**
- **Worker multicore.** Only arena matches run off the main thread (one Web Worker per match).
  - The player's own runs, including every Megafarm drone, still share the page's main thread with the 3D board.
  - Moving the farm runtime into Workers, so drones and rendering can use several cores, was not attempted.
- **Dinosaur / apple seeding.** The dinosaur's random walk and apple spawns still use ambient randomness (noted in RESULT9).
  - Bone runs are therefore not replayable the way maze runs are.
  - The natural fix is one seed per hatch, recorded like maze seeds.
- **Smaller items named above:**
  - A rice arena goal (skipped).
  - Rice contract value vs the sell price (a tuning question).
  - The arena's non-virtualized `Date.now()` / `setTimeout` (RESULT11).
