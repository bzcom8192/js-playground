// Seeded dinosaurs (v5 phase 2): the walk and the apples come from the
// dinosaur's own seed — on every machine, at every frame rate, across a save.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import * as R from "./records.js";
import { DEMO_DINO_SEED, WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { createDemoGame } from "./demo.js";
import { mulberry32, mulberry32At } from "./maze.js";

function farm(n = 8, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, Dinosaurs: 1, ...unlocks });
  s.items.Gold = 1000;
  return s;
}
/** A farm whose dinosaur hatched on (x, y) with `seed`. */
function hatched(seed, { n = 8, x = 4, y = 4 } = {}) {
  const s = farm(n);
  s.drone.x = x;
  s.drone.y = y;
  s.pendingDinoSeed = seed;
  assert.equal(W.plant(s, "Dinosaur", () => 0.5).ok, true);
  return s;
}
const apples = (s) => s.tiles.map((t, i) => (t.entity?.type === "Apple" ? i : -1)).filter((i) => i >= 0);
const look = (s) => JSON.stringify([s.dino.body, s.dino.dir, apples(s)]);

/** Run `code` headless on `s` with world rng `rng` → everything that happened, step by step. */
async function play(s, code, { rng = Math.random, frame = 100, maxMs = 120_000 } = {}) {
  let t = 0;
  const trace = [];
  const logs = [];
  let last = "";
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e.text),
    now: () => t,
    rng,
    mathRandom: mulberry32(1),
    wallClock: () => 7,
    yieldFn: () => new Promise((r) => setImmediate(r)),
    sleep: async (ms) => {
      for (let left = ms; left > 0; ) {
        const step = Math.min(frame, left);
        W.tick(s, step / 1000, rng);
        t += step;
        left -= step;
        const now = s.dino ? look(s) : "none";
        if (now !== last) trace.push((last = now));
      }
      if (t >= maxMs) rt.stop();
      await new Promise((r) => setImmediate(r));
    },
  });
  await rt.run(code);
  return { trace, logs, bone: s.items.Bone, record: s.records.dino };
}

const PROGRAM = `plant(Entities.Dinosaur);
for (let i = 0; i < 40; i++) spin_in_place();
const n = get_world_size();
for (let x = 0; x < n; x++) {
  for (let y = 0; y < n; y++) {
    if (get_entity_type() === Entities.Dinosaur) harvest();
    move(North);
  }
  move(East);
}
`;

test("mulberry32At(seed, n) is draw n of the mulberry32(seed) stream", () => {
  for (const seed of [0, 1, 4188, 0x7fffffff, 0xffffffff]) {
    const next = mulberry32(seed);
    for (let n = 0; n < 500; n++) assert.equal(mulberry32At(seed, n), next(), `seed ${seed} draw ${n}`);
  }
});

test("same seed + same program → identical path, apples and Bone; other seeds diverge", async () => {
  const run = (seed, rng) => {
    const s = farm(8);
    s.pendingDinoSeed = seed;
    return play(s, PROGRAM, { rng });
  };
  const a = await run(123, mulberry32(1));
  const b = await run(123, mulberry32(2)); // the world's own randomness doesn't matter
  const c = await run(123, Math.random);
  assert.ok(a.trace.length > 80, `${a.trace.length} different moments`);
  assert.ok(a.trace.some((l) => JSON.parse(l)[2]?.length > 0), "apples spawned");
  assert.ok(a.bone > 0);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.deepEqual([a.record.seed, a.record.size, a.record.sx, a.record.sy], [123, 8, 0, 0]);
  assert.ok(a.logs.includes("Dinosaur seed: 123 (replay)"));
  const paths = new Set([a.trace.join()]);
  for (const seed of [0, 1, 124, 999, 0xffffffff]) {
    const r = await run(seed, mulberry32(1));
    assert.ok(!paths.has(r.trace.join()), `seed ${seed} walks its own way`);
    paths.add(r.trace.join());
  }
});

test("the record's seed replays the run that set it", async () => {
  // A normal hatch: the seed is drawn, logged and stored with the record…
  const s = farm(8);
  const first = await play(s, PROGRAM, { rng: mulberry32(31) });
  const { seed, sx, sy } = s.records.dino;
  assert.ok(first.logs.includes(`Dinosaur seed: ${seed}`));
  assert.deepEqual([sx, sy], [0, 0]);
  // …and queued on another farm (Records window) it gives the very same run.
  const again = farm(8);
  again.pendingDinoSeed = seed;
  const second = await play(again, PROGRAM, { rng: mulberry32(99) });
  assert.deepEqual(second.trace, first.trace);
  assert.deepEqual(second.record, first.record);
});

test("the walk does not depend on how time is cut into frames", () => {
  const walk = (frames) => {
    const s = hatched(77, { n: 12, x: 6, y: 6 });
    let t = 0; // ms
    const seen = [];
    for (let i = 0; t < 60_000; i++) {
      const dt = Math.min(frames(i), 60_000 - t);
      const before = Math.floor(t / 6000);
      // (look every 6 s: cut the frame there)
      const cut = Math.min(dt, (before + 1) * 6000 - t);
      W.tick(s, cut / 1000);
      t += cut;
      if (t % 6000 === 0) seen.push(look(s));
    }
    return seen;
  };
  const base = walk(() => 100);
  assert.equal(base.length, 10);
  assert.ok(new Set(base).size > 3);
  for (const [name, frames] of [["16 ms", () => 16], ["33 ms", () => 33], ["70 ms", () => 70], ["1 s", () => 1000], ["2 s", () => 2000], ["6 s", () => 6000], ["uneven", (i) => 1 + ((i * 7919) % 400)]]) {
    assert.deepEqual(walk(frames), base, name);
  }
});

test("a seed is drawn per egg; a pending seed is used once; every farm draw comes from it", () => {
  const s = farm(8);
  assert.equal(s.pendingDinoSeed, null);
  assert.equal(W.plant(s, "Dinosaur", () => 0.25).ok, true);
  assert.deepEqual([s.dino.seed, s.dino.draws, s.dino.start], [2 ** 30, 0, { x: 0, y: 0 }]);
  W.harvest(s);
  s.pendingDinoSeed = 5;
  s.pendingSeed = 6; // the maze's: untouched
  W.plant(s, "Dinosaur", () => 0.25);
  assert.equal(s.dino.seed, 5);
  assert.deepEqual([s.pendingDinoSeed, s.pendingSeed], [null, 6]);
  for (let i = 0; i < 300; i++) W.tick(s, 0.1, () => assert.fail("the dinosaur must not use the world's randomness"));
  assert.ok(s.dino.draws > 20);
  // A failed plant keeps the pending seed.
  s.pendingDinoSeed = 8;
  assert.equal(W.plant(s, "Dinosaur").ok, false);
  assert.equal(s.pendingDinoSeed, 8);
});

test("save/load mid-walk: the stream goes on where it was; the pending seed is saved", () => {
  const s = hatched(2026);
  s.pendingDinoSeed = 41;
  for (let i = 0; i < 137; i++) W.tick(s, 0.07);
  const data = JSON.parse(JSON.stringify(W.serialize(s)));
  assert.deepEqual([data.dino.seed, data.dino.n, data.dino.sx, data.dino.sy], [2026, s.dino.draws, 4, 4]);
  const t = W.deserialize(data);
  assert.deepEqual(t.dino, s.dino);
  assert.equal(t.pendingDinoSeed, 41);
  for (let i = 0; i < 400; i++) {
    W.tick(s, 0.07);
    W.tick(t, 0.07);
    assert.equal(look(t), look(s));
  }
  assert.ok(s.dino.draws > data.dino.n);
});

test("old save: a live dinosaur without a seed gets one on load and keeps it", () => {
  const s = hatched(3);
  for (let i = 0; i < 50; i++) W.tick(s, 0.1);
  const old = JSON.parse(JSON.stringify(W.serialize(s)));
  for (const k of ["seed", "n", "sx", "sy"]) delete old.dino[k];
  delete old.pendingDinoSeed;
  const a = W.deserialize(old);
  assert.deepEqual(a.dino.body, s.dino.body);
  assert.ok(Number.isInteger(a.dino.seed) && a.dino.seed >= 0 && a.dino.seed <= 0xffffffff);
  assert.deepEqual([a.dino.draws, a.dino.start, a.pendingDinoSeed], [0, null, null]);
  // Saved again it is an ordinary seeded dinosaur.
  const b = W.deserialize(JSON.parse(JSON.stringify(W.serialize(a))));
  assert.deepEqual(b.dino, a.dino);
  for (let i = 0; i < 100; i++) {
    W.tick(a, 0.1);
    W.tick(b, 0.1);
  }
  assert.equal(look(b), look(a));
  // Its record has the seed but no hatching tile.
  const h = a.dino.body[0];
  Object.assign(a.drone, h);
  const [, events] = W.withEvents(() => W.harvest(a));
  assert.deepEqual([events[0].seed, events[0].start], [b.dino.seed, null]);
  // Damaged seed data: treated as none; a damaged draw count starts the stream over.
  for (const seed of [-1, 2 ** 32, 1.5, "x", {}]) {
    const d = W.deserialize({ ...old, dino: { ...old.dino, seed, n: 5, sx: 1, sy: 1 } });
    assert.deepEqual([Number.isInteger(d.dino.seed), d.dino.draws, d.dino.start], [true, 0, null], String(seed));
  }
  for (const n of [-1, 1.5, "x", null]) assert.equal(W.deserialize({ ...old, dino: { ...old.dino, seed: 4, n } }).dino.draws, 0);
});

test("demo farm: every dinosaur has the fixed seed and nothing of it is persisted", async () => {
  const runDemo = async () => {
    const d = createDemoGame();
    W.clearFarm(d);
    d.pendingDinoSeed = 999; // (the page leaves the demo before it can set one)
    return { d, r: await play(d, `${PROGRAM}clear(); plant(Entities.Dinosaur); print("again");`, { rng: Math.random }) };
  };
  const a = await runDemo();
  const b = await runDemo();
  assert.equal(a.d.dino.seed, DEMO_DINO_SEED);
  assert.equal(a.d.pendingDinoSeed, 999, "the fixed seed wins and uses nothing up");
  assert.equal(a.r.logs.filter((l) => l === `Dinosaur seed: ${DEMO_DINO_SEED}`).length, 2);
  assert.deepEqual(b.r.trace, a.r.trace);
  const data = JSON.parse(JSON.stringify(W.serialize(a.d)));
  assert.equal(data.dino, null);
  assert.equal(data.dinoSeed, undefined);
  assert.deepEqual(a.d.records, R.emptyRecords());
  const back = W.deserialize(data);
  assert.equal(back.dino, null);
  assert.equal(back.dinoSeed, null, "a loaded save never has the fixed seed");
  assert.ok(back.tiles.every((t) => t.entity?.type !== "Dinosaur" && t.entity?.type !== "Apple"));
});
