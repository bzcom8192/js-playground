# RESULT 10: JS Farmer v3, Phase 2 (Seeded Contracts)

Branch: `farmer-game` (on top of `06a1670`, Scores/Records/Seeded Mazes). Everything in BRIEF10-V3-CONTRACTS.md is implemented. Not pushed.

```bash
npm run test:farmer    # 185 tests (171 old + 14 new in src/farmer/contracts.test.mjs), all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No existing test was changed. No new dependency.

## Files
- **`contracts.js`** (new, pure): the item table, daily seed, generation, expiry, day rollover, delivery, the `get_contracts()` snapshot, log lines and save sanitizing.
- **`world.js`**:
  - New `state.clock` (the farm clock) and `state.contracts`, both saved and loaded.
  - Like records, they survive when the farm part of a save is rejected.
  - A demo farm serializes `contracts: null`.
- **`records.js`**: new `records.contracts = { completed, bonus: { Gold, Bone } }`, with `addContractDone` and sanitizing.
- **`runtime.js`**:
  - The new `get_contracts()` (a sense) and `deliver_contract(id)` (an action).
  - The run clock drives the farm clock, and overdue contracts expire on tick advance.
  - A new `today` option (default: the local date from `wallClock`).
- **`transform.js`**: `deliver_contract` is added to `ACTIONS`, so calls to it are awaited automatically.
- **`farmerLib.js`**: a `Contract` interface and both function declarations; both names are in `FARMER_GLOBALS` (lint and editor).
- **`useFarmEngine.js`**:
  - `checkDay()` runs on load (the first loop pass) and then once a second, so a date change while the page is open also rolls the contracts over.
  - `deliverContract(id)` serves the Deliver button.
- **`ContractsPanel.jsx`** (new), **`FarmerPage.jsx`** and **`useFarmerFiles.js`**:
  - The Contracts window and a fifth 📜 button in the top-right row.
  - The button has an orange "ready to deliver" badge, like the Unlocks badge.
  - The window position is saved like the other windows.
- **`RecordsPanel.jsx`**: one small "Contracts 📜 N completed +X Gold +Y Bone" row.
- **`DocsPanel.jsx`**: two API rows and a short "Contracts 📜" section.

## 1. Generation formula
- **Daily seed:** `dailySeed(date)` is FNV-1a 32-bit of the local date string `YYYY-MM-DD`. The rng is `mulberry32(seed)` from maze.js.
- **Slots:** each of the 3 slots draws exactly 2 numbers (`rItem`, `rAmount`), whatever the pool size. So the same date + unlocks + farm size always gives the identical set, on any machine.
- **Pool:** the items you can already produce, lowest tier first.
- **Item pick:** `pool[floor(rItem × poolSize)]`. If that item is already used and unused items remain, it steps forward to the next unused one. With only Hay and Wood in the pool, the third slot repeats one of them.
- **Amount:** `max(5, nice(perTile × size² × (0.75 + 0.5·rAmount)))`.
  - `nice` keeps values exact below 20, then rounds to steps of 5 (below 200), 10 (below 2000), or 50.
- **Reward:** `max(1, round(amount × value × 1.5))` of the reward item.
- **Budget:** `ceil₁₀₀₀(20 000 + amount × 400 × (tier + 1))` ticks.
- **Deadline:** `deadlineTick = farm clock at generation + budget`.
- **Order and ids:** contracts are sorted easiest first (by tier, stable) and get the ids `YYYY-MM-DD#1…3`. Ids are unique across days, so an id from yesterday never delivers.

### Values used
| item | tier | needs | perTile | reward | value (in reward) |
|---|---|---|---|---|---|
| Hay | 0 | always | 4 | Gold | 0.02 |
| Wood | 0 | always | 3 | Gold | 0.03 |
| Carrot | 1 | Carrots | 2 | Gold | 0.1 |
| Pumpkin | 2 | Pumpkins | 2 | Gold | 0.25 |
| Cactus | 3 | Cactus | 2 | Gold | 0.5 |
| Gold | 4 | Mazes | 1 | **Bone** | 0.5 |
| Bone | 5 | Dinosaurs | 1 | **Bone** | 1 |

Typical contracts with the jitter at its middle (r = 0.5):

| | 3×3 farm | 12×12 farm |
|---|---|---|
| Hay | 35 → 1 Gold, 34k ticks | 580 → 17 Gold, 252k ticks |
| Wood | 25 → 1 Gold, 30k ticks | 430 → 19 Gold, 192k ticks |
| Carrot | 18 → 3 Gold, 35k ticks | 290 → 44 Gold, 252k ticks |
| Pumpkin | 18 → 7 Gold, 42k ticks | 290 → 109 Gold, 368k ticks |
| Cactus | 18 → 14 Gold, 49k ticks | 290 → 218 Gold, 484k ticks |
| Gold | 9 → 7 Bone, 38k ticks | 145 → 109 Bone, 310k ticks |
| Bone | 9 → 14 Bone, 42k ticks | 145 → 218 Bone, 368k ticks |

For scale: one 12×12 maze at Mazes level 1 pays 144 Gold, and an action costs 200 ticks.

## 2. State shape
In `farmer_save_v1` (still `v: 1`):
```js
clock: 123456,                       // farm clock in ticks
contracts: { date: "2026-11-21", contracts: [
  { id: "2026-11-21#1", item: "Hay", amount: 580, rewardItem: "Gold", reward: 17,
    deadlineTick: 375456, status: "active" /* | "done" | "expired" */ }, … ] },
records: { …phase 1…, contracts: { completed: 4, bonus: { Gold: 120, Bone: 0 } } }
```
- **`get_contracts()`** returns fresh plain objects: `{ id, item, amount, reward, rewardItem, ticksLeft, status }`. `ticksLeft` is 0 once a contract is done or expired. Changing the snapshot does not touch the save (tested).
- **`deliver_contract(id)`**:
  - Returns true on success.
  - Otherwise it returns false and logs one hint per distinct reason: no contract with that id, already delivered, expired, or "needs N Item".
  - Success logs `📜 Contract delivered: 75 Pumpkin → 28 Gold`. The Deliver button calls the same `contracts.deliverContract` and logs the same line.
- **Ops:** both functions are in the API surface, so they count 1 op each (the phase-1 "every API function" ops test now includes them automatically).
  - `get_contracts` is a free sense: 1 tick, no Senses unlock needed.
  - `deliver_contract` is an action, like `trade`: 200 ticks.
- **Expiry:** a contract expires when `clock > deadlineTick`; at exactly the deadline tick it can still be delivered. It is checked:
  - every time the run clock advances (O(1), plus a loop over ≤ 3 contracts);
  - when delivering;
  - in the engine's day check, which also catches a save loaded past a deadline.
  - Each expiry while playing logs `📜 Contract expired: …`.
- **Day rollover:** happens on load, then once a second in the page loop, and also inside `get_contracts` / `deliver_contract` mid-run.
  - The old day's active contracts become expired, done ones stay done, and today's set replaces the list.
  - The log says `📜 New contracts for today — N unfinished contracts from <date> expired.`
- **Persistence:**
  - Old saves (no `clock`, `contracts` or contract stats) load with clock 0 and fresh contracts.
  - Damaged entries are dropped one by one, and if none are left the day is regenerated.
  - Export and import need no format change, because everything is inside `save`.
- **Demo mode:**
  - The demo farm generates and shows contracts.
  - `serialize` writes `contracts: null` for it, and deliveries on it record no stats (tested).
  - The Deliver button on the demo leaves demo mode and delivers nothing. Demo contracts can differ from the real farm's (different unlocks), so the same id could mean a different order.

## 3. UI
- **Button:** 📜 is the fifth button in the top-right row (+ / i / Unlocks / 🏆 / 📜), with an orange count of contracts ready to deliver.
- **Window:** "Contracts" (with "· N ready" in the title). It uses the light stone style of Records and scrolls internally.
- **Each card shows:**
  - the item icon and amount, with "have x / amount";
  - the reward and its icon, and a status chip;
  - "⏳ N ticks left", and either a **Deliver** button or "need N more".
- **Sampling:** the farm clock and the item counts are sampled through `useSampled(…, STRIP_REFRESH_MS)` like the info strip.
- **Records window:** one row, "Contracts 📜 N completed +X Gold +Y Bone".
- **Visual check:** in headless Chromium against the production build, I checked:
  - the demo farm with 3 ready contracts;
  - a real save with a done, a short and a deliverable contract;
  - a Deliver click, which consumed the items, paid the reward, marked the contract done, updated the stats, saved and logged.

## Deviations and uncertainties
- **"Tick count" is a new save-level farm clock driven by program ticks, not wall time.**
  - It uses the same ticks as `get_tick_count()`: action 200, flip 600, sense 1, unaffected by Speed or Power.
  - Each run adds its run clock (the longest drone timeline, as in phase 1), so Megafarm helps rather than burning the deadline 12× faster.
  - Consequences: deadlines only count down while programs run, and are deterministic and fair across machines. Idle wall-time growth is free.
  - If you meant a wall-time clock, the change is confined to `addTicks` in runtime.js plus advancing the clock in `W.tick`.
- **Stock delivers at once.** Following "inventory has the amount → consume", a player who already holds the items can deliver immediately, without producing anything during the contract. Bigger amounts, or counting only items produced after generation, would change that. I left it as specified.
- **The set is fixed for the day.** It is generated once per day from the unlocks and farm size at that moment. Unlocking something or expanding later in the day does not change today's contracts.
- **"Same contracts for every player"** strictly means the same date + the same unlocks + the same farm size. Players with different progress get different items and amounts, but the random draws are aligned per slot.
- **Values are my tuning** (tables above): early Hay/Wood contracts on tiny farms pay only 1 Gold, and the budgets are generous.
- **Contract stats live in `records`**, so they travel with export and survive a rejected farm. Import replaces them, and Reset Save clears them, like the other records.
- **Expired-contract count:** I did not add an "expired" total to the stats; the brief only asked for completed and bonus.
