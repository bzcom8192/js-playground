// Semicolon Acres — save-level records (pure, no DOM). v3 phase 1.
//
// Since BRIEF22 (Mazes and Dinosaurs removed) the only records are the daily
// contract totals; the maze attempts, the best dinosaur harvest and the replay
// seeds went with their features. Records live in the world save
// (`state.records`, serialized by world.js) and so travel with Save Data
// export / import. A demo farm (`state.demo`) never writes records.
//
// Shape:
//   records = { contracts: { completed, bonus: { Pumpkin, Cactus } } } — daily
//     contracts delivered in total and the reward earned per reward item (see
//     contracts.js). Older saves have none and load with zeros; a save from
//     before BRIEF22 also had `mazes` and `dino` (dropped on load) and its
//     bonus was counted in Gold and Bone (dropped too: contracts pay neither).

/** The contract reward items (= contracts.js REWARD_ITEMS; asserted in the tests). */
export const CONTRACT_BONUS_ITEMS = ["Pumpkin", "Cactus"];
const emptyContractStats = () => ({ completed: 0, bonus: Object.fromEntries(CONTRACT_BONUS_ITEMS.map((k) => [k, 0])) });

export const emptyRecords = () => ({ contracts: emptyContractStats() });

/** Records are written only to a real (non-demo) farm. */
export const canRecord = (state) => !!state && !state.demo;

function ensure(state) {
  if (!state.records || typeof state.records !== "object") state.records = emptyRecords();
  return state.records;
}

/** A delivered contract: +1 completed, + its reward to the bonus total. */
export function addContractDone(state, contract) {
  if (!canRecord(state)) return { recorded: false };
  const recs = ensure(state);
  if (!recs.contracts || typeof recs.contracts !== "object") recs.contracts = emptyContractStats();
  const st = recs.contracts;
  st.bonus ||= {};
  st.completed = (st.completed || 0) + 1;
  st.bonus[contract.rewardItem] = (st.bonus[contract.rewardItem] || 0) + contract.reward;
  return { recorded: true };
}

// ---------- persistence ----------

const nonNeg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/** Clean records from a save; anything missing, damaged or removed → empty. */
export function sanitizeRecords(raw) {
  const out = emptyRecords();
  const c = raw && typeof raw === "object" ? raw.contracts : null;
  if (c && typeof c === "object") {
    out.contracts.completed = nonNeg(c.completed) ?? 0;
    for (const k of CONTRACT_BONUS_ITEMS) out.contracts.bonus[k] = nonNeg(c.bonus?.[k]) ?? 0;
  }
  return out;
}

/** Program size of a file: non-empty lines and characters. */
export function programSize(code) {
  const text = String(code ?? "");
  return { lines: text.split("\n").filter((l) => l.trim()).length, chars: text.length };
}
