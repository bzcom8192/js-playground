// v4 phase 1 (Online): the API client (mock fetch), identity storage,
// offline tolerance, auto-submit of new local records, the shared rules and
// the solo arena run used by friend challenges.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { WORLD_SIZES } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { mulberry32 } from "./maze.js";
import { BOT_CODE } from "./arenaBots.js";
import { TICK_CAP, runMatch, runSolo } from "./arena.js";
import { buildExport } from "./saveData.js";
import {
  IDENTITY_KEY,
  OFFLINE_MESSAGE,
  OnlineError,
  clearIdentity,
  createOnlineApi,
  loadIdentity,
  saveIdentity,
  scoreForRecord,
  submitRecord,
} from "./onlineApi.js";
import {
  DINO_MAX_BONE,
  DNF_TICKS,
  MAZE_LEVELS,
  eloUpdate,
  raceScore,
  validateChallenge,
  validateName,
  validateResult,
  validateScore,
} from "./onlineRules.js";

const TOKEN = "ab".repeat(32);

/** A fetch mock: records calls, answers with `reply(url, init)` → { status, json } | { status, text } | Error. */
function mockFetch(reply = () => ({ status: 200, json: {} })) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const r = await reply(url, init);
    if (r instanceof Error) throw r;
    const text = r.text ?? JSON.stringify(r.json);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => JSON.parse(text),
    };
  };
  return { fn, calls };
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

// ---------- request shapes ----------

test("api client: request shapes (method, URL, auth header, JSON body)", async () => {
  const { fn, calls } = mockFetch(() => ({ status: 200, json: { ok: true } }));
  const api = createOnlineApi({ fetchFn: fn, base: "/api/" });
  await api.register("Somchai");
  await api.me(TOKEN);
  await api.leaderboard("maze", 2);
  await api.leaderboard("dino");
  await api.submitScore(TOKEN, { category: "maze", level: 1, ticks: 900, ops: 9 });
  await api.listChallenges();
  await api.getChallenge(7);
  await api.createChallenge(TOKEN, { goal: "hay500", seed: 5, code: "harvest()", authorTicks: 100, authorOps: 3 });
  await api.answerChallenge(TOKEN, 7, { ticks: 90, ops: 2, code: "harvest()" });
  const shape = calls.map((c) => [c.method, c.url, c.headers.Authorization ?? null, c.body ?? null]);
  const auth = `Bearer ${TOKEN}`;
  assert.deepEqual(shape, [
    ["POST", "/api/auth/register", null, { name: "Somchai" }],
    ["GET", "/api/players/me", auth, null],
    ["GET", "/api/leaderboard?category=maze&level=2", null, null],
    ["GET", "/api/leaderboard?category=dino", null, null],
    ["POST", "/api/scores", auth, { category: "maze", level: 1, ticks: 900, ops: 9 }],
    ["GET", "/api/challenges", null, null],
    ["GET", "/api/challenges/7", null, null],
    ["POST", "/api/challenges", auth, { goal: "hay500", seed: 5, code: "harvest()", authorTicks: 100, authorOps: 3 }],
    ["POST", "/api/challenges/7/results", auth, { ticks: 90, ops: 2, code: "harvest()" }],
  ]);
  for (const c of calls) {
    if (c.body !== undefined) assert.equal(c.headers["Content-Type"], "application/json");
    else assert.equal(c.headers["Content-Type"], undefined);
  }
});

// ---------- errors / offline ----------

test("api client: server errors keep the message and status (not offline)", async () => {
  const { fn } = mockFetch(() => ({ status: 409, json: { error: "that name is already taken" } }));
  const api = createOnlineApi({ fetchFn: fn });
  await assert.rejects(api.register("Alice"), (err) => {
    assert.ok(err instanceof OnlineError);
    assert.equal(err.message, "that name is already taken");
    assert.equal(err.status, 409);
    assert.equal(err.offline, false);
    return true;
  });
  const { fn: fn2 } = mockFetch(() => ({ status: 401, json: {} }));
  await assert.rejects(createOnlineApi({ fetchFn: fn2 }).me(TOKEN), { status: 401, message: "HTTP 401", offline: false });
});

test("api client: unreachable / non-API answers are 'offline' with the Thai message", async () => {
  const cases = [
    ["network error", () => new TypeError("Failed to fetch")],
    ["HTML page (no API behind /api)", () => ({ status: 200, text: "<!doctype html><html></html>" })],
    ["tunnel 502 text", () => ({ status: 502, text: "Bad Gateway" })],
    ["proxy 503 JSON", () => ({ status: 503, json: { error: "upstream down" } })],
    ["JSON array", () => ({ status: 200, json: [1, 2] })],
  ];
  for (const [label, reply] of cases) {
    const api = createOnlineApi({ fetchFn: mockFetch(reply).fn });
    await assert.rejects(api.listChallenges(), (err) => {
      assert.ok(err instanceof OnlineError, label);
      assert.equal(err.offline, true, label);
      if (label !== "proxy 503 JSON") assert.equal(err.message, OFFLINE_MESSAGE, label);
      return true;
    });
  }
});

test("api client: a hanging server times out as offline", async () => {
  const fn = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const api = createOnlineApi({ fetchFn: fn, timeoutMs: 20 });
  await assert.rejects(api.health(), { offline: true, message: OFFLINE_MESSAGE });
});

test("api client: no global fetch at all → offline, not a crash", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    await assert.rejects(createOnlineApi().health(), { offline: true });
  } finally {
    globalThis.fetch = saved;
  }
});

// ---------- identity ----------

test("identity: save / load / clear in farmer_online_v1; damaged data → null", () => {
  const st = memStorage();
  assert.equal(loadIdentity(st), null);
  assert.ok(saveIdentity({ playerId: 3, name: "Nok", token: TOKEN }, st));
  assert.deepEqual(JSON.parse(st.map.get(IDENTITY_KEY)), { v: 1, playerId: 3, name: "Nok", token: TOKEN });
  assert.deepEqual(loadIdentity(st), { playerId: 3, name: "Nok", token: TOKEN });
  clearIdentity(st);
  assert.equal(loadIdentity(st), null);
  for (const bad of ["{", "null", '{"v":2,"playerId":1,"name":"a","token":"' + TOKEN + '"}', '{"v":1,"playerId":"1","name":"a","token":"' + TOKEN + '"}', '{"v":1,"playerId":1,"name":"a","token":"short"}']) {
    assert.equal(loadIdentity(memStorage({ [IDENTITY_KEY]: bad })), null, bad);
  }
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("x"); } };
  assert.equal(loadIdentity(throwing), null);
  assert.equal(saveIdentity({ playerId: 1, name: "a", token: TOKEN }, throwing), false);
  clearIdentity(throwing); // no throw
});

test("identity is not part of the Save Data export", () => {
  const exp = buildExport({ save: { v: 1 }, files: { v: 1, nextId: 2, files: [] } });
  assert.deepEqual(Object.keys(exp).sort(), ["exportedAt", "files", "format", "save", "v"]);
  assert.ok(!JSON.stringify(exp).includes(IDENTITY_KEY));
});

// ---------- auto-submit ----------

const MAZE_CODE = "use_item(Items.Fertilizer); /* … */";
const mazeEv = (level = 1, ticks = 4200, ops = 40, code = MAZE_CODE) => ({
  kind: "maze",
  attempt: { level, seed: 77, size: 6, sx: 2, sy: 4, ticks, ops, lines: 9, chars: 200, at: 1 },
  code,
});
const mazeBody = (level, ticks = 4200, ops = 40) => ({ category: "maze", level, ticks, ops, seed: 77, size: 6, sx: 2, sy: 4, code: MAZE_CODE });

test("scoreForRecord: maze L1–L3 (with code + layout for the replay) and dino become score bodies; others are skipped", () => {
  // v4 phase 2: a maze score carries the program, seed, farm size and start tile.
  assert.deepEqual(scoreForRecord(mazeEv(2)), mazeBody(2));
  assert.equal(scoreForRecord(mazeEv(1, 4200, 40, null)), null, "no program → nothing to replay → not sent");
  assert.equal(scoreForRecord(mazeEv(1, 4200, 40, "x".repeat(100_001))), null, "too long to upload");
  assert.equal(scoreForRecord({ ...mazeEv(1), attempt: { ...mazeEv(1).attempt, sx: 6 } }), null, "start off the farm");
  assert.deepEqual(scoreForRecord({ kind: "dino", rec: { bone: 18, level: 2, cut: 3, at: 1 } }), { category: "dino", value: 18 });
  assert.equal(scoreForRecord(mazeEv(4)), null); // no such leaderboard level
  assert.equal(scoreForRecord(mazeEv(1, 0, 0)), null); // insane
  assert.equal(scoreForRecord({ kind: "dino", rec: { bone: DINO_MAX_BONE + 1 } }), null);
  assert.equal(scoreForRecord(null), null);
  assert.deepEqual(MAZE_LEVELS, [1, 2, 3]);
});

test("submitRecord: sends with the stored token, skips without identity / in demo, never rejects", async () => {
  const st = memStorage();
  const { fn, calls } = mockFetch(() => ({ status: 201, json: { id: 1 } }));
  const api = createOnlineApi({ fetchFn: fn });
  assert.deepEqual(await submitRecord(mazeEv(), { api, storage: st }), { sent: false, reason: "no identity" });
  assert.equal(calls.length, 0);
  saveIdentity({ playerId: 1, name: "Nok", token: TOKEN }, st);
  assert.equal((await submitRecord(mazeEv(), { api, storage: st, demo: true })).sent, false);
  assert.equal((await submitRecord(mazeEv(9), { api, storage: st })).sent, false);
  assert.equal(calls.length, 0);
  const ok = await submitRecord(mazeEv(3), { api, storage: st });
  assert.equal(ok.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/scores");
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(calls[0].body, mazeBody(3));
  assert.deepEqual(ok.stored, { id: 1 }, "the server's answer is passed on");
  // A replay rejection (422) is reported as such, still without throwing.
  const rej = await submitRecord(mazeEv(), { api: createOnlineApi({ fetchFn: mockFetch(() => ({ status: 422, json: { error: "maze score rejected: …" } })).fn }), storage: st });
  assert.deepEqual(rej, { sent: false, reason: "maze score rejected: …", rejected: true });

  for (const reply of [() => new TypeError("offline"), () => ({ status: 400, json: { error: "nope" } }), () => ({ status: 500, text: "boom" })]) {
    const r = await submitRecord(mazeEv(), { api: createOnlineApi({ fetchFn: mockFetch(reply).fn }), storage: st });
    assert.equal(r.sent, false);
    assert.equal(typeof r.reason, "string");
  }
  // even a broken api object
  assert.equal((await submitRecord(mazeEv(), { api: { submitScore: () => { throw new Error("sync"); } }, storage: st })).sent, false);
});

// ---------- the runtime hook ----------

function farm(n, unlocks = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, ...unlocks });
  return s;
}
function runtime(s, opts = {}) {
  let t = 0;
  return createRuntime({
    getState: () => s,
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
    wallClock: () => 1_700_000_000_000,
    ...opts,
  });
}
const SOLVER = `use_item(Items.Fertilizer);
const seen = new Set();
const back = { North: South, South: North, East: West, West: East };
const key = () => get_pos_x() + "," + get_pos_y();
function dfs() {
  if (get_entity_type() === Entities.Treasure) { harvest(); return true; }
  seen.add(key());
  for (const d of [North, East, South, West]) {
    if (!can_move(d)) continue;
    move(d);
    if (!seen.has(key()) && dfs()) return true;
    move(back[d]);
  }
  return false;
}
dfs();
`;

test("runtime onRecord fires on a new best maze (a valid score) and dino haul, not on worse ones", async () => {
  const events = [];
  const mk = () => {
    const s = farm(6, { Fertilizer: 1, Mazes: 1 });
    s.items.Fertilizer = 10;
    W.droneTile(s).entity = { type: "Bush", progress: 1 };
    return s;
  };
  const s = mk();
  const rt = runtime(s, { rng: mulberry32(9), onRecord: (ev) => events.push(ev) });
  assert.equal(await rt.run(SOLVER), "done");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "maze");
  assert.equal(events[0].attempt, s.records.mazes["1"].best);
  assert.equal(events[0].code, SOLVER, "the event carries the program as it ran (for the server's replay)");
  // A real maze solve passes the server's sanity rules (ops ≤ ticks etc.).
  const score = scoreForRecord(events[0]);
  assert.ok(score && validateScore(score).ok, JSON.stringify(events[0].attempt));

  // Same seed again from the same tile: equal, not better → no event.
  W.droneTile(s).entity = null;
  [s.drone.x, s.drone.y] = [0, 0];
  W.droneTile(s).entity = { type: "Bush", progress: 1 };
  s.pendingSeed = events[0].attempt.seed;
  assert.equal(await rt.run(SOLVER), "done");
  assert.equal(s.records.mazes["1"].attempts.length, 2, "the replay was solved and recorded");
  assert.equal(events.length, 1);

  // Dino: 18 Bone is a best, 2 Bone afterwards is not.
  const d = farm(6, { Dinosaurs: 2 });
  const cells = [[0, 0], [1, 0], [2, 0], [3, 0]];
  for (const [x, y] of cells) W.tileAt(d, x, y).entity = { type: "Dinosaur", progress: 1 };
  d.dino = { body: cells.map(([x, y]) => ({ x, y })), dir: "West", stepTimer: 0, appleTimer: 0 };
  d.drone.x = 1;
  const dinoEvents = [];
  const rt2 = runtime(d, { onRecord: (ev) => dinoEvents.push(ev) });
  await rt2.run("harvest()");
  d.drone.x = 0;
  await rt2.run("harvest()");
  assert.deepEqual(dinoEvents, [{ kind: "dino", rec: { bone: 18, level: 2, cut: 3, at: 1_700_000_000_000 } }]);

  // A throwing onRecord never breaks the run.
  const s3 = mk();
  const rt3 = runtime(s3, { rng: mulberry32(9), onRecord: () => { throw new Error("listener bug"); } });
  assert.equal(await rt3.run(SOLVER), "done");
  assert.ok(s3.items.Gold > 0);
});

// ---------- shared rules ----------

test("rules: names, scores, challenges, results", () => {
  assert.deepEqual(validateName("  Nok   Noi "), { ok: true, name: "Nok Noi" });
  assert.equal(validateName("x".repeat(24)).ok, true);
  assert.equal(validateName("x".repeat(25)).ok, false);
  assert.equal(validateName("").ok, false);
  assert.equal(validateName("a\nb").ok, false);
  const maze = { category: "maze", level: 1, ticks: 200, ops: 200, seed: 5, size: 6, sx: 0, sy: 5, code: "x" };
  assert.equal(validateScore(maze).ok, true);
  assert.equal(validateScore({ ...maze, ops: 201 }).ok, false);
  // v4 phase 2: the replay inputs are required for maze scores.
  for (const patch of [{ seed: undefined }, { seed: null }, { size: 9 }, { size: undefined }, { sx: 6 }, { sy: -1 }, { sx: 1.5 }, { code: "" }, { code: undefined }, { code: 5 }]) {
    assert.equal(validateScore({ ...maze, ...patch }).ok, false, JSON.stringify(patch));
  }
  assert.deepEqual(validateScore(maze).score, { ...maze, value: null });
  assert.equal(validateScore({ category: "dino", value: DINO_MAX_BONE }).ok, true);
  assert.equal(DINO_MAX_BONE, 144 * 144 * 3);
  const c = { goal: "pumpkin300", seed: 0, code: "x", authorTicks: TICK_CAP, authorOps: 1 };
  assert.equal(validateChallenge(c).ok, true);
  // v4 phase 2: claimed ticks / ops are accepted but ignored (the server replays).
  assert.deepEqual(validateChallenge({ ...c, authorTicks: DNF_TICKS, authorOps: -3 }), { ok: true, challenge: { goal: "pumpkin300", seed: 0, code: "x" } });
  assert.equal(validateChallenge({ goal: "pumpkin300", seed: 0, code: "" }).ok, false);
  assert.deepEqual(validateResult({ ticks: DNF_TICKS + 1, ops: -1, code: "x" }), { ok: true, result: { code: "x" } });
  assert.equal(validateResult({ ticks: 10, ops: 1 }).ok, false, "the code is what counts");
});

test("rules: race order and zero-sum ELO (K = 32)", () => {
  assert.equal(raceScore({ ticks: 10, ops: 99 }, { ticks: 11, ops: 1 }), 1);
  assert.equal(raceScore({ ticks: 10, ops: 5 }, { ticks: 10, ops: 6 }), 1);
  assert.equal(raceScore({ ticks: 10, ops: 6 }, { ticks: 10, ops: 5 }), 0);
  assert.equal(raceScore({ ticks: 10, ops: 5 }, { ticks: 10, ops: 5 }), 0.5);
  assert.deepEqual(eloUpdate(1000, 1000, 1), { deltaA: 16, deltaB: -16, ratingA: 1016, ratingB: 984 });
  assert.deepEqual(eloUpdate(1000, 1000, 0.5), { deltaA: 0, deltaB: 0, ratingA: 1000, ratingB: 1000 });
  assert.deepEqual(eloUpdate(1000, 1200, 1), { deltaA: 24, deltaB: -24, ratingA: 1024, ratingB: 1176 });
  assert.deepEqual(eloUpdate(1200, 1000, 0), { deltaA: -24, deltaB: 24, ratingA: 1176, ratingB: 1024 });
  for (let a = 600; a <= 1800; a += 37) for (const s of [0, 0.5, 1]) {
    const e = eloUpdate(a, 1111, s);
    assert.equal(e.deltaA + e.deltaB, 0);
    assert.ok(Object.is(e.deltaB, 0) || e.deltaB !== 0);
  }
});

// ---------- solo run (friend arena) ----------

test("runSolo: a solo run is exactly one side of a match (same reach tick), deterministic", async () => {
  const seed = 11;
  const solo = await runSolo({ code: BOT_CODE.pro, goal: "hay500", seed });
  assert.equal(solo.reached, true);
  assert.equal(solo.error, null);
  assert.ok(solo.ticks > 0 && solo.ticks <= TICK_CAP);
  assert.ok(solo.ops > 0);
  // pro as "you" vs rookie: your reach tick is the solo tick (sides never interact).
  const m = await runMatch({ code: BOT_CODE.pro, bot: "rookie", goal: "hay500", seed });
  assert.equal(m.sides.you.reachedAt, solo.ticks);
  assert.equal(m.sides.you.ops, solo.ops);
  const again = await runSolo({ code: BOT_CODE.pro, goal: "hay500", seed });
  assert.deepEqual(again, solo);
  // A valid challenge / result body.
  assert.equal(validateChallenge({ goal: "hay500", seed, code: BOT_CODE.pro, authorTicks: solo.ticks, authorOps: solo.ops }).ok, true);
});

test("runSolo: failing or idle programs do not finish (DNF ticks)", async () => {
  const idle = await runSolo({ code: "harvest()", goal: "hay500", seed: 3 });
  assert.equal(idle.reached, false);
  assert.equal(idle.ticks, DNF_TICKS);
  assert.equal(idle.reason, "idle");
  const err = await runSolo({ code: "nope()", goal: "wood800", seed: 3 });
  assert.equal(err.reached, false);
  assert.equal(err.ticks, DNF_TICKS);
  assert.match(err.error, /nope/);
  assert.equal(validateResult({ ticks: err.ticks, ops: err.ops, code: "nope()" }).ok, true);
});
