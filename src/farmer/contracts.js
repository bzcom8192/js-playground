// Semicolon Acres — daily seeded contracts (pure, no DOM). v3 phase 2.
//
// A contract is a delivery order: "deliver N of item X within T ticks → earn a
// bonus". Every day brings CONTRACTS_PER_DAY of them, generated from a DAILY
// seed (a hash of the local date "YYYY-MM-DD") with mulberry32 from maze.js, so
// every player with the same unlocks and farm size gets exactly the same
// contracts on the same day, on any machine. Nothing is random per player.
//
// State (saved in `farmer_save_v1` as `contracts`, never for a demo farm):
//   state.contracts = { date: "YYYY-MM-DD", contracts: Contract[] } | null
//   Contract = { id, item, amount, rewardItem, reward, deadlineTick, status }
//     id: "YYYY-MM-DD#n" (n = 1…3), unique across days.
//     status: "active" | "done" | "expired".
//   state.clock: the farm clock in ticks (see below); deadlineTick is on it.
//
// The farm clock counts the same ticks as get_tick_count() (actions 200,
// flips 600, senses 1, before Speed / Power): every run adds its run clock
// (the longest drone timeline, see runtime.js), so it only moves while a
// program runs and is the same on every machine for the same program.
//
// Generation (see generateContracts): one rng = mulberry32(dailySeed(date));
// every slot draws exactly two numbers (item pick, amount jitter) whatever the
// pool, so the same date + unlocks + farm size → the same set.
//   pool   = items you can already produce (CONTRACT_ITEMS[item].needs)
//   amount = max(MIN_AMOUNT, nice(perTile × size² × (0.75 + 0.5 r)))
//   reward = max(1, round(amount × value × BONUS_FACTOR)) of the rewardItem
//   budget = ceil1000(BUDGET_BASE + amount × TICKS_PER_UNIT × (tier + 1))
//   deadlineTick = clock at generation + budget

import { mulberry32 } from "./maze.js";
import { canRecord, addContractDone } from "./records.js";

export const CONTRACTS_PER_DAY = 3;
export const BONUS_FACTOR = 1.5;
export const MIN_AMOUNT = 5;
export const BUDGET_BASE = 20_000;
export const TICKS_PER_UNIT = 400;
export const STATUSES = ["active", "done", "expired"];
export const REWARD_ITEMS = ["Gold", "Bone"];

/**
 * Contract item table, lowest tier first.
 *  needs:   the unlock that lets you produce it (null = always: Hay / Wood).
 *  perTile: amount per farm tile (before jitter).
 *  reward / value: the reward item and one unit's worth in it (×1.5 bonus).
 * Gold is the contract currency; Gold and Bone contracts (top tiers) pay Bone.
 */
export const CONTRACT_ITEMS = {
  Hay: { tier: 0, needs: null, perTile: 4, reward: "Gold", value: 0.02 },
  Wood: { tier: 0, needs: null, perTile: 3, reward: "Gold", value: 0.03 },
  Carrot: { tier: 1, needs: "Carrots", perTile: 2, reward: "Gold", value: 0.1 },
  Pumpkin: { tier: 2, needs: "Pumpkins", perTile: 2, reward: "Gold", value: 0.25 },
  // v3 phase 5: Rice sits between Pumpkin and Cactus (tier 2.5: budget ×3.5).
  // v4 phase 2: value 1 → 1.5 Gold per Rice delivered (was 0.375 ≈ 0.56 Gold,
  // far below the 2 Gold of trade(Items.Rice)); its tier / budget unchanged.
  Rice: { tier: 2.5, needs: "Rice", perTile: 2, reward: "Gold", value: 1 },
  Cactus: { tier: 3, needs: "Cactus", perTile: 2, reward: "Gold", value: 0.5 },
  Gold: { tier: 4, needs: "Mazes", perTile: 1, reward: "Bone", value: 0.5 },
  Bone: { tier: 5, needs: "Dinosaurs", perTile: 1, reward: "Bone", value: 1 },
};
const ITEMS = Object.keys(CONTRACT_ITEMS);

// ---------- seed ----------

const pad = (n) => String(n).padStart(2, "0");

/** The local date as "YYYY-MM-DD" (contracts change at local midnight). */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const isDateString = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** FNV-1a (32-bit) of the date string → the day's seed. */
export function dailySeed(date) {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------- generation ----------

const unlocked = (state, id) => !id || (state.unlocks?.[id] || 0) >= 1;

/** Items the farm can produce right now (contract pool), lowest tier first. */
export const contractPool = (state) => ITEMS.filter((item) => unlocked(state, CONTRACT_ITEMS[item].needs));

/** Round to a "nice" number: exact below 20, then to 5 / 10 / 50. */
export function niceRound(n) {
  const step = n < 20 ? 1 : n < 200 ? 5 : n < 2000 ? 10 : 50;
  return Math.max(step, Math.round(n / step) * step);
}

export const contractAmount = (item, size, r) =>
  Math.max(MIN_AMOUNT, niceRound(CONTRACT_ITEMS[item].perTile * size * size * (0.75 + 0.5 * r)));

export const contractReward = (item, amount) => Math.max(1, Math.round(amount * CONTRACT_ITEMS[item].value * BONUS_FACTOR));

export const contractBudget = (item, amount) =>
  Math.ceil((BUDGET_BASE + amount * TICKS_PER_UNIT * (CONTRACT_ITEMS[item].tier + 1)) / 1000) * 1000;

/** The day's contracts for this farm (pure: depends on date, unlocks, size, clock). */
export function generateContracts(state, date) {
  const rng = mulberry32(dailySeed(date));
  const pool = contractPool(state);
  const size = Math.max(1, Number(state.size) || 1);
  const clock = farmClock(state);
  const used = new Set();
  const picks = [];
  for (let slot = 0; slot < CONTRACTS_PER_DAY; slot++) {
    const rItem = rng();
    const rAmount = rng();
    // Distinct items while the pool lasts: step forward to the next unused one.
    let i = Math.min(pool.length - 1, Math.floor(rItem * pool.length));
    if (used.size < pool.length) while (used.has(pool[i])) i = (i + 1) % pool.length;
    const item = pool[i];
    used.add(item);
    picks.push({ item, amount: contractAmount(item, size, rAmount) });
  }
  // Easiest first (stable for equal tiers), then numbered.
  picks.sort((a, b) => CONTRACT_ITEMS[a.item].tier - CONTRACT_ITEMS[b.item].tier);
  return picks.map(({ item, amount }, k) => ({
    id: `${date}#${k + 1}`,
    item,
    amount,
    rewardItem: CONTRACT_ITEMS[item].reward,
    reward: contractReward(item, amount),
    deadlineTick: clock + contractBudget(item, amount),
    status: "active",
  }));
}

// ---------- state ----------

export const farmClock = (state) => {
  const c = Number(state?.clock);
  return Number.isFinite(c) && c >= 0 ? c : 0;
};

const list = (state) => (Array.isArray(state?.contracts?.contracts) ? state.contracts.contracts : []);

/** Mark every active contract whose deadline has passed as expired → those contracts. */
export function expireContracts(state) {
  const out = [];
  const clock = farmClock(state);
  for (const c of list(state)) {
    if (c.status === "active" && clock > c.deadlineTick) {
      c.status = "expired";
      out.push(c);
    }
  }
  return out;
}

/**
 * Make sure `state.contracts` holds `date`'s contracts. On a new day, the old
 * day's active contracts expire and a fresh set is generated.
 * → { generated, from (previous date or null), expired: Contract[] }
 */
export function ensureContracts(state, date) {
  const cur = state.contracts;
  if (cur && cur.date === date && Array.isArray(cur.contracts)) {
    return { generated: false, from: null, expired: expireContracts(state) };
  }
  const expired = [];
  for (const c of list(state)) {
    if (c.status === "active") {
      c.status = "expired";
      expired.push(c);
    }
  }
  const from = cur && isDateString(cur.date) ? cur.date : null;
  state.contracts = { date, contracts: generateContracts(state, date) };
  return { generated: true, from, expired };
}

export const findContract = (state, id) => list(state).find((c) => c.id === id) ?? null;

export const ticksLeft = (state, c) => (c.status === "active" ? Math.max(0, c.deadlineTick - farmClock(state)) : 0);

/** Active, in time and enough items in the inventory. */
export const isDeliverable = (state, c) =>
  !!c && c.status === "active" && farmClock(state) <= c.deadlineTick && (state.items?.[c.item] || 0) >= c.amount;

/**
 * deliver_contract(id) and the Deliver button: consume the items, pay the
 * reward, mark it done and count it in the save-level stats.
 * → { ok: true, contract } or { ok: false, msg }
 */
export function deliverContract(state, id) {
  const c = findContract(state, typeof id === "string" ? id : String(id));
  if (!c) return { ok: false, msg: `no contract with id ${JSON.stringify(id ?? null)} today — see get_contracts()` };
  if (c.status === "active" && farmClock(state) > c.deadlineTick) c.status = "expired";
  if (c.status === "done") return { ok: false, msg: `contract ${c.id} is already delivered` };
  if (c.status === "expired") return { ok: false, msg: `contract ${c.id} has expired` };
  if ((state.items[c.item] || 0) < c.amount) return { ok: false, msg: `contract ${c.id} needs ${c.amount} ${c.item}` };
  state.items[c.item] -= c.amount;
  state.items[c.rewardItem] = (state.items[c.rewardItem] || 0) + c.reward;
  c.status = "done";
  if (canRecord(state)) addContractDone(state, c);
  return { ok: true, contract: c };
}

/** get_contracts(): a plain snapshot programs can plan with. */
export const contractSnapshot = (state) =>
  list(state).map((c) => ({
    id: c.id,
    item: c.item,
    amount: c.amount,
    reward: c.reward,
    rewardItem: c.rewardItem,
    ticksLeft: ticksLeft(state, c),
    status: c.status,
  }));

// ---------- log lines ----------

const fmt = (n) => Number(n).toLocaleString("en-US");
export const contractText = (c) => `${fmt(c.amount)} ${c.item} → ${fmt(c.reward)} ${c.rewardItem}`;
export const deliveredText = (c) => `📜 Contract delivered: ${contractText(c)}`;
export const expiredText = (c) => `📜 Contract expired: ${contractText(c)}`;
/** Log lines for an ensureContracts result (nothing for the very first set). */
export function rolloverLines(res) {
  const out = [];
  if (res.generated && res.from) {
    const n = res.expired.length;
    out.push(`📜 New contracts for today${n ? ` — ${n} unfinished contract${n === 1 ? "" : "s"} from ${res.from} expired` : ""}.`);
  } else if (!res.generated) {
    for (const c of res.expired) out.push(expiredText(c));
  }
  return out;
}

// ---------- persistence ----------

const nonNeg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

function cleanContract(c) {
  if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id || c.id.length > 40) return null;
  if (!CONTRACT_ITEMS[c.item] || !REWARD_ITEMS.includes(c.rewardItem) || !STATUSES.includes(c.status)) return null;
  const amount = nonNeg(c.amount);
  const reward = nonNeg(c.reward);
  const deadlineTick = nonNeg(c.deadlineTick);
  if (!amount || !reward || deadlineTick === null) return null;
  return { id: c.id, item: c.item, amount, rewardItem: c.rewardItem, reward, deadlineTick, status: c.status };
}

/** Clean contracts from a save → { date, contracts } or null (→ generated afresh). */
export function sanitizeContracts(raw) {
  if (!raw || typeof raw !== "object" || !isDateString(raw.date) || !Array.isArray(raw.contracts)) return null;
  const seen = new Set();
  const contracts = [];
  for (const c of raw.contracts.slice(0, 10)) {
    const clean = cleanContract(c);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      contracts.push(clean);
    }
  }
  return contracts.length ? { date: raw.date, contracts } : null;
}
