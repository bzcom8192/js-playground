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
import { buildExport, parseImport } from "./saveData.js";
import { dinoButton, dinoResultText } from "./onlineDino.js";
import { historyRow, historyRows, signed, ticksText, timeText } from "./onlineHistory.js";
import {
  IDENTITY_FILE_MAX,
  IDENTITY_KEY,
  OFFLINE_MESSAGE,
  OnlineError,
  buildIdentityExport,
  clearIdentity,
  createOnlineApi,
  identityFileName,
  loadIdentity,
  parseIdentityImport,
  saveIdentity,
  scoreForRecord,
  submitDinoProgram,
  submitRecord,
  verifyIdentityImport,
} from "./onlineApi.js";
import {
  DINO_BENCHMARK,
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
  await api.history(TOKEN);
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
    ["GET", "/api/players/me/history", auth, null],
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

// ---------- identity export / import (v5) ----------

const identityText = (patch = {}) => JSON.stringify({ format: "js-farmer-identity", v: 1, name: "Nok", token: TOKEN, ...patch });

test("identity file: exactly { format, v, name, token }, and it round-trips", () => {
  const out = buildIdentityExport({ playerId: 3, name: "ชาวนา", token: TOKEN });
  assert.deepEqual(out, { format: "js-farmer-identity", v: 1, name: "ชาวนา", token: TOKEN });
  for (const text of [JSON.stringify(out), JSON.stringify(out, null, 2)]) {
    assert.deepEqual(parseIdentityImport(text), { ok: true, name: "ชาวนา", token: TOKEN });
  }
  assert.equal(identityFileName("ชาวนา 1"), "semicolon-acres-identity-ชาวนา_1.json");
  assert.equal(identityFileName("../a:b"), "semicolon-acres-identity-_a_b.json");
});

test("identity file: bad files are rejected", () => {
  const bad = [
    ["", /not valid JSON/],
    ["{", /not valid JSON/],
    ["null", /not a Semicolon Acres identity/],
    ["42", /not a Semicolon Acres identity/],
    ["[]", /not a Semicolon Acres identity/],
    [JSON.stringify(buildExport({ save: { v: 1 } })), /not a Semicolon Acres identity/], // a game save
    [JSON.stringify({ v: 1, playerId: 1, name: "Nok", token: TOKEN }), /not a Semicolon Acres identity/], // the localStorage form
    [identityText({ format: "js-farmer-save" }), /not a Semicolon Acres identity/],
    [identityText({ v: 2 }), /unknown version/],
    [identityText({ v: "1" }), /unknown version/],
    [identityText({ name: "" }), /damaged/],
    [identityText({ name: 5 }), /damaged/],
    [identityText({ name: "x".repeat(25) }), /damaged/],
    [identityText({ token: undefined }), /damaged/],
    [identityText({ token: "short" }), /damaged/],
    [identityText({ token: `${TOKEN}\n` }), /damaged/],
    [identityText({ token: "z".repeat(64) }), /damaged/],
    [identityText({ token: [TOKEN] }), /damaged/],
    [identityText() + " ".repeat(IDENTITY_FILE_MAX), /not a Semicolon Acres identity/],
    [null, /not a Semicolon Acres identity/], // the panel passes null for an oversized file
  ];
  for (const [text, re] of bad) {
    const r = parseIdentityImport(text);
    assert.equal(r.ok, false, String(text).slice(0, 80));
    assert.match(r.error, re, String(text).slice(0, 80));
  }
});

test("identity file and game save are separate: neither importer takes the other's file", () => {
  assert.equal(parseImport(identityText()).ok, false);
  assert.equal(parseIdentityImport(JSON.stringify(buildExport({ save: { v: 1 }, files: null }))).ok, false);
});

test("identity import: the token is checked with GET /players/me; the server's id and name count", async () => {
  const me = { playerId: 12, name: "Nok", elo: 1016, createdAt: 5 };
  const { fn, calls } = mockFetch(() => ({ status: 200, json: me }));
  const r = await verifyIdentityImport(identityText({ name: "Old Label" }), createOnlineApi({ fetchFn: fn }));
  assert.deepEqual(r, { identity: { playerId: 12, name: "Nok", token: TOKEN }, profile: me });
  assert.deepEqual([calls.length, calls[0].method, calls[0].url, calls[0].headers.Authorization], [1, "GET", "/api/players/me", `Bearer ${TOKEN}`]);
  // What it returns is storable and loads back.
  const st = memStorage();
  assert.ok(saveIdentity(r.identity, st));
  assert.deepEqual(loadIdentity(st), r.identity);
});

test("identity import: bad file → no request; unknown token, offline and odd answers → rejected", async () => {
  const { fn, calls } = mockFetch();
  await assert.rejects(verifyIdentityImport("{", createOnlineApi({ fetchFn: fn })), { name: "OnlineError", message: /not valid JSON/, offline: false });
  assert.equal(calls.length, 0);
  const apiFor = (reply) => createOnlineApi({ fetchFn: mockFetch(reply).fn });
  await assert.rejects(verifyIdentityImport(identityText(), apiFor(() => ({ status: 401, json: { error: "unknown token" } }))), { status: 401, message: /does not know/ });
  await assert.rejects(verifyIdentityImport(identityText(), apiFor(() => new TypeError("Failed to fetch"))), { offline: true, message: OFFLINE_MESSAGE });
  await assert.rejects(verifyIdentityImport(identityText(), apiFor(() => ({ status: 500, json: { error: "internal server error" } }))), { status: 500, offline: false });
  await assert.rejects(verifyIdentityImport(identityText(), apiFor(() => ({ status: 200, json: { ok: true } }))), /not understood/);
});

// ---------- match history (v5) ----------

const histEv = (patch = {}) => ({
  challengeId: 7, role: "author", opponentId: 2, opponentName: "Somsri", goal: "hay500", seed: 1, myTicks: 50_000, myOps: 300,
  opponentTicks: 40_000, opponentOps: 250, outcome: "lose", eloDelta: -16, createdAt: 1000, closedAt: 2000, ...patch,
});

test("history rows: outcome labels, ticks, ELO, times", () => {
  const row = historyRow(histEv());
  assert.deepEqual(row, {
    key: 7, outcome: "lose", label: "แพ้", tone: "bad", authored: true, opponent: "Somsri", goal: row.goal,
    ticks: "50,000t / 40,000t", elo: "−16", eloTone: "bad", when: timeText(2000), created: timeText(1000),
  });
  assert.match(row.goal, /Hay/);
  const win = historyRow(histEv({ role: "challenger", outcome: "win", eloDelta: 16, opponentTicks: DNF_TICKS }));
  assert.deepEqual([win.label, win.authored, win.ticks, win.elo, win.eloTone], ["ชนะ", false, "50,000t / DNF", "+16", "good"]);
  const draw = historyRow(histEv({ outcome: "draw", eloDelta: 0 }));
  assert.deepEqual([draw.label, draw.elo, draw.eloTone], ["เสมอ", "±0", "even"]);
  const drawUp = historyRow(histEv({ outcome: "draw", eloDelta: 1 }));
  assert.deepEqual([drawUp.elo, drawUp.eloTone], ["+1", "good"]);
  const exp = historyRow(histEv({ outcome: "expired", opponentId: null, opponentName: null, opponentTicks: null, opponentOps: null, eloDelta: 0 }));
  assert.deepEqual([exp.label, exp.opponent, exp.ticks, exp.elo, exp.tone], ["หมดอายุ", null, "50,000t", "—", "muted"]);
});

test("history rows: unknown goals and broken answers never throw", () => {
  assert.equal(historyRow(histEv({ goal: "future9" })).goal, "future9");
  assert.deepEqual(historyRows({ events: [histEv(), null, {}, histEv({ outcome: "toString" }), histEv({ challengeId: "8" }), histEv({ challengeId: 9 })] }).map((r) => r.key), [7, 9]);
  for (const bad of [null, undefined, {}, { events: "x" }]) assert.deepEqual(historyRows(bad), []);
  assert.deepEqual([ticksText(null), ticksText(TICK_CAP), ticksText(TICK_CAP + 1)], ["—", "200,000t", "DNF"]);
  assert.deepEqual([signed(3), signed(-3), signed(0)], ["+3", "−3", "±0"]);
  assert.match(timeText(Date.UTC(2026, 10, 22)), /^2026-11-2[123] \d\d:\d\d$/);
  assert.deepEqual([timeText(null), timeText(undefined), timeText(NaN)], ["", "", ""]);
});

// ---------- auto-submit ----------

const MAZE_CODE = "use_item(Items.Fertilizer); /* … */";
const mazeEv = (level = 1, ticks = 4200, ops = 40, code = MAZE_CODE) => ({
  kind: "maze",
  attempt: { level, seed: 77, size: 6, sx: 2, sy: 4, ticks, ops, lines: 9, chars: 200, at: 1 },
  code,
});
const mazeBody = (level, ticks = 4200, ops = 40) => ({ category: "maze", level, ticks, ops, code: MAZE_CODE });

test("scoreForRecord: maze L1–L3 and dino (with the program) become score bodies; others are skipped", () => {
  // The program is what counts; the local maze (seed, size, start tile) stays here.
  assert.deepEqual(scoreForRecord(mazeEv(2)), mazeBody(2));
  assert.equal(scoreForRecord(mazeEv(1, 4200, 40, null)), null, "no program → nothing to replay → not sent");
  assert.equal(scoreForRecord(mazeEv(1, 4200, 40, "x".repeat(100_001))), null, "too long to upload");
  // v5 phase 2: a dino score carries the program too (the server runs its benchmark with it).
  const dinoRec = { bone: 18, level: 2, cut: 3, seed: 5, size: 6, sx: 0, sy: 0, at: 1 };
  assert.deepEqual(scoreForRecord({ kind: "dino", rec: dinoRec, code: "harvest()" }), { category: "dino", value: 18, code: "harvest()" });
  for (const code of [undefined, null, "  ", "x".repeat(100_001)]) assert.equal(scoreForRecord({ kind: "dino", rec: dinoRec, code }), null, "no program, not sent");
  assert.equal(scoreForRecord(mazeEv(4)), null); // no such leaderboard level
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
  const ok = await submitRecord(mazeEv(3), { api, storage: st, sent: new Map() });
  assert.equal(ok.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/scores");
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(calls[0].body, mazeBody(3));
  assert.deepEqual(ok.stored, { id: 1 }, "the server's answer is passed on");
  // A replay rejection (422) is reported as such, still without throwing.
  const rej = await submitRecord(mazeEv(), { api: createOnlineApi({ fetchFn: mockFetch(() => ({ status: 422, json: { error: "maze score rejected: …" } })).fn }), storage: st, sent: new Map() });
  assert.deepEqual(rej, { sent: false, reason: "maze score rejected: …", rejected: true });

  for (const reply of [() => new TypeError("offline"), () => ({ status: 400, json: { error: "nope" } }), () => ({ status: 500, text: "boom" })]) {
    const r = await submitRecord(mazeEv(), { api: createOnlineApi({ fetchFn: mockFetch(reply).fn }), storage: st, sent: new Map() });
    assert.equal(r.sent, false);
    assert.equal(typeof r.reason, "string");
    assert.notEqual(r.reason, "already sent");
  }
  // even a broken api object
  assert.equal((await submitRecord(mazeEv(), { api: { submitScore: () => { throw new Error("sync"); } }, storage: st, sent: new Map() })).sent, false);
});

test("submitRecord: a dino program is sent once, however often its run beats the local record", async () => {
  const st = memStorage();
  saveIdentity({ playerId: 1, name: "Nok", token: TOKEN }, st);
  const ev = (bone, code = "harvest()") => ({ kind: "dino", rec: { bone, level: 1, cut: 1, seed: 1, size: 6, sx: 0, sy: 0, at: 1 }, code });
  const sent = new Map();
  const { fn, calls } = mockFetch(() => ({ status: 201, json: { id: 1, value: 75, verified: true } }));
  const opts = { api: createOnlineApi({ fetchFn: fn }), storage: st, sent };
  const first = await submitRecord(ev(3), opts);
  assert.equal(first.sent, true);
  assert.equal(first.stored.value, 75);
  assert.deepEqual(calls[0].body, { category: "dino", value: 3, code: "harvest()" });
  assert.deepEqual(await submitRecord(ev(12), opts), { sent: false, reason: "already sent" });
  assert.equal(calls.length, 1);
  assert.equal((await submitRecord(ev(27, "harvest(); // v2"), opts)).sent, true, "another program is sent");
  assert.equal(calls.length, 2);
  // The same for a maze program, per level and week (a new week has a new maze).
  const monday = Date.UTC(2026, 10, 22, 17);
  const maze = (level, now) => submitRecord(mazeEv(level), { ...opts, now }).then((r) => r.sent);
  assert.deepEqual([await maze(1, monday - 1), await maze(1, monday - 1), await maze(2, monday - 1)], [true, false, true]);
  assert.deepEqual([await maze(1, monday), await maze(1, monday + 1)], [true, false]);
  assert.equal((await submitRecord(ev(81, "harvest(); // v2"), opts)).reason, "already sent", "each board on its own");

  // Offline / busy: not counted as sent, the next record tries again. 422: the
  // same program would fail again, so it is not repeated.
  let reply = () => new TypeError("offline");
  const flaky = { api: createOnlineApi({ fetchFn: (...a) => mockFetch(reply).fn(...a) }), storage: st, sent: new Map() };
  assert.equal((await submitRecord(ev(3), flaky)).sent, false);
  reply = () => ({ status: 429, json: { error: "busy" } });
  assert.equal((await submitRecord(ev(4), flaky)).reason, "busy");
  reply = () => ({ status: 422, json: { error: "dino score rejected: …" } });
  assert.deepEqual(await submitRecord(ev(5), flaky), { sent: false, reason: "dino score rejected: …", rejected: true });
  assert.deepEqual(await submitRecord(ev(6), flaky), { sent: false, reason: "already sent" });
});

// ---------- the manual dino submit (BRIEF21) ----------

const DINO_STORED = { id: 9, category: "dino", level: null, value: 192, ticks: 3_220_003, ops: 10_809, seed: 4188, size: 12, sx: 6, sy: 6, verified: true, claimed: null };

test("manual dino submit: sends only the program, on demand and as often as asked; the answer is the server's", async () => {
  const sent = new Map();
  const { fn, calls } = mockFetch(() => ({ status: 201, json: DINO_STORED }));
  const api = createOnlineApi({ fetchFn: fn });
  for (let i = 1; i <= 2; i++) {
    assert.deepEqual(await submitDinoProgram("harvest();", { token: TOKEN, api, sent }), DINO_STORED);
    assert.equal(calls.length, i, "no local record is needed, and the same program may be sent again");
  }
  assert.deepEqual([calls[0].method, calls[0].url, calls[0].headers.Authorization], ["POST", "/api/scores", `Bearer ${TOKEN}`]);
  assert.deepEqual(calls[0].body, { category: "dino", code: "harvest();" }, "no claims at all");

  // A later local record of the same program is not sent once more; another one is.
  const st = memStorage();
  saveIdentity({ playerId: 1, name: "Nok", token: TOKEN }, st);
  const ev = (code) => ({ kind: "dino", rec: { bone: 3, level: 1, cut: 1, seed: 1, size: 6, sx: 0, sy: 0, at: 1 }, code });
  assert.equal((await submitRecord(ev("harvest();"), { api, storage: st, sent })).reason, "already sent");
  assert.equal((await submitRecord(ev("harvest(); // 2"), { api, storage: st, sent })).sent, true);
  // And the other way round: an automatic send never blocks the button.
  await submitDinoProgram("harvest(); // 2", { token: TOKEN, api, sent });
  assert.equal(calls.length, 4);
});

test("manual dino submit: refusals reach the player, nothing counts as sent, bad programs are not uploaded", async () => {
  const sent = new Map();
  let reply;
  const { fn, calls } = mockFetch(() => reply);
  const submit = (code = "harvest();") => submitDinoProgram(code, { token: TOKEN, api: createOnlineApi({ fetchFn: fn }), sent });
  for (const [status, error] of [[422, "dino score rejected: the benchmark run ended without harvesting the dinosaur"], [429, "the replay verifier is busy, try again in a moment"], [401, "unknown token"]]) {
    reply = { status, json: { error } };
    await assert.rejects(submit(), (e) => e instanceof OnlineError && e.status === status && !e.offline && e.message === error);
  }
  reply = new TypeError("no network");
  await assert.rejects(submit(), (e) => e.offline && e.message === OFFLINE_MESSAGE);
  reply = { status: 200, json: { ok: true } };
  await assert.rejects(submit(), /not understood/);
  assert.equal(sent.size, 0);
  const before = calls.length;
  for (const code of ["", "  \n", null, "x".repeat(100_001)]) await assert.rejects(submit(code), /code/);
  assert.equal(calls.length, before, "checked before the request");
});

test("a score waits for its replay longer than other requests do", async () => {
  const fn = (_, init) => new Promise((ok, fail) => {
    const t = setTimeout(() => ok({ ok: true, status: 201, json: async () => DINO_STORED }), 60);
    init.signal.addEventListener("abort", () => (clearTimeout(t), fail(new Error("aborted"))));
  });
  const api = createOnlineApi({ fetchFn: fn, timeoutMs: 15, replayTimeoutMs: 2000 });
  assert.equal((await submitDinoProgram("harvest();", { token: TOKEN, api, sent: new Map() })).value, 192);
  await assert.rejects(api.leaderboard("dino"), (e) => e.offline);
});

test("manual dino submit: the button is off in the demo, offline, without an identity and while busy", () => {
  const identity = { playerId: 1, name: "Nok", token: TOKEN };
  assert.equal(dinoButton({ identity }).enabled, true);
  for (const [state, hint] of [
    [{}, /Join above/],
    [{ identity, demo: true }, /demo/],
    [{ demo: true }, /demo/],
    [{ identity, offline: true }, /offline/],
    [{ identity, badIdentity: true }, /does not know/],
    [{ identity, busy: true }, /Wait/],
  ]) {
    const b = dinoButton(state);
    assert.equal(b.enabled, false, JSON.stringify(state));
    assert.match(b.hint, hint);
  }
});

test("manual dino submit: the message shows the measured result and whether an earlier best still counts", () => {
  const opts = (value) => ({ fileName: "main", meId: 1, entries: [{ playerId: 2, value: 9999 }, ...(value === undefined ? [] : [{ playerId: 1, value }])] });
  assert.equal(dinoResultText(DINO_STORED, opts()), "✓ main: 192 Bone on the benchmark farm (3,220,003 ticks · 10,809 ops). Your first dino score on the board.");
  assert.match(dinoResultText(DINO_STORED, opts(75)), /New best \(it was 75\)\.$/);
  for (const v of [192, 1200]) assert.match(dinoResultText(DINO_STORED, opts(v)), new RegExp(`Your earlier ${v.toLocaleString("en-US")} Bone still counts\\.$`));
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
  d.dino = { body: cells.map(([x, y]) => ({ x, y })), dir: "West", stepTimer: 0, appleTimer: 0, seed: 77, draws: 3, start: { x: 4, y: 4 } };
  d.drone.x = 1;
  const dinoEvents = [];
  const rt2 = runtime(d, { onRecord: (ev) => dinoEvents.push(ev) });
  await rt2.run("harvest()");
  d.drone.x = 0;
  await rt2.run("harvest()");
  const rec = { bone: 18, level: 2, cut: 3, seed: 77, size: 6, sx: 4, sy: 4, at: 1_700_000_000_000 };
  assert.deepEqual(dinoEvents, [{ kind: "dino", rec, code: "harvest()" }], "with the program as it ran");

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
  // Maze: the level and the program; the maze and the numbers are the server's.
  const mazeScore = { category: "maze", level: 1, ticks: null, ops: null, value: null, seed: null, size: 12, sx: 0, sy: 0, code: "x" };
  for (const claim of [{}, { ticks: 200, ops: 200, seed: 5, size: 6, sx: 0, sy: 5 }, { ticks: -1, ops: "many", seed: 2 ** 40, size: 1, sx: 99, value: 3, period: "2020-W01" }]) {
    assert.deepEqual(validateScore({ category: "maze", level: 1, code: "x", ...claim }), { ok: true, score: mazeScore }, JSON.stringify(claim));
  }
  for (const patch of [{ level: 0 }, { level: 4 }, { level: undefined }, { code: "" }, { code: undefined }, { code: 5 }, { code: "x".repeat(100_001) }]) {
    assert.equal(validateScore({ category: "maze", level: 1, code: "x", ...patch }).ok, false, JSON.stringify(patch));
  }
  // v5 phase 2: dino needs the program and nothing else; every claimed number is ignored.
  const { seed, size, x, y } = DINO_BENCHMARK;
  const dinoScore = { category: "dino", level: null, ticks: null, ops: null, value: null, seed, size, sx: x, sy: y, code: "x" };
  for (const claim of [{}, { value: 18 }, { value: DINO_MAX_BONE + 1, ticks: -1, ops: "many", seed: -5, size: 3, sx: 99 }]) {
    assert.deepEqual(validateScore({ category: "dino", code: "x", ...claim }), { ok: true, score: dinoScore }, JSON.stringify(claim));
  }
  for (const code of [undefined, null, "", "  ", 5, "x".repeat(100_001)]) {
    const r = validateScore({ category: "dino", value: 18, code });
    assert.equal(r.ok, false);
    assert.match(r.error, /code/);
  }
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
