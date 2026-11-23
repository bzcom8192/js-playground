// v4 phase 1 (Online): the API client (mock fetch), identity storage,
// offline tolerance, the shared rules and the solo arena run used by friend
// challenges. (BRIEF22 removed the score auto-submit and the dino button.)
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOT_CODE } from "./arenaBots.js";
import { TICK_CAP, runMatch, runSolo } from "./arena.js";
import { buildExport, parseImport } from "./saveData.js";
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
  verifyIdentityImport,
} from "./onlineApi.js";
import { DNF_TICKS, eloUpdate, raceScore, validateChallenge, validateName, validateResult } from "./onlineRules.js";
import * as Rules from "./onlineRules.js";
import * as Api from "./onlineApi.js";

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
    ["GET", "/api/challenges", null, null],
    ["GET", "/api/challenges/7", null, null],
    ["POST", "/api/challenges", auth, { goal: "hay500", seed: 5, code: "harvest()", authorTicks: 100, authorOps: 3 }],
    ["POST", "/api/challenges/7/results", auth, { ticks: 90, ops: 2, code: "harvest()" }],
  ]);
  for (const c of calls) {
    if (c.body !== undefined) assert.equal(c.headers["Content-Type"], "application/json");
    else assert.equal(c.headers["Content-Type"], undefined);
  }
  // BRIEF22: the client has nothing left that talks to the score endpoints.
  for (const gone of ["leaderboard", "submitScore", "daily"]) assert.equal(api[gone], undefined, gone);
  for (const gone of ["scoreForRecord", "submitRecord", "submitDinoProgram", "REPLAY_TIMEOUT_MS"]) assert.equal(Api[gone], undefined, gone);
  for (const gone of ["CATEGORIES", "MAZE_LEVELS", "MAZE_BENCHMARK", "DINO_BENCHMARK", "DINO_MAX_BONE", "validateScore", "validateBoardQuery", "betterScore"]) {
    assert.equal(Rules[gone], undefined, gone);
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

// ---------- shared rules ----------

test("rules: names, challenges, results", () => {
  assert.deepEqual(validateName("  Nok   Noi "), { ok: true, name: "Nok Noi" });
  assert.equal(validateName("x".repeat(24)).ok, true);
  assert.equal(validateName("x".repeat(25)).ok, false);
  assert.equal(validateName("").ok, false);
  assert.equal(validateName("a\nb").ok, false);
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
