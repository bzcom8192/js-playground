// v3 phase 2: daily seeded contracts — generation, delivery, deadlines, day
// rollover, persistence, export / import, demo mode.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as C from "./contracts.js";
import * as R from "./records.js";
import { UNLOCKS, WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { buildExport, parseImport } from "./saveData.js";
import { createDemoGame } from "./demo.js";
import { ACTIONS } from "./transform.js";
import { FARMER_GLOBALS, FARMER_LIB } from "./farmerLib.js";

const DAY = "2026-11-21";

/** n×n farm (Expand level to match) with the given unlocks. */
function farm(n = 6, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Plant: 1, Senses: 1, ...unlocks });
  return s;
}

const ALL = Object.fromEntries(UNLOCKS.map((u) => [u.id, 1]));

function runtime(s, opts = {}) {
  const logs = [];
  let t = 0;
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
    wallClock: () => 1_700_000_000_000,
    today: () => DAY,
    ...opts,
  });
  return { rt, logs };
}

const days = (n, from = Date.UTC(2026, 0, 1)) =>
  Array.from({ length: n }, (_, i) => new Date(from + i * 86_400_000).toISOString().slice(0, 10));

// ---------- generation ----------

test("same date → the identical contract set on two separate farms (and after a reload)", () => {
  const a = farm(8, ALL);
  const b = farm(8, ALL);
  C.ensureContracts(a, DAY);
  C.ensureContracts(b, DAY);
  assert.equal(a.contracts.contracts.length, C.CONTRACTS_PER_DAY);
  assert.deepEqual(a.contracts, b.contracts);
  assert.equal(a.contracts.date, DAY);
  assert.deepEqual(C.generateContracts(a, DAY), C.generateContracts(b, DAY), "generation is a pure function of the date");
  const again = W.deserialize(JSON.parse(JSON.stringify(W.serialize(a))));
  assert.deepEqual(again.contracts, a.contracts);
  // Same seed from the date string alone.
  assert.equal(C.dailySeed(DAY), C.dailySeed("2026-11-21"));
  assert.notEqual(C.dailySeed(DAY), C.dailySeed("2026-11-22"));
  // Different days give different sets (at least most of the time).
  const sets = new Set(days(30).map((d) => JSON.stringify(C.generateContracts(a, d).map((c) => [c.item, c.amount]))));
  assert.ok(sets.size >= 20, `only ${sets.size} distinct sets in 30 days`);
});

test("shape: ids, distinct items, reward ≈ amount × value × 1.5, deadline = clock + budget", () => {
  const s = farm(12, ALL);
  s.clock = 123_456;
  for (const d of days(40)) {
    const list = C.generateContracts(s, d);
    assert.deepEqual(list.map((c) => c.id), [`${d}#1`, `${d}#2`, `${d}#3`]);
    assert.equal(new Set(list.map((c) => c.item)).size, 3, "distinct while the pool lasts");
    for (const c of list) {
      const info = C.CONTRACT_ITEMS[c.item];
      assert.equal(c.status, "active");
      assert.equal(c.rewardItem, info.reward);
      assert.equal(c.reward, Math.max(1, Math.round(c.amount * info.value * 1.5)));
      const per = info.perTile * 144;
      assert.ok(c.amount >= per * 0.75 * 0.9 && c.amount <= per * 1.25 * 1.1, `${c.item} ${c.amount}`);
      const budget = c.deadlineTick - s.clock;
      assert.equal(budget, Math.ceil((20_000 + c.amount * 400 * (info.tier + 1)) / 1000) * 1000);
      assert.equal(budget % 1000, 0);
    }
    const tiers = list.map((c) => C.CONTRACT_ITEMS[c.item].tier);
    assert.deepEqual(tiers, [...tiers].sort((x, y) => x - y), "easiest first");
  }
  // Amount scales with farm size.
  const small = C.generateContracts(farm(3, ALL), DAY);
  const big = C.generateContracts(farm(12, ALL), DAY);
  assert.deepEqual(small.map((c) => c.item), big.map((c) => c.item), "same picks, only sizes differ");
  for (let i = 0; i < 3; i++) assert.ok(big[i].amount > small[i].amount);
  assert.ok(C.generateContracts(farm(1), DAY).every((c) => c.amount >= C.MIN_AMOUNT && c.reward >= 1));
});

test("pool respects unlocks: Hay/Wood always, each other item only with its unlock", () => {
  const cases = [
    [{}, ["Hay", "Wood"]],
    [{ Carrots: 1 }, ["Hay", "Wood", "Carrot"]],
    [{ Carrots: 1, Pumpkins: 1 }, ["Hay", "Wood", "Carrot", "Pumpkin"]],
    [{ Cactus: 1 }, ["Hay", "Wood", "Cactus"]],
    [{ Mazes: 1 }, ["Hay", "Wood", "Gold"]],
    [{ Dinosaurs: 1 }, ["Hay", "Wood", "Bone"]],
    [ALL, ["Hay", "Wood", "Carrot", "Pumpkin", "Rice", "Cactus", "Gold", "Bone"]], // Rice: v3 phase 5
  ];
  for (const [unlocks, pool] of cases) {
    const s = farm(6, unlocks);
    assert.deepEqual(C.contractPool(s), pool, JSON.stringify(unlocks));
    const seen = new Set();
    for (const d of days(60)) for (const c of C.generateContracts(s, d)) seen.add(c.item);
    assert.deepEqual([...seen].sort(), [...pool].sort(), `over 60 days every pool item and nothing else (${JSON.stringify(unlocks)})`);
  }
  // A fresh farm: only Hay / Wood, paid in Gold; a 2-item pool repeats one.
  const fresh = C.generateContracts(W.createGame(), DAY);
  assert.ok(fresh.every((c) => ["Hay", "Wood"].includes(c.item) && c.rewardItem === "Gold"));
  // Top tiers (Gold, Bone) pay Bone; everything else pays Gold.
  for (const [item, info] of Object.entries(C.CONTRACT_ITEMS)) {
    assert.equal(info.reward, info.tier >= 4 ? "Bone" : "Gold", item);
  }
});

// ---------- delivery ----------

test("deliver happy path: items consumed, reward paid, status done, stats counted", () => {
  const s = farm(6, ALL);
  C.ensureContracts(s, DAY);
  const c = s.contracts.contracts[0];
  s.items[c.item] = c.amount + 7;
  const before = s.items[c.rewardItem];
  assert.equal(C.isDeliverable(s, c), true);
  const res = C.deliverContract(s, c.id);
  assert.equal(res.ok, true);
  assert.equal(s.items[c.item], 7);
  assert.equal(s.items[c.rewardItem], before + c.reward);
  assert.equal(c.status, "done");
  assert.equal(s.records.contracts.completed, 1);
  assert.equal(s.records.contracts.bonus[c.rewardItem], c.reward);
  assert.match(C.deliveredText(c), /^📜 Contract delivered: [\d,]+ \w+ → [\d,]+ (Gold|Bone)$/);
  assert.equal(C.deliverContract(s, c.id).ok, false, "only once");
  assert.equal(s.records.contracts.completed, 1);
});

test("deliver fails when short / expired / unknown id — and changes nothing", () => {
  const s = farm(6, ALL);
  C.ensureContracts(s, DAY);
  const [a, b] = s.contracts.contracts;
  s.items[a.item] = a.amount - 1;
  const snap = JSON.stringify({ items: s.items, contracts: s.contracts, records: s.records });
  assert.match(C.deliverContract(s, a.id).msg, /needs/);
  assert.match(C.deliverContract(s, "1999-01-01#1").msg, /no contract/);
  assert.equal(C.deliverContract(s, undefined).ok, false);
  assert.equal(C.deliverContract(s, 1).ok, false);
  assert.equal(JSON.stringify({ items: s.items, contracts: s.contracts, records: s.records }), snap);
  // Expired: past the deadline even with enough items.
  s.items[b.item] = b.amount * 2;
  s.clock = b.deadlineTick + 1;
  assert.equal(C.isDeliverable(s, b), false);
  assert.match(C.deliverContract(s, b.id).msg, /expired/);
  assert.equal(b.status, "expired");
  assert.equal(s.items[b.item], b.amount * 2);
  // At the deadline tick itself it is still deliverable.
  const t = farm(6, ALL);
  C.ensureContracts(t, DAY);
  const c = t.contracts.contracts[2];
  t.items[c.item] = c.amount;
  t.clock = c.deadlineTick;
  assert.equal(C.deliverContract(t, c.id).ok, true);
});

test("API: get_contracts() snapshot + deliver_contract(id) from a program (ops, ticks, log)", async () => {
  const s = farm(6, ALL);
  for (const k of Object.keys(s.items)) s.items[k] = 100_000;
  const { rt, logs } = runtime(s);
  const code = `
    const list = get_contracts();
    print(JSON.stringify(list[0]));
    let n = 0;
    for (const c of list) if (deliver_contract(c.id)) n++;
    print("delivered", n, deliver_contract(list[0].id), deliver_contract("nope"));
    print(get_contracts().map((c) => c.status).join(","));
  `;
  assert.equal(await rt.run(code), "done", JSON.stringify(logs));
  const first = JSON.parse(logs.find((l) => l.kind === "print").text);
  assert.deepEqual(Object.keys(first), ["id", "item", "amount", "reward", "rewardItem", "ticksLeft", "status"]);
  assert.equal(first.id, `${DAY}#1`);
  assert.equal(first.status, "active");
  assert.equal(first.ticksLeft, s.contracts.contracts[0].deadlineTick - 1, "1 tick spent by get_contracts itself");
  assert.ok(logs.some((l) => l.text === "delivered 3 false false"));
  assert.ok(logs.some((l) => l.text === "done,done,done"));
  assert.equal(logs.filter((l) => l.text.startsWith("📜 Contract delivered")).length, 3);
  assert.ok(logs.some((l) => l.kind === "warn" && /deliver_contract\(\): no contract/.test(l.text)));
  // ops: 2 × get_contracts + 5 × deliver_contract + 3 × print (+ JSON/map are not API).
  assert.equal(rt.stats().ops, 10);
  assert.equal(rt.stats().ticks, 2 + 5 * 200);
  assert.equal(s.clock, 2 + 5 * 200, "the farm clock follows the run clock");
  assert.equal(s.records.contracts.completed, 3);
  // A snapshot is a copy: changing it does not touch the save.
  const { rt: rt2 } = runtime(s);
  await rt2.run('const l = get_contracts(); l[0].status = "active"; l[0].amount = 0;');
  assert.equal(s.contracts.contracts[0].status, "done");
});

test("API surface: both functions are globals, declared in the .d.ts, deliver_contract is an action", () => {
  assert.ok(FARMER_GLOBALS.get_contracts && FARMER_GLOBALS.deliver_contract);
  assert.match(FARMER_LIB, /declare function get_contracts\(\): Contract\[\];/);
  assert.match(FARMER_LIB, /declare function deliver_contract\(id: string\): boolean;/);
  assert.ok(ACTIONS.includes("deliver_contract"), "auto-awaited like trade()");
  assert.ok(!ACTIONS.includes("get_contracts"), "a sense: instant");
});

// ---------- deadlines ----------

test("deadline expiry while playing: the run clock passes deadlineTick → expired (logged once)", async () => {
  const s = farm(3);
  C.ensureContracts(s, DAY);
  const list = s.contracts.contracts;
  const first = list[0];
  // Run just past the first deadline: moves are 200 ticks each.
  const moves = Math.floor(first.deadlineTick / 200) + 1;
  const { rt, logs } = runtime(s);
  assert.equal(await rt.run(`for (let i = 0; i < ${moves}; i++) move(North);`), "done");
  assert.equal(s.clock, moves * 200);
  assert.equal(first.status, "expired");
  for (const c of list) assert.equal(c.status, s.clock > c.deadlineTick ? "expired" : "active");
  const expiredLogs = logs.filter((l) => l.text.startsWith("📜 Contract expired"));
  assert.equal(expiredLogs.length, list.filter((c) => c.status === "expired").length);
  s.items[first.item] = first.amount;
  assert.equal(C.deliverContract(s, first.id).ok, false);
  // The clock persists across runs (and the save) and keeps counting.
  const { rt: rt2 } = runtime(s);
  await rt2.run("move(North)");
  assert.equal(s.clock, moves * 200 + 200);
  assert.equal(W.deserialize(JSON.parse(JSON.stringify(W.serialize(s)))).clock, s.clock);
});

test("farm clock: multi-drone runs add the run clock (longest timeline), not the sum of drones", async () => {
  const s = farm(4, { Megafarm: 1 });
  C.ensureContracts(s, DAY);
  const { rt } = runtime(s);
  // Drone 0: num_drones + spawn_drone + 3 moves; drone 1 (starts at drone 0's clock): num_drones + 3 moves.
  await rt.run("if (num_drones() === 1) spawn_drone(); for (let i = 0; i < 3; i++) move(North);");
  assert.equal(s.clock, rt.stats().runTicks);
  assert.equal(s.clock, 1 + 200 + 600);
});

// ---------- day rollover ----------

test("day rollover: yesterday's active contracts expire and today's set is generated", () => {
  const s = farm(6, ALL);
  C.ensureContracts(s, "2026-11-20");
  const old = s.contracts.contracts;
  s.items[old[0].item] = old[0].amount;
  C.deliverContract(s, old[0].id);
  // Same day: nothing changes.
  const same = C.ensureContracts(s, "2026-11-20");
  assert.equal(same.generated, false);
  assert.equal(s.contracts.contracts, old);
  // A save from yesterday, loaded today.
  const loaded = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  const res = C.ensureContracts(loaded, DAY);
  assert.equal(res.generated, true);
  assert.equal(res.from, "2026-11-20");
  assert.deepEqual(res.expired.map((c) => c.id), ["2026-11-20#2", "2026-11-20#3"], "the delivered one stays done");
  assert.ok(res.expired.every((c) => c.status === "expired"));
  assert.equal(loaded.contracts.date, DAY);
  assert.deepEqual(loaded.contracts.contracts, C.generateContracts(loaded, DAY));
  assert.deepEqual(C.rolloverLines(res), ["📜 New contracts for today — 2 unfinished contracts from 2026-11-20 expired."]);
  assert.equal(loaded.records.contracts.completed, 1, "stats survive the rollover");
  // Very first set: no log line.
  assert.deepEqual(C.rolloverLines(C.ensureContracts(farm(), DAY)), []);
  // Old ids no longer deliver.
  assert.match(C.deliverContract(loaded, "2026-11-20#2").msg, /no contract/);
});

test("day rollover mid-run: get_contracts() picks up the new day", async () => {
  const s = farm(6);
  let day = "2026-11-20";
  const { rt, logs } = runtime(s, { today: () => day });
  await rt.run("get_contracts()");
  assert.equal(s.contracts.date, "2026-11-20");
  day = DAY;
  await rt.run("print(get_contracts()[0].id)");
  assert.ok(logs.some((l) => l.text === `${DAY}#1`));
  assert.ok(logs.some((l) => l.text.startsWith("📜 New contracts for today — 3 unfinished")));
});

// ---------- persistence ----------

test("save / load round-trip keeps contracts, clock and stats; old saves load without them", () => {
  const s = farm(6, ALL);
  s.clock = 5_000;
  C.ensureContracts(s, DAY);
  const c = s.contracts.contracts[1];
  s.items[c.item] = c.amount;
  C.deliverContract(s, c.id);
  const back = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  assert.deepEqual(back.contracts, s.contracts);
  assert.equal(back.clock, 5_000);
  assert.deepEqual(back.records.contracts, { completed: 1, bonus: { Gold: c.rewardItem === "Gold" ? c.reward : 0, Bone: c.rewardItem === "Bone" ? c.reward : 0 } });
  assert.deepEqual(W.serialize(W.deserialize(W.serialize(back))), W.serialize(back), "stable");
  // Old save (BRIEF9 era): no clock, no contracts, no contract stats.
  const old = W.serialize(s);
  delete old.clock;
  delete old.contracts;
  delete old.records.contracts;
  const o = W.deserialize(old);
  assert.equal(o.clock, 0);
  assert.equal(o.contracts, null);
  assert.deepEqual(o.records.contracts, R.emptyRecords().contracts);
  assert.equal(C.ensureContracts(o, DAY).generated, true);
  // Junk is dropped field by field.
  for (const junk of [5, "x", { date: "today", contracts: [] }, { date: DAY, contracts: [{ id: 1 }] }, { date: DAY, contracts: "no" }]) {
    assert.equal(W.deserialize({ ...W.serialize(s), contracts: junk }).contracts, null, JSON.stringify(junk));
  }
  const mixed = W.deserialize({
    ...W.serialize(s),
    clock: -4,
    contracts: { date: DAY, contracts: [s.contracts.contracts[0], { ...s.contracts.contracts[0] }, { ...s.contracts.contracts[2], status: "lost" }] },
  });
  assert.equal(mixed.clock, 0);
  assert.deepEqual(mixed.contracts.contracts, [s.contracts.contracts[0]], "duplicate id and bad status dropped");
  // Contracts survive when the farm part of a save is rejected (like records).
  const broken = W.deserialize({ ...W.serialize(s), size: 7 });
  assert.deepEqual(broken.contracts, s.contracts);
  assert.equal(broken.records.contracts.completed, 1);
});

test("export / import keeps contracts, the clock and contract stats", () => {
  const s = farm(6, ALL);
  s.clock = 77_000;
  C.ensureContracts(s, DAY);
  const c = s.contracts.contracts[0];
  s.items[c.item] = c.amount;
  C.deliverContract(s, c.id);
  const parsed = parseImport(JSON.stringify(buildExport({ save: W.serialize(s), files: null })));
  assert.equal(parsed.ok, true);
  const loaded = W.deserialize(parsed.save);
  assert.deepEqual(loaded.contracts, s.contracts);
  assert.equal(loaded.clock, 77_000);
  assert.equal(loaded.records.contracts.completed, 1);
  assert.equal(C.ensureContracts(loaded, DAY).generated, false, "same day: the imported contracts stay");
  assert.equal(loaded.contracts.contracts[0].status, "done");
});

test("demo mode: contracts are visible but never persisted, deliveries record nothing", () => {
  const d = createDemoGame();
  C.ensureContracts(d, DAY);
  assert.equal(d.contracts.contracts.length, 3, "visible");
  assert.equal(W.serialize(d).contracts, null, "never persisted");
  const c = d.contracts.contracts.find((x) => d.items[x.item] >= x.amount);
  assert.ok(c, "the demo inventory covers a contract");
  assert.equal(C.deliverContract(d, c.id).ok, true);
  assert.deepEqual(d.records, R.emptyRecords(), "no stats on a demo farm");
  assert.equal(W.serialize(d).contracts, null);
});
