// Engine smoke tests: real player programs (transform + runtime + world) on a
// virtual clock — every drone action advances simulated time and growth.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { Linter } from "eslint-linter-browserify";
import * as W from "./world.js";
import { createRuntime } from "./runtime.js";
import { EXAMPLES, DEFAULT_CODE } from "./examples.js";
import { FARMER_GLOBALS } from "./farmerLib.js";
import { eslintConfig } from "../utils/eslintConfig.js";

// Small deterministic PRNG (mulberry32).
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const immediate = () => new Promise((r) => setImmediate(r));

/** Run `code` against `state` for `seconds` of virtual time. */
async function simulate(state, code, seconds, { uiSpeed = 1 } = {}) {
  let t = 0;
  const rng = seeded(42);
  const logs = [];
  const statuses = [];
  const rt = createRuntime({
    getState: () => state,
    onLog: (e) => logs.push(e),
    onStatus: (s) => statuses.push(s),
    getUiSpeed: () => uiSpeed,
    now: () => t,
    rng,
    yieldFn: immediate,
    sleep: async (ms) => {
      // advance the world in ≤100 ms steps, like the page's game loop
      let left = ms;
      while (left > 0) {
        const step = Math.min(100, left);
        W.tick(state, step / 1000, rng);
        t += step;
        left -= step;
      }
      await immediate();
    },
  });
  const done = rt.run(code);
  let finished = null;
  done.then((r) => (finished = r));
  while (t < seconds * 1000 && finished === null) await immediate();
  rt.stop();
  await immediate();
  return { logs, statuses, finished, stats: rt.stats(), t };
}

const example = (id) => EXAMPLES.find((e) => e.id === id).code;
const unlock = (s, ...ids) => ids.forEach((id) => assert.equal(W.buyUnlock(s, id).ok, true, id));
const richGame = () => {
  const s = W.createGame();
  for (const k of Object.keys(s.items)) s.items[k] = 100_000;
  return s;
};

test("default starter program farms hay from minute zero", async () => {
  const s = W.createGame();
  const r = await simulate(s, DEFAULT_CODE, 30);
  assert.ok(s.items.Hay >= 15, `hay = ${s.items.Hay}`);
  assert.deepEqual(r.statuses, ["running", "stopped"]);
  assert.ok(r.stats.actions > 50);
  assert.ok(s.drone.flips > 20);
});

test("snake example covers a 3×3 farm", async () => {
  const s = richGame();
  unlock(s, "Expand", "Expand");
  s.items.Hay = 0;
  await simulate(s, example("snake"), 20);
  assert.ok(s.items.Hay >= 30, `hay = ${s.items.Hay}`);
});

test("bushes example produces wood", async () => {
  const s = richGame();
  unlock(s, "Plant", "Senses", "Expand", "Expand");
  s.items.Wood = 0;
  await simulate(s, example("bushes"), 30);
  assert.ok(s.items.Wood >= 9, `wood = ${s.items.Wood}`);
});

test("carrot example tills, pays seeds and harvests carrots", async () => {
  const s = richGame();
  unlock(s, "Plant", "Senses", "Carrots", "Expand", "Expand");
  s.items.Carrot = 0;
  const wood = s.items.Wood;
  await simulate(s, example("carrots"), 40);
  assert.ok(s.items.Carrot >= 9, `carrots = ${s.items.Carrot}`);
  assert.ok(s.items.Wood < wood, "seed cost deducted");
  assert.ok(s.tiles.every((t) => t.ground === "Soil"));
});

test("pumpkin example harvests a full 3×3 square (27 per harvest)", async () => {
  const s = richGame();
  unlock(s, "Plant", "Senses", "Carrots", "Pumpkins", "Expand", "Expand");
  s.items.Pumpkin = 0;
  const r = await simulate(s, example("pumpkins"), 60);
  assert.ok(s.items.Pumpkin >= 27, `pumpkins = ${s.items.Pumpkin}`);
  assert.ok(r.logs.some((l) => l.kind === "print" && l.text.startsWith("Pumpkins:")));
});

test("cactus example sorts the farm and earns n² (81 on 3×3)", async () => {
  const s = richGame();
  unlock(s, "Plant", "Senses", "Carrots", "Pumpkins", "Cactus", "Expand", "Expand");
  s.items.Cactus = 0;
  const r = await simulate(s, example("cactus"), 120);
  const first = r.logs.find((l) => l.text.startsWith("Cactus:"));
  assert.ok(first, "harvested at least once");
  assert.equal(first.text, "Cactus: 81");
});

test("sensor-only infinite loop stays stoppable and warns about runaway", async () => {
  const s = W.createGame();
  const r = await simulate(s, "let n = 0;\nwhile (true) { n += get_world_size(); }", 0.5);
  assert.deepEqual(r.statuses, ["running", "stopped"]);
  assert.ok(r.logs.some((l) => l.kind === "warn" && l.text.includes("loop without actions?")));
});

test("stop works even if the player swallows errors with try/catch", async () => {
  const s = W.createGame();
  const r = await simulate(s, "while (true) { try { harvest(); } catch (e) { print(e); } }", 2);
  assert.deepEqual(r.statuses, ["running", "stopped"]);
});

test("locked actions return false and log a hint once", async () => {
  const s = W.createGame();
  const r = await simulate(s, "for (let i = 0; i < 5; i++) { print(plant(Entities.Bush)); }\nprint(can_harvest());", 5);
  assert.equal(r.finished, "done");
  const hints = r.logs.filter((l) => l.text.includes("Unlock Plant first"));
  assert.equal(hints.length, 1);
  assert.equal(r.logs.filter((l) => l.text === "false").length, 5);
  assert.ok(r.logs.some((l) => l.text.includes("Unlock Senses first")));
  assert.ok(r.logs.some((l) => l.text === "null"));
});

test("runtime errors report the player's line number", async () => {
  const s = W.createGame();
  const r = await simulate(s, "harvest();\n\nnull.boom;", 5);
  assert.equal(r.finished, "error");
  const err = r.logs.find((l) => l.kind === "error");
  assert.match(err.text, /^Line 3: TypeError/);
});

test("syntax errors are reported, not thrown", async () => {
  const s = W.createGame();
  const r = await simulate(s, "while (true { harvest(); }", 1);
  assert.deepEqual(r.statuses, ["error"]);
  assert.match(r.logs[0].text, /SyntaxError/);
});

test("actions inside forEach callbacks give a clear error", async () => {
  const s = W.createGame();
  const r = await simulate(s, "[North, East].forEach((d) => move(d));\nharvest();", 5);
  assert.equal(r.finished, "error");
  assert.ok(r.logs.some((l) => l.text.includes("busy")));
});

test("power makes actions 2× faster and drains 1 per action", async () => {
  const s = W.createGame();
  s.items.Power = 10;
  const r = await simulate(s, "for (let i = 0; i < 10; i++) { do_a_flip(); }\nprint(get_time());", 30);
  assert.equal(s.items.Power, 0);
  assert.ok(r.logs.some((l) => l.text === "3"), JSON.stringify(r.logs)); // 10 × 600 ticks / 2
});

test("unlock() from code buys upgrades", async () => {
  const s = W.createGame();
  s.items.Hay = 100;
  const r = await simulate(s, "print(unlock(Unlocks.Plant), num_unlocked(Unlocks.Plant), get_cost(Entities.Carrot));", 5);
  assert.equal(r.logs[0].text, 'true 1 {"Wood":1,"Hay":1}');
  assert.equal(s.items.Hay, 90);
});

test("all examples are lint-clean (no ESLint errors) with the farmer globals", () => {
  const linter = new Linter();
  const config = {
    ...eslintConfig,
    languageOptions: {
      ...eslintConfig.languageOptions,
      globals: { ...eslintConfig.languageOptions.globals, ...FARMER_GLOBALS },
    },
  };
  for (const ex of EXAMPLES) {
    const errors = linter.verify(ex.code, config).filter((m) => m.severity === 2);
    assert.deepEqual(errors, [], ex.name);
  }
});
