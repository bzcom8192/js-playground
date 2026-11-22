// Semicolon Acres Online server tests (node --test). Each test file run gets its
// own temp SQLite files; the servers listen on ephemeral ports.
//
// Two servers:
//  - `srv` replays for real (the worker-thread verifier, anti-cheat level 2):
//    the verification tests at the bottom run against it.
//  - `stub` has a stand-in verifier that reads the "measured" numbers from a
//    comment in the submitted code (stubCode()), so the HTTP / leaderboard /
//    ELO plumbing tests can pick exact tick counts without writing programs
//    that hit them. It goes through exactly the same routes and storage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "./index.js";
import { createRateLimiter } from "./app.js";
import { hashToken, openDb } from "./db.js";
import { createVerifier } from "./verifier.js";
import { CHALLENGE_TTL_MS, DINO_BENCHMARK, DINO_MAX_BONE, DNF_TICKS, HISTORY_LIMIT, eloUpdate } from "../src/farmer/onlineRules.js";
import * as W from "../src/farmer/world.js";
import { WORLD_SIZES } from "../src/farmer/constants.js";
import { createRuntime } from "../src/farmer/runtime.js";
import { mulberry32 } from "../src/farmer/maze.js";
import { BOT_CODE } from "../src/farmer/arenaBots.js";
import { TICK_CAP, runSolo } from "../src/farmer/arena.js";
import { verifyDino } from "../src/farmer/verify.js";

let dir;
let srv; // real replay verification
let stub; // stand-in verifier (see the header)
let base;

/** Code the stub verifier "measures" as { ticks, ops } (reached / solved iff ticks ≤ the cap);
 *  a dino benchmark run measures `bone`. */
const stubCode = (ticks, ops, bone = 1) => `// stub ticks=${ticks} ops=${ops} bone=${bone}\nharvest();`;
const dinoScore = (bone, claim = {}) => ({ category: "dino", code: stubCode(1000, 10, bone), ...claim });
function stubVerifier() {
  return {
    async verify(job) {
      const m = /ticks=(\d+) ops=(\d+)/.exec(job.code);
      const ticks = m ? Number(m[1]) : DNF_TICKS;
      const ops = m ? Number(m[2]) : 0;
      if (job.kind === "arena") {
        const reached = ticks <= TICK_CAP;
        return { ok: true, result: { kind: "arena", reached, ticks: reached ? ticks : DNF_TICKS, ops, reason: reached ? "goal" : "cap", error: null } };
      }
      if (job.kind === "dino") {
        const bone = Number(/bone=(\d+)/.exec(job.code)?.[1] ?? 0);
        return { ok: true, result: { kind: "dino", harvested: bone > 0, bone: bone || null, ticks: m ? ticks : null, ops: m ? ops : null, reason: "ended", error: null } };
      }
      return { ok: true, result: { kind: "maze", solved: !!m, mode: "spawn", ticks: m ? ticks : null, ops: m ? ops : null, reason: m ? "solved" : "ended", error: null } };
    },
    close: async () => {},
  };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "farmer-online-"));
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>farmer</title>");
  writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");
  const rateLimit = { max: 10_000, windowMs: 60_000 };
  srv = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "test.db"), distDir: dist, rateLimit });
  stub = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "stub.db"), distDir: dist, rateLimit, verifier: stubVerifier() });
  base = stub.url;
});

after(async () => {
  await srv?.close();
  await stub?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { body, token, headers = {}, at = base } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(at + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

function rawGet(path) {
  const { port } = new URL(base);
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => ok(data));
    });
    req.on("error", fail);
    req.end();
  });
}

let nameSeq = 0;
async function register(name = `p${++nameSeq}-${Date.now() % 100000}`, at = base) {
  const r = await call("POST", "/api/auth/register", { body: { name }, at });
  assert.equal(r.status, 201, r.text);
  return r.json;
}

// ---------- auth ----------

test("register returns playerId + a 32-byte hex token; only its SHA-256 is stored", async () => {
  const r = await call("POST", "/api/auth/register", { body: { name: "  Somchai   Farmer " } });
  assert.equal(r.status, 201);
  assert.ok(Number.isInteger(r.json.playerId));
  assert.match(r.json.token, /^[0-9a-f]{64}$/);
  assert.equal(r.json.name, "Somchai Farmer");
  assert.equal(r.json.elo, 1000);
  const row = stub.db.raw.prepare("SELECT token_hash FROM players WHERE id = ?").get(r.json.playerId);
  assert.equal(row.token_hash, hashToken(r.json.token));
  assert.notEqual(row.token_hash, r.json.token);
  const me = await call("GET", "/api/players/me", { token: r.json.token });
  assert.equal(me.status, 200);
  assert.deepEqual({ ...me.json, createdAt: 0 }, { playerId: r.json.playerId, name: "Somchai Farmer", elo: 1000, createdAt: 0 });
});

test("duplicate names are rejected case-insensitively (409)", async () => {
  await register("Alice");
  const dup = await call("POST", "/api/auth/register", { body: { name: "alice" } });
  assert.equal(dup.status, 409);
  assert.match(dup.json.error, /taken/);
  const dup2 = await call("POST", "/api/auth/register", { body: { name: " ALICE " } });
  assert.equal(dup2.status, 409);
});

test("name length 1–24 and type are enforced", async () => {
  for (const name of ["", "   ", "x".repeat(25), 42, null, "bad\u0007name"]) {
    const r = await call("POST", "/api/auth/register", { body: { name } });
    assert.equal(r.status, 400, `name ${JSON.stringify(name)}`);
    assert.equal(typeof r.json.error, "string");
  }
  const ok = await call("POST", "/api/auth/register", { body: { name: "ชาวนา".padEnd(24, "ก") } });
  assert.equal(ok.status, 201);
});

test("auth rejection: missing, malformed and unknown tokens → 401 JSON", async () => {
  const score = { category: "maze", level: 1, ticks: 1000, ops: 10 };
  const none = await call("POST", "/api/scores", { body: score });
  assert.equal(none.status, 401);
  assert.equal(typeof none.json.error, "string");
  const bad = await call("POST", "/api/scores", { body: score, headers: { Authorization: "Bearer nope" } });
  assert.equal(bad.status, 401);
  const unknown = await call("POST", "/api/scores", { body: score, token: "a".repeat(64) });
  assert.equal(unknown.status, 401);
  assert.equal((await call("GET", "/api/players/me")).status, 401);
  assert.equal((await call("POST", "/api/challenges", { body: {} })).status, 401);
  assert.equal((await call("POST", "/api/challenges/1/results", { body: {} })).status, 401);
});

// ---------- scores ----------

/** A maze score body whose stub replay measures exactly `ticks` / `ops`. */
const mazeScore = (level, ticks, ops) => ({ category: "maze", level, ticks, ops, seed: 7, size: 6, sx: 0, sy: 0, code: stubCode(ticks, ops) });

test("score sanity rejections", async () => {
  const { token } = await register();
  const bad = [
    { category: "chess", ticks: 10, ops: 1 },
    { category: "maze", level: 0, ticks: 10, ops: 1 },
    { category: "maze", level: 4, ticks: 10, ops: 1 },
    { category: "maze", ticks: 10, ops: 1 }, // no level
    { category: "maze", level: 1, ticks: 0, ops: 1 },
    { category: "maze", level: 1, ticks: -5, ops: 1 },
    { category: "maze", level: 1, ticks: 1.5, ops: 1 },
    { category: "maze", level: 1, ticks: "100", ops: 1 },
    { category: "maze", level: 1, ticks: 100, ops: 0 },
    { category: "maze", level: 1, ticks: 100, ops: 101 }, // more ops than ticks
    { category: "maze", level: 1, ticks: 1e12, ops: 1 },
    { category: "maze", level: 1, ticks: 100, ops: 1, seed: -1 },
    { category: "maze", level: 1, ticks: 100, ops: 1, seed: 2 ** 32 },
    { ...dinoScore(10), level: 1 }, // dino has no level
    { category: "dino" }, // v5 phase 2: no program, no score
    { category: "dino", value: 10 },
    { category: "dino", value: 10, ticks: 100, ops: 10, seed: 4188 },
    { category: "dino", value: 10, code: "" },
    { category: "dino", value: 10, code: "   " },
    { category: "dino", value: 10, code: 42 },
    { category: "dino", value: 10, code: "x".repeat(100_001) },
  ];
  for (const body of bad) {
    const r = await call("POST", "/api/scores", { body, token });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.equal(typeof r.json.error, "string");
  }
  assert.equal((await call("POST", "/api/scores", { body: "{not json", token })).status, 400);
  assert.equal((await call("POST", "/api/scores", { body: [1, 2], token })).status, 400);
  // v4 phase 2: maze scores also need the replay inputs.
  const good = mazeScore(1, 2400, 12);
  for (const patch of [{ seed: undefined }, { size: 9 }, { sx: 6 }, { code: "" }, { code: undefined }]) {
    const r = await call("POST", "/api/scores", { body: { ...good, ...patch }, token });
    assert.equal(r.status, 400, `${JSON.stringify(patch)} → ${r.status} ${r.text}`);
  }
  const ok = await call("POST", "/api/scores", { body: good, token });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.verified, true);
  assert.equal(ok.json.code, undefined, "the program is not echoed back");
  const dino = await call("POST", "/api/scores", { body: dinoScore(48, { value: 7 }), token });
  assert.equal(dino.status, 201, dino.text);
  assert.equal(dino.json.verified, true);
  assert.equal(dino.json.value, 48, "measured, not claimed");
  assert.equal(dino.json.code, undefined, "the program is not echoed back");
});

test("leaderboard: best entry per player, maze = fewest ticks then ops, dino = most Bone", async () => {
  const a = await register("LB-A");
  const b = await register("LB-B");
  const c = await register("LB-C");
  const post = (p, body) => call("POST", "/api/scores", { body, token: p.token }).then((r) => assert.equal(r.status, 201, r.text));
  // Level 2 is only used by this test.
  await post(a, mazeScore(2, 5000, 40));
  await post(a, mazeScore(2, 3000, 50)); // a's best
  await post(a, mazeScore(2, 9000, 10));
  await post(b, mazeScore(2, 3000, 45)); // same ticks, fewer ops → ahead of a
  await post(c, mazeScore(2, 2000, 900));
  await post(c, mazeScore(3, 100, 1)); // other level: ignored
  const lb = await call("GET", "/api/leaderboard?category=maze&level=2");
  assert.equal(lb.status, 200);
  assert.equal(lb.json.category, "maze");
  assert.equal(lb.json.level, 2);
  assert.deepEqual(
    lb.json.entries.map((e) => [e.rank, e.name, e.ticks, e.ops]),
    [
      [1, "LB-C", 2000, 900],
      [2, "LB-B", 3000, 45],
      [3, "LB-A", 3000, 50],
    ],
  );
  assert.equal(lb.json.entries[0].playerId, c.playerId);
  assert.ok(lb.json.entries.every((e) => e.verified === true), "maze rows are replay-verified");
  assert.deepEqual([lb.json.entries[0].size, lb.json.entries[0].sx, lb.json.entries[0].sy], [6, 0, 0]);
  assert.equal(lb.json.entries[0].code, undefined);

  const d = await register("LB-D");
  for (const [p, v] of [[a, 50], [a, 400], [b, 400], [d, 90], [d, 12]]) await post(p, dinoScore(v));
  const dino = await call("GET", "/api/leaderboard?category=dino");
  const mine = dino.json.entries.filter((e) => [a, b, d].some((p) => p.playerId === e.playerId));
  assert.deepEqual(
    mine.map((e) => [e.name, e.value]),
    [
      ["LB-A", 400],
      ["LB-B", 400],
      ["LB-D", 90],
    ],
  );
  // equal Bone shares a rank
  assert.equal(mine[0].rank, mine[1].rank);
  assert.ok(mine.every((e) => e.verified === true), "dino rows are benchmark runs");

  for (const q of ["category=maze", "category=maze&level=9", "category=dino&level=1", "category=x", ""]) {
    const r = await call("GET", `/api/leaderboard?${q}`);
    assert.equal(r.status, 400, q);
  }
});

test("leaderboard is capped at 50 entries", async () => {
  for (let i = 0; i < 53; i++) {
    const p = await register(`cap${i}`);
    const r = await call("POST", "/api/scores", { body: mazeScore(3, 10_000 + i, 5), token: p.token });
    assert.equal(r.status, 201);
  }
  const lb = await call("GET", "/api/leaderboard?category=maze&level=3");
  assert.equal(lb.json.entries.length, 50);
});

// ---------- challenges + ELO ----------

const CODE = stubCode(50_000, 300);

async function makeChallenge(author, { ticks = 50_000, ops = 300, goal = "hay500", seed = 1234, at = base } = {}) {
  const r = await call("POST", "/api/challenges", { body: { goal, seed, code: stubCode(ticks, ops) }, token: author.token, at });
  assert.equal(r.status, 201, r.text);
  return r.json;
}
/** A result body whose stub replay measures `ticks` / `ops` (DNF_TICKS: did not finish). */
const answer = (ticks, ops) => ({ code: stubCode(ticks, ops) });
const me = async (p) => (await call("GET", "/api/players/me", { token: p.token })).json;

test("challenge lifecycle: create → listed → full view → answered (win) → closed, ELO updated", async () => {
  const author = await register("Author1");
  const challenger = await register("Challenger1");
  const ch = await makeChallenge(author);
  assert.equal(ch.authorName, "Author1");
  assert.equal(ch.status, "open");

  const list = await call("GET", "/api/challenges");
  assert.equal(list.status, 200);
  const listed = list.json.challenges.find((c) => c.id === ch.id);
  assert.ok(listed);
  assert.deepEqual(
    { goal: listed.goal, seed: listed.seed, authorTicks: listed.authorTicks, authorOps: listed.authorOps, authorName: listed.authorName, verified: listed.verified },
    { goal: "hay500", seed: 1234, authorTicks: 50_000, authorOps: 300, authorName: "Author1", verified: true },
  );
  assert.equal(listed.code, undefined, "the list does not carry code");

  const full = await call("GET", `/api/challenges/${ch.id}`);
  assert.equal(full.json.code, CODE);
  assert.equal(full.json.result, null);

  const res = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(40_000, 900), token: challenger.token });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.result, "win");
  assert.equal(res.json.verified, true);
  assert.equal(res.json.you.delta, 16);
  assert.equal(res.json.you.elo, 1016);
  assert.equal(res.json.author.delta, -16);
  assert.equal(res.json.author.elo, 984);
  assert.equal((await me(challenger)).elo, 1016);
  assert.equal((await me(author)).elo, 984);

  const closed = await call("GET", `/api/challenges/${ch.id}`);
  assert.equal(closed.json.status, "closed");
  assert.equal(closed.json.result.name, "Challenger1");
  assert.equal(closed.json.result.outcome, "win");
  const after = await call("GET", "/api/challenges");
  assert.ok(!after.json.challenges.some((c) => c.id === ch.id), "closed challenges are not listed");

  // One result per challenge.
  const third = await register("Third1");
  const again = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(1, 1), token: third.token });
  assert.equal(again.status, 409);
  assert.equal((await me(third)).elo, 1000);
});

test("ELO math: loss, tie → fewer ops, exact draw, DNF, unequal ratings", async () => {
  // loss: more ticks
  {
    const a = await register("EloA1");
    const b = await register("EloB1");
    const ch = await makeChallenge(a, { ticks: 50_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(50_001, 1), token: b.token });
    assert.equal(r.json.result, "loss");
    assert.equal(r.json.you.delta, -16);
    assert.equal((await me(a)).elo, 1016);
    assert.equal((await me(b)).elo, 984);
  }
  // equal ticks → fewer ops wins
  {
    const a = await register("EloA2");
    const b = await register("EloB2");
    const ch = await makeChallenge(a, { ticks: 50_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(50_000, 299), token: b.token });
    assert.equal(r.json.result, "win");
  }
  // exact tie → draw, equal ratings → no change
  {
    const a = await register("EloA3");
    const b = await register("EloB3");
    const ch = await makeChallenge(a, { ticks: 50_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(50_000, 300), token: b.token });
    assert.equal(r.json.result, "draw");
    assert.equal(r.json.you.delta, 0);
    assert.equal(r.json.author.delta, 0);
  }
  // did not finish → loss
  {
    const a = await register("EloA4");
    const b = await register("EloB4");
    const ch = await makeChallenge(a, { ticks: 199_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(DNF_TICKS, 5), token: b.token });
    assert.equal(r.status, 201);
    assert.equal(r.json.result, "loss");
  }
  // unequal ratings: a 1016 author (won before) vs a fresh 1000 player, then a draw
  {
    const a = await register("EloA5");
    const b = await register("EloB5");
    const c = await register("EloC5");
    const ch1 = await makeChallenge(b, { ticks: 60_000, ops: 10 });
    await call("POST", `/api/challenges/${ch1.id}/results`, { body: answer(50_000, 10), token: a.token }); // a 1016, b 984
    const ch2 = await makeChallenge(a, { ticks: 50_000, ops: 10 });
    const r = await call("POST", `/api/challenges/${ch2.id}/results`, { body: answer(50_000, 10), token: c.token });
    const expect = eloUpdate(1000, 1016, 0.5); // challenger c vs author a
    assert.equal(r.json.result, "draw");
    assert.equal(r.json.you.delta, expect.deltaA);
    assert.equal(expect.deltaA, 1); // 32 × (0.5 − 0.477) = 0.74 → 1
    assert.equal((await me(a)).elo, 1016 + expect.deltaB);
    assert.equal((await me(c)).elo, 1000 + expect.deltaA);
  }
});

test("self-challenge is rejected and leaves the challenge open", async () => {
  const a = await register("Selfie");
  const ch = await makeChallenge(a);
  const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: answer(1, 1), token: a.token });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /own challenge/);
  assert.equal((await call("GET", `/api/challenges/${ch.id}`)).json.status, "open");
  assert.equal((await me(a)).elo, 1000);
});

test("challenge / result validation and missing challenges", async () => {
  const a = await register("Valid1");
  const b = await register("Valid2");
  const good = { goal: "wood800", seed: 99, code: CODE, authorTicks: 80_000, authorOps: 500 };
  for (const patch of [{ goal: "gold200" }, { seed: -1 }, { seed: 1.5 }, { code: "" }, { code: "x".repeat(100_001) }]) {
    const r = await call("POST", "/api/challenges", { body: { ...good, ...patch }, token: a.token });
    assert.equal(r.status, 400, JSON.stringify(patch));
  }
  // v4 phase 2: claimed authorTicks / authorOps are accepted but ignored —
  // even nonsense — the stored numbers are the replay's.
  for (const patch of [{ authorTicks: 0 }, { authorTicks: 200_001 }, { authorOps: 0 }, { authorTicks: undefined, authorOps: undefined }]) {
    const r = await call("POST", "/api/challenges", { body: { ...good, ...patch }, token: a.token });
    assert.equal(r.status, 201, JSON.stringify(patch));
    assert.deepEqual([r.json.authorTicks, r.json.authorOps], [50_000, 300]);
  }
  // A replay that misses the goal: no challenge.
  const miss = await call("POST", "/api/challenges", { body: { ...good, code: stubCode(TICK_CAP + 1, 5) }, token: a.token });
  assert.equal(miss.status, 422);
  const ch = await makeChallenge(a);
  for (const body of [{ ticks: 10, ops: 1 }, { code: "" }, { code: 42 }]) {
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body, token: b.token });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await call("GET", `/api/challenges/${ch.id}`)).json.status, "open");
  assert.equal((await call("GET", "/api/challenges/999999")).status, 404);
  assert.equal((await call("GET", "/api/challenges/abc")).status, 404);
  assert.equal((await call("POST", "/api/challenges/999999/results", { body: answer(1, 1), token: b.token })).status, 404);
});

test("open challenges: newest first", async () => {
  const a = await register("Newest");
  const c1 = await makeChallenge(a, { seed: 1 });
  const c2 = await makeChallenge(a, { seed: 2 });
  const list = (await call("GET", "/api/challenges")).json.challenges;
  assert.ok(list.findIndex((c) => c.id === c2.id) < list.findIndex((c) => c.id === c1.id));
  assert.ok(list.length <= 50);
});

// ---------- misc HTTP ----------

test("unknown endpoints, wrong methods, bad bodies → JSON errors", async () => {
  const r404 = await call("GET", "/api/nope");
  assert.equal(r404.status, 404);
  assert.match(r404.headers.get("content-type"), /application\/json/);
  assert.equal(typeof r404.json.error, "string");
  assert.equal((await call("DELETE", "/api/challenges")).status, 405);
  assert.equal((await call("GET", "/api/auth/register")).status, 405);
  const big = await call("POST", "/api/auth/register", { body: JSON.stringify({ name: "x".repeat(300_000) }) });
  assert.equal(big.status, 413);
  const type = await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(type.status, 415);
  assert.equal((await call("GET", "/api/health")).json.ok, true);
});

test("static files from dist/ with SPA fallback", async () => {
  const idx = await call("GET", "/");
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get("content-type"), /text\/html/);
  assert.match(idx.text, /farmer/);
  const asset = await call("GET", "/assets/app-abc.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  assert.match(asset.headers.get("cache-control"), /immutable/);
  const spa = await call("GET", "/farmer/some/route");
  assert.equal(spa.status, 200);
  assert.match(spa.text, /farmer/);
  assert.equal((await call("GET", "/assets/missing.js")).status, 404);
  // Path traversal (raw, un-normalized request paths): never leaves dist/.
  for (const raw of ["/..%2f..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/%2e%2e/etc/passwd", "/../../../etc/passwd"]) {
    const body = await rawGet(raw);
    assert.ok(!body.includes("root:"), raw);
  }
});

test("rate limiter: N per window per key, then refuses until the window passes", () => {
  let t = 0;
  const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([rl.allow("a"), rl.allow("a"), rl.allow("a"), rl.allow("a")], [true, true, true, false]);
  assert.equal(rl.allow("b"), true);
  t = 1000;
  assert.equal(rl.allow("a"), true);
});

test("write endpoints answer 429 past the per-IP limit", async () => {
  const sub = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "rl.db"), distDir: null, rateLimit: { max: 3, windowMs: 60_000 } });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${sub.url}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `rl${i}` }) });
      codes.push(r.status);
      if (r.status === 429) {
        assert.ok(Number(r.headers.get("retry-after")) >= 1);
        assert.equal(typeof (await r.json()).error, "string");
      }
    }
    assert.deepEqual(codes, [201, 201, 201, 429, 429]);
    // reads are not limited
    assert.equal((await fetch(`${sub.url}/api/challenges`)).status, 200);
  } finally {
    await sub.close();
  }
});

test("the DB persists across a restart (same file)", async () => {
  const file = join(dir, "persist.db");
  const s1 = await startServer({ port: 0, host: "127.0.0.1", dbPath: file, distDir: null });
  const reg = await (await fetch(`${s1.url}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"name":"Keeper"}' })).json();
  await s1.close();
  const s2 = await startServer({ port: 0, host: "127.0.0.1", dbPath: file, distDir: null });
  try {
    const r = await fetch(`${s2.url}/api/players/me`, { headers: { Authorization: `Bearer ${reg.token}` } });
    assert.equal((await r.json()).name, "Keeper");
  } finally {
    await s2.close();
  }
});

// ---------- v4 phase 2: real replay verification (anti-cheat level 2) ----------

const onReal = (method, path, opts = {}) => call(method, path, { ...opts, at: srv.url });
const registerReal = (name) => register(name, srv.url);

test("arena: a doctored (too-fast) claim is corrected by the server's replay", async () => {
  const author = await registerReal("Replay-Author");
  const seed = 4242;
  const truth = await runSolo({ code: BOT_CODE.pro, goal: "hay500", seed });
  assert.equal(truth.reached, true);
  const r = await onReal("POST", "/api/challenges", { body: { goal: "hay500", seed, code: BOT_CODE.pro, authorTicks: 1, authorOps: 1 }, token: author.token });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.json.authorTicks, r.json.authorOps], [truth.ticks, truth.ops], "stored = server-measured");
  assert.deepEqual(r.json.claimed, { ticks: 1, ops: 1 });
  assert.equal(r.json.corrected, true);
  assert.equal(r.json.verified, true);
  const row = srv.db.raw.prepare("SELECT author_ticks, author_ops, verified FROM challenges WHERE id = ?").get(r.json.id);
  assert.deepEqual({ ...row }, { author_ticks: truth.ticks, author_ops: truth.ops, verified: 1 });
  const listed = (await onReal("GET", "/api/challenges")).json.challenges.find((c) => c.id === r.json.id);
  assert.equal(listed.verified, true);
  assert.equal(listed.authorTicks, truth.ticks);

  // The challenger claims an impossible 1-tick win with a slower program: the
  // replay measures the real run, so it is a loss and ELO moves accordingly.
  const challenger = await registerReal("Replay-Challenger");
  const slow = await runSolo({ code: BOT_CODE.rookie, goal: "hay500", seed });
  assert.ok(slow.ticks > truth.ticks);
  const a = await onReal("POST", `/api/challenges/${r.json.id}/results`, { body: { ticks: 1, ops: 1, code: BOT_CODE.rookie }, token: challenger.token });
  assert.equal(a.status, 201, a.text);
  assert.equal(a.json.result, "loss");
  assert.deepEqual([a.json.you.ticks, a.json.you.ops], [slow.ticks, slow.ops]);
  assert.deepEqual(a.json.you.claimed, { ticks: 1, ops: 1 });
  assert.equal(a.json.you.delta, -16);
  assert.equal(a.json.author.delta, 16);
  const res = srv.db.raw.prepare("SELECT ticks, ops, verified FROM challenge_results WHERE challenge_id = ?").get(r.json.id);
  assert.deepEqual({ ...res }, { ticks: slow.ticks, ops: slow.ops, verified: 1 });
});

test("arena: a program that doesn't reach the goal is rejected (422); hostile code too", async () => {
  const p = await registerReal("Replay-Lazy");
  const before = (await onReal("GET", "/api/challenges")).json.challenges.length;
  for (const code of [
    "harvest();",
    "nope();",
    "const fs = await import('node:fs'); fs.writeFileSync('/tmp/pwned', 'x');",
    "Function('return import(\"node:child_process\")')();",
    "globalThis.process.exit(1);",
  ]) {
    const r = await onReal("POST", "/api/challenges", { body: { goal: "wood800", seed: 5, code, authorTicks: 30_000, authorOps: 100 }, token: p.token });
    assert.equal(r.status, 422, `${code} → ${r.status} ${r.text}`);
    assert.match(r.json.error, /did not reach the goal/);
  }
  assert.equal((await onReal("GET", "/api/challenges")).json.challenges.length, before, "nothing was stored");
  assert.equal((await onReal("GET", "/api/health")).json.ok, true, "the API process is unaffected");

  // A challenger whose program never finishes still answers (DNF, a loss).
  const author = await registerReal("Replay-Author2");
  const ch = await onReal("POST", "/api/challenges", { body: { goal: "hay500", seed: 6, code: BOT_CODE.pro }, token: author.token });
  assert.equal(ch.status, 201, ch.text);
  const r = await onReal("POST", `/api/challenges/${ch.json.id}/results`, { body: { ticks: 10, ops: 1, code: "harvest();" }, token: p.token });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.result, "loss");
  assert.equal(r.json.you.ticks, DNF_TICKS);
  assert.equal(r.json.you.reached, false);
});

test("an infinite loop is rejected by the wall-clock timeout without hanging (API stays up)", async () => {
  const sub = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "timeout.db"), distDir: null, verify: { timeoutMs: 1000 } });
  try {
    const p = await register("Looper", sub.url);
    // Catastrophic regex backtracking inside a callback: one synchronous call
    // that never yields, so no tick cap or loop guard can stop it — only
    // terminating the worker can.
    const loop = "[1].forEach(() => /(a+)+b/.test('a'.repeat(48)));";
    const t0 = Date.now();
    const [r, health] = await Promise.all([
      call("POST", "/api/challenges", { body: { goal: "hay500", seed: 1, code: loop }, token: p.token, at: sub.url }),
      // While the worker spins, the API process keeps answering.
      new Promise((ok) => setTimeout(ok, 200)).then(() => call("GET", "/api/health", { at: sub.url })),
    ]);
    const ms = Date.now() - t0;
    assert.equal(r.status, 422, r.text);
    assert.match(r.json.error, /could not verify.*longer than 1 s/);
    assert.ok(ms < 5000, `answered after ${ms} ms`);
    assert.equal(health.json.ok, true);
    assert.equal(sub.verifier.stats().running, 0, "the worker was terminated");
    // A maze or dino score with the same trick is rejected the same way.
    const d = await call("POST", "/api/scores", { body: { category: "dino", value: 100, code: loop }, token: p.token, at: sub.url });
    assert.equal(d.status, 422, d.text);
    assert.match(d.json.error, /could not verify/);
    const m = await call("POST", "/api/scores", {
      body: { category: "maze", level: 1, ticks: 100, ops: 10, seed: 1, size: 6, sx: 0, sy: 0, code: loop },
      token: p.token,
      at: sub.url,
    });
    assert.equal(m.status, 422, m.text);
    // The verifier still works afterwards.
    const ok = await call("POST", "/api/challenges", { body: { goal: "hay500", seed: 2, code: BOT_CODE.pro }, token: p.token, at: sub.url });
    assert.equal(ok.status, 201, ok.text);
  } finally {
    await sub.close();
  }
});

/** Solve a maze on a small "player farm" the way the page does → its onRecord event. */
const MAZE_SOLVER = `use_item(Items.Fertilizer);
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
async function localMazeRecord(code = MAZE_SOLVER, { n = 8, x = 3, y = 1, level = 2 } = {}) {
  const s = W.createGame();
  s.unlocks.Expand = WORLD_SIZES.indexOf(n);
  s.size = n;
  s.tiles = Array.from({ length: n * n }, W.newTile);
  Object.assign(s.unlocks, { Senses: 1, Plant: 1, Carrots: 1, Pumpkins: 1, Fertilizer: 1, Mazes: level });
  s.items.Fertilizer = 1;
  [s.drone.x, s.drone.y] = [x, y];
  W.droneTile(s).entity = { type: "Bush", progress: 1 };
  let t = 0;
  let ev = null;
  const rt = createRuntime({
    getState: () => s,
    now: () => t,
    sleep: (ms) => ((t += ms), new Promise((r) => setImmediate(r))),
    yieldFn: () => new Promise((r) => setImmediate(r)),
    rng: mulberry32(77),
    onRecord: (e) => (ev = e),
  });
  await rt.run(code);
  assert.ok(ev, "the local run set a record");
  return ev;
}

test("maze: a fake tick count is stored with the server-measured values (✓ verified)", async () => {
  const p = await registerReal("Maze-Faker");
  const ev = await localMazeRecord();
  const a = ev.attempt;
  const body = { category: "maze", level: a.level, ticks: 1, ops: 1, seed: a.seed, size: a.size, sx: a.sx, sy: a.sy, code: ev.code };
  const r = await onReal("POST", "/api/scores", { body, token: p.token });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.json.ticks, r.json.ops], [a.ticks, a.ops], "the replay's numbers replace the claim");
  assert.deepEqual(r.json.claimed, { ticks: 1, ops: 1 });
  assert.equal(r.json.corrected, true);
  assert.equal(r.json.verified, true);
  assert.equal(r.json.replay, "spawn");
  const row = srv.db.raw.prepare("SELECT ticks, ops, verified, size, sx, sy, code FROM scores WHERE id = ?").get(r.json.id);
  assert.deepEqual({ ...row }, { ticks: a.ticks, ops: a.ops, verified: 1, size: a.size, sx: a.sx, sy: a.sy, code: ev.code });
  const lb = await onReal("GET", `/api/leaderboard?category=maze&level=${a.level}`);
  const mine = lb.json.entries.find((e) => e.playerId === p.playerId);
  assert.deepEqual([mine.ticks, mine.ops, mine.verified], [a.ticks, a.ops, true]);

  // An honest claim is stored as is (corrected: false).
  const honest = await onReal("POST", "/api/scores", { body: { ...body, ticks: a.ticks, ops: a.ops }, token: p.token });
  assert.equal(honest.status, 201, honest.text);
  assert.equal(honest.json.corrected, false);
});

test("maze: code that doesn't solve the recorded maze is rejected (422)", async () => {
  const p = await registerReal("Maze-Bluffer");
  const ev = await localMazeRecord();
  const a = ev.attempt;
  const base = { category: "maze", level: a.level, ticks: a.ticks, ops: a.ops, seed: a.seed, size: a.size, sx: a.sx, sy: a.sy };
  for (const code of ["use_item(Items.Fertilizer);", "use_item(Items.Fertilizer); while (true) move(North);", "nope();"]) {
    const r = await onReal("POST", "/api/scores", { body: { ...base, code }, token: p.token });
    assert.equal(r.status, 422, `${code} → ${r.status} ${r.text}`);
    assert.match(r.json.error, /maze score rejected/);
  }
  // Unverified (code-less) maze submissions are no longer accepted at all.
  const none = await onReal("POST", "/api/scores", { body: base, token: p.token });
  assert.equal(none.status, 400);
  const n = srv.db.raw.prepare("SELECT COUNT(*) AS n FROM scores WHERE player_id = ?").get(p.playerId).n;
  assert.equal(n, 0);
});

// Waits for the dinosaur to grow, then cuts it wherever the sweep meets it.
const DINO_SWEEP = `const n = get_world_size();
while (get_time() < 100) spin_in_place();
for (let x = 0; x < n; x++) {
  for (let y = 0; y < n; y++) {
    if (get_entity_type() === Entities.Dinosaur) harvest();
    move(North);
  }
  move(East);
}
`;

test("dino: a known program gets the server-measured Bone; tampered client numbers are ignored", async () => {
  const p = await registerReal("Dino-Faker");
  const truth = await verifyDino({ code: DINO_SWEEP });
  assert.ok(truth.bone >= 27, JSON.stringify(truth));
  const row = (id) => ({ ...srv.db.raw.prepare("SELECT category, level, value, ticks, ops, seed, size, sx, sy, verified, code FROM scores WHERE id = ?").get(id) });
  const { seed, size, x, y } = DINO_BENCHMARK;
  const expected = { category: "dino", level: null, value: truth.bone, ticks: truth.ticks, ops: truth.ops, seed, size, sx: x, sy: y, verified: 1, code: DINO_SWEEP };
  const claims = [{}, { value: DINO_MAX_BONE, ticks: 1, ops: 1 }, { value: 1, seed: 5, size: 3, sx: 0, sy: 0, verified: false }, { value: -5, ticks: "x" }];
  for (const claim of claims) {
    const r = await onReal("POST", "/api/scores", { body: { category: "dino", code: DINO_SWEEP, ...claim }, token: p.token });
    assert.equal(r.status, 201, `${JSON.stringify(claim)} → ${r.text}`);
    assert.deepEqual([r.json.value, r.json.ticks, r.json.ops, r.json.verified], [truth.bone, truth.ticks, truth.ops, true]);
    assert.deepEqual(r.json.claimed, claim.value > 0 ? { value: claim.value } : null);
    assert.equal(r.json.code, undefined);
    assert.deepEqual(row(r.json.id), expected, "stored = server-measured");
  }
  const mine = (await onReal("GET", "/api/leaderboard?category=dino")).json.entries.find((e) => e.playerId === p.playerId);
  assert.deepEqual([mine.value, mine.ticks, mine.ops, mine.seed, mine.verified], [truth.bone, truth.ticks, truth.ops, seed, true]);
  assert.equal(mine.code, undefined);
});

test("dino: no code is a 400; a program that harvests no dinosaur on the benchmark is a 422; nothing is stored", async () => {
  const p = await registerReal("Dino-Bluffer");
  const none = await onReal("POST", "/api/scores", { body: { category: "dino", value: 5000, ticks: 100, ops: 10 }, token: p.token });
  assert.equal(none.status, 400);
  assert.match(none.json.error, /code/);
  for (const [code, why] of [
    ["harvest();", /ended without harvesting/],
    ["while (true) spin_in_place();", /3,000 world ticks/],
    ["nope();", /failed: .*nope/],
    ["let x = ;", /failed: /],
    ["while (true) { move(North); for (let i = 0; i < 200; i++) get_pos_x(); }", /too many API calls/],
    ["const fs = await import('node:fs'); fs.writeFileSync('/tmp/pwned', 'x');", /failed: /],
    ["Array.prototype.splice = () => ({ length: 144 }); harvest();", /failed: /],
  ]) {
    const r = await onReal("POST", "/api/scores", { body: { category: "dino", value: 5000, code }, token: p.token });
    assert.equal(r.status, 422, `${code} → ${r.status} ${r.text}`);
    assert.match(r.json.error, /^dino score rejected: /);
    assert.match(r.json.error, why, code);
  }
  assert.equal(srv.db.raw.prepare("SELECT COUNT(*) AS n FROM scores WHERE player_id = ?").get(p.playerId).n, 0);
});

test("rate limit is per player token: two tokens from one IP each get their own bucket", async () => {
  const sub = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "rl-token.db"), distDir: null, rateLimit: { max: 3, windowMs: 60_000 }, verifier: stubVerifier() });
  try {
    const a = await register("Bucket-A", sub.url); // IP bucket: 1
    const b = await register("Bucket-B", sub.url); // IP bucket: 2
    const post = (p) => call("POST", "/api/scores", { body: dinoScore(5), token: p.token, at: sub.url }).then((r) => r.status);
    const codesA = [await post(a), await post(a), await post(a), await post(a)];
    assert.deepEqual(codesA, [201, 201, 201, 429], "A's own bucket runs out");
    const codesB = [await post(b), await post(b), await post(b), await post(b)];
    assert.deepEqual(codesB, [201, 201, 201, 429], "B is not affected by A (same IP)");
    // Register is still per IP (2 used above), and so are unknown tokens.
    const reg = [
      (await call("POST", "/api/auth/register", { body: { name: "Bucket-C" }, at: sub.url })).status,
      (await call("POST", "/api/auth/register", { body: { name: "Bucket-D" }, at: sub.url })).status,
    ];
    assert.deepEqual(reg, [201, 429]);
    assert.equal((await call("POST", "/api/scores", { body: dinoScore(5), token: "c".repeat(64), at: sub.url })).status, 429);
  } finally {
    await sub.close();
  }
});

test("verifier: busy queue, memory bombs and malformed jobs fail cleanly", async () => {
  const v = createVerifier({ timeoutMs: 5000, maxConcurrent: 1, maxQueue: 0, resourceLimits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 8 } });
  try {
    const bomb = "const a = []; [1].forEach(() => { for (let i = 0; i < 1e9; i++) a.push('x'.repeat(64) + i); });";
    const [first, second] = await Promise.all([
      v.verify({ kind: "arena", code: bomb, goal: "hay500", seed: 1 }),
      v.verify({ kind: "arena", code: "harvest()", goal: "hay500", seed: 1 }),
    ]);
    assert.deepEqual([first.ok, first.code], [false, "crash"]);
    assert.match(first.error, /memory/);
    assert.deepEqual([second.ok, second.code], [false, "busy"]);
    const bad = await v.verify({ kind: "chess" });
    assert.deepEqual([bad.ok, bad.code], [false, "crash"]);
    const ok = await v.verify({ kind: "arena", code: "harvest()", goal: "hay500", seed: 1 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.reached, false);
  } finally {
    await v.close();
  }
});

test("a phase-1 DB file is upgraded in place (old rows count as unverified)", async () => {
  const file = join(dir, "phase1.db");
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, token_hash TEXT NOT NULL UNIQUE, elo INTEGER NOT NULL DEFAULT 1000, created_at INTEGER NOT NULL);
    CREATE TABLE scores (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), category TEXT NOT NULL, level INTEGER, ticks INTEGER, ops INTEGER, value INTEGER, seed INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE challenges (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES players(id), goal TEXT NOT NULL, seed INTEGER NOT NULL, code TEXT NOT NULL, author_ticks INTEGER NOT NULL, author_ops INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
    CREATE TABLE challenge_results (id INTEGER PRIMARY KEY, challenge_id INTEGER NOT NULL UNIQUE REFERENCES challenges(id), player_id INTEGER NOT NULL REFERENCES players(id), ticks INTEGER NOT NULL, ops INTEGER NOT NULL, code TEXT NOT NULL, outcome TEXT NOT NULL, elo_delta INTEGER NOT NULL, created_at INTEGER NOT NULL);
    INSERT INTO players (name, token_hash, created_at) VALUES ('Oldie', '${hashToken("d".repeat(64))}', 1);
    INSERT INTO scores (player_id, category, level, ticks, ops, created_at) VALUES (1, 'maze', 1, 5, 1, 1);
    INSERT INTO scores (player_id, category, value, created_at) VALUES (1, 'dino', 62208, 1);
    INSERT INTO challenges (author_id, goal, seed, code, author_ticks, author_ops, created_at) VALUES (1, 'hay500', 1, 'x', 1, 1, 1);
  `);
  old.close();
  const db = await openDb(file, { now: () => 2 }); // (its challenge is from time 1: not expired yet)
  try {
    assert.deepEqual(db.leaderboard("maze", 1), [], "the trust-based maze row is not on the verified board");
    assert.equal(db.openChallenges()[0].verified, 0);
    const id = db.addScore(1, { category: "maze", level: 1, ticks: 900, ops: 9, value: null, seed: 3, size: 6, sx: 0, sy: 0, code: "c", verified: true });
    assert.equal(db.leaderboard("maze", 1)[0].id, id);
    // v5 phase 2: the same for dino. The old row is kept, only not ranked.
    assert.deepEqual(db.leaderboard("dino", null), [], "the trust-based dino row is not on the verified board");
    const d = db.addScore(1, { category: "dino", level: null, ticks: 900, ops: 9, value: 48, seed: 4188, size: 12, sx: 6, sy: 6, code: "c", verified: true });
    assert.deepEqual(db.leaderboard("dino", null).map((r) => [r.id, r.value]), [[d, 48]]);
    assert.equal(db.raw.prepare("SELECT value FROM scores WHERE category = 'dino' AND verified = 0").get().value, 62208);
  } finally {
    db.close();
  }
});

test("a full verifier queue answers 429 + Retry-After (not 503, which the client reads as offline)", async () => {
  const sub = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "busy.db"), distDir: null, verify: { timeoutMs: 1000, maxConcurrent: 1, maxQueue: 0 } });
  try {
    const p = await register("Busy-Bee", sub.url);
    const spin = "[1].forEach(() => /(a+)+b/.test('a'.repeat(48)));";
    const first = call("POST", "/api/challenges", { body: { goal: "hay500", seed: 1, code: spin }, token: p.token, at: sub.url });
    await new Promise((ok) => setTimeout(ok, 150)); // the first replay is running now
    const second = await call("POST", "/api/challenges", { body: { goal: "hay500", seed: 2, code: BOT_CODE.pro }, token: p.token, at: sub.url });
    assert.equal(second.status, 429, second.text);
    assert.match(second.json.error, /busy/);
    assert.equal(second.headers.get("retry-after"), "5");
    assert.equal((await first).status, 422);
  } finally {
    await sub.close();
  }
});

// ---------- v5: expiry, history, deploy config ----------

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);

/** A stub-verifier server with a clock the test moves: fn({ at, clock, db, post, history }). */
async function withClock(name, fn, verifier = stubVerifier()) {
  const clock = { t: T0 };
  const sub = await startServer({ port: 0, dbPath: join(dir, `${name}.db`), distDir: null, rateLimit: { max: 10_000 }, verifier, now: () => clock.t });
  const at = sub.url;
  const post = (p, id, ticks, ops = 300) => call("POST", `/api/challenges/${id}/results`, { body: answer(ticks, ops), token: p.token, at });
  const history = async (p) => {
    const r = await call("GET", "/api/players/me/history", { token: p.token, at });
    assert.equal(r.status, 200, r.text);
    return r.json.events;
  };
  try {
    await fn({ at, clock, db: sub.db, post, history });
  } finally {
    await sub.close();
  }
}

test("challenge expiry: an 8-day-old challenge is unlisted, rejects results (410) and is 'expired' in the author's history", () =>
  withClock("expiry", async ({ at, clock, post, history }) => {
    const a = await register("Exp-A", at);
    const b = await register("Exp-B", at);
    const ch = await makeChallenge(a, { at });
    assert.equal(ch.expiresAt, T0 + 7 * DAY);
    const listed = async () => (await call("GET", "/api/challenges", { at })).json.challenges.some((c) => c.id === ch.id);

    clock.t = T0 + 7 * DAY - 1; // the last millisecond
    assert.equal(await listed(), true);
    assert.deepEqual(await history(a), [], "an open challenge is not a finished event");
    clock.t = T0 + 7 * DAY; // exactly 7 days: expired
    assert.equal(await listed(), false);

    clock.t = T0 + 8 * DAY;
    assert.equal(await listed(), false);
    const full = await call("GET", `/api/challenges/${ch.id}`, { at });
    assert.equal(full.json.status, "expired");
    assert.equal(full.json.result, null);
    const r = await post(b, ch.id, 1);
    assert.equal(r.status, 410);
    assert.match(r.json.error, /expired/);
    for (const p of [a, b]) assert.equal((await call("GET", "/api/players/me", { token: p.token, at })).json.elo, 1000);

    const [ev, ...rest] = await history(a);
    assert.deepEqual(rest, []);
    assert.deepEqual(ev, {
      challengeId: ch.id,
      role: "author",
      opponentId: null,
      opponentName: null,
      goal: "hay500",
      seed: 1234,
      myTicks: 50_000,
      myOps: 300,
      opponentTicks: null,
      opponentOps: null,
      outcome: "expired",
      eloDelta: 0,
      createdAt: T0,
      closedAt: T0 + 7 * DAY,
    });
    assert.deepEqual(await history(b), [], "only the author sees it");
  }));

test("challenge expiry: an answered challenge stays closed (409), never expired", () =>
  withClock("expiry2", async ({ at, clock, post, history }) => {
    const a = await register("Exp-C", at);
    const b = await register("Exp-D", at);
    const ch = await makeChallenge(a, { at });
    clock.t = T0 + 7 * DAY - 1;
    assert.equal((await post(b, ch.id, 40_000)).status, 201, "still answerable in the last millisecond");
    clock.t = T0 + 30 * DAY;
    assert.equal((await call("GET", `/api/challenges/${ch.id}`, { at })).json.status, "closed");
    assert.equal((await post(await register("Exp-E", at), ch.id, 1)).status, 409);
    assert.deepEqual((await history(a)).map((e) => e.outcome), ["lose"]);
  }));

test("challenge expiry: expiring while the replay runs rejects the result too (checked again in the write)", () => {
  const stubbed = stubVerifier();
  const hook = { on: null };
  const verifier = {
    verify: async (job) => {
      hook.on?.();
      return stubbed.verify(job);
    },
    close: async () => {},
  };
  return withClock("expiry3", async ({ at, clock, db, post }) => {
    const a = await register("Exp-F", at);
    const b = await register("Exp-G", at);
    const ch = await makeChallenge(a, { at });
    clock.t = T0 + 7 * DAY - 1;
    hook.on = () => (clock.t = T0 + 7 * DAY);
    const r = await post(b, ch.id, 1);
    assert.equal(r.status, 410, r.text);
    assert.equal(db.resultFor(ch.id), null);
    assert.equal(db.playerById(b.playerId).elo, 1000);
  }, verifier);
});

test("history: shape, both sides, and the ELO deltas of win / lose / draw", () =>
  withClock("history", async ({ at, clock, db, post, history }) => {
    const a = await register("His-A", at);
    const b = await register("His-B", at);
    const play = async (ticks) => {
      const ch = await makeChallenge(a, { at, goal: "wood800", seed: 9 });
      clock.t += 1000;
      const r = await post(b, ch.id, ticks);
      assert.equal(r.status, 201, r.text);
      clock.t += 1000;
      return { ch, r: r.json };
    };
    // b (challenger): win, lose (DNF), draw. Expected deltas from the ratings at that moment.
    const ratings = { a: 1000, b: 1000 };
    const expected = [];
    const games = [];
    for (const [ticks, score] of [[40_000, 1], [DNF_TICKS, 0], [50_000, 0.5]]) {
      const e = eloUpdate(ratings.b, ratings.a, score);
      expected.push({ b: e.deltaA, a: e.deltaB });
      ratings.b = e.ratingA;
      ratings.a = e.ratingB;
      games.push(await play(ticks));
    }
    assert.deepEqual(expected[0], { b: 16, a: -16 });
    assert.ok(expected[1].b < -16, "a 1016 player loses more to a 984 one");

    const ha = await history(a);
    const hb = await history(b);
    // newest first
    assert.deepEqual(ha.map((e) => e.challengeId), games.map((g) => g.ch.id).reverse());
    assert.deepEqual(ha.map((e) => e.outcome), ["draw", "win", "lose"]);
    assert.deepEqual(hb.map((e) => e.outcome), ["draw", "lose", "win"]);
    assert.deepEqual(ha.map((e) => e.eloDelta), expected.map((e) => e.a).reverse());
    assert.deepEqual(hb.map((e) => e.eloDelta), expected.map((e) => e.b).reverse());
    // The deltas add up to the stored ratings, and match what the answer said.
    const sum = (h) => h.reduce((n, e) => n + e.eloDelta, 0);
    assert.equal(db.playerById(a.playerId).elo, 1000 + sum(ha));
    assert.equal(db.playerById(b.playerId).elo, 1000 + sum(hb));
    assert.deepEqual(hb.map((e) => e.eloDelta), games.map((g) => g.r.you.delta).reverse());
    assert.deepEqual(ha.map((e) => e.eloDelta), games.map((g) => g.r.author.delta).reverse());

    // Full shape, from both sides (the DNF game).
    const g = games[1].ch;
    const common = { challengeId: g.id, goal: "wood800", seed: 9, createdAt: g.createdAt, closedAt: g.createdAt + 1000 };
    assert.deepEqual(ha[1], {
      ...common, role: "author", opponentId: b.playerId, opponentName: "His-B",
      myTicks: 50_000, myOps: 300, opponentTicks: DNF_TICKS, opponentOps: 300, outcome: "win", eloDelta: expected[1].a,
    });
    assert.deepEqual(hb[1], {
      ...common, role: "challenger", opponentId: a.playerId, opponentName: "His-A",
      myTicks: DNF_TICKS, myOps: 300, opponentTicks: 50_000, opponentOps: 300, outcome: "lose", eloDelta: expected[1].b,
    });

    // The result row carries both deltas.
    const full = (await call("GET", `/api/challenges/${g.id}`, { at })).json.result;
    assert.deepEqual([full.eloDelta, full.authorEloDelta], [expected[1].b, expected[1].a]);
  }));

test("history: auth required, GET only, only your own events, latest 20 by closing time", () =>
  withClock("history2", async ({ at, clock, post, history }) => {
    const none = await call("GET", "/api/players/me/history", { at });
    assert.equal(none.status, 401);
    assert.equal(typeof none.json.error, "string");
    assert.equal((await call("GET", "/api/players/me/history", { token: "a".repeat(64), at })).status, 401);
    const a = await register("Lim-A", at);
    const b = await register("Lim-B", at);
    const c = await register("Lim-C", at);
    assert.equal((await call("POST", "/api/players/me/history", { body: {}, token: a.token, at })).status, 405);
    assert.deepEqual(await history(a), []);

    const old = await makeChallenge(a, { at }); // posted first, will expire in between
    const late = await makeChallenge(a, { at, seed: 2 }); // answered last, although posted early
    const ids = [];
    clock.t = T0 + 6 * DAY;
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
      const ch = await makeChallenge(a, { at });
      ids.push(ch.id);
    }
    assert.equal((await post(b, late.id, 40_000)).status, 201);
    clock.t = T0 + 6 * DAY + 1;
    for (const id of ids) {
      clock.t += 1;
      assert.equal((await post(b, id, 40_000)).status, 201);
    }
    clock.t = T0 + 8 * DAY; // `old` expired at T0 + 7 d, after all the answers
    const h = await history(a);
    assert.equal(h.length, HISTORY_LIMIT);
    assert.deepEqual(h.map((e) => e.challengeId), [old.id, ...ids.reverse().slice(0, HISTORY_LIMIT - 1)]);
    assert.equal(h[0].outcome, "expired");
    assert.ok((await history(b)).every((e) => e.role === "challenger" && e.opponentName === "Lim-A" && e.outcome === "win"));
    assert.deepEqual(await history(c), []);
    assert.equal(CHALLENGE_TTL_MS, 7 * DAY);
  }));

test("a v4 DB file is upgraded in place: the author's ELO delta of old results is filled in", async () => {
  const file = join(dir, "v4.db");
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, token_hash TEXT NOT NULL UNIQUE, elo INTEGER NOT NULL DEFAULT 1000, created_at INTEGER NOT NULL);
    CREATE TABLE challenges (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES players(id), goal TEXT NOT NULL, seed INTEGER NOT NULL, code TEXT NOT NULL, author_ticks INTEGER NOT NULL, author_ops INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE challenge_results (id INTEGER PRIMARY KEY, challenge_id INTEGER NOT NULL UNIQUE REFERENCES challenges(id), player_id INTEGER NOT NULL REFERENCES players(id), ticks INTEGER NOT NULL, ops INTEGER NOT NULL, code TEXT NOT NULL, outcome TEXT NOT NULL, elo_delta INTEGER NOT NULL, created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
    INSERT INTO players (name, token_hash, elo, created_at) VALUES ('Au', 'h1', 984, 1), ('Ch', 'h2', 1016, 1);
    INSERT INTO challenges (author_id, goal, seed, code, author_ticks, author_ops, status, created_at) VALUES (1, 'hay500', 1, 'x', 900, 9, 'closed', 5);
  `);
  const insert = "INSERT INTO challenge_results (challenge_id, player_id, ticks, ops, code, outcome, elo_delta, created_at) VALUES (?, 2, 800, 8, 'x', 'win', 16, ?)";
  old.prepare(insert).run(1, 6);
  old.close();
  let db = await openDb(file);
  try {
    assert.deepEqual(db.history(1).map((e) => [e.outcome, e.elo_delta]), [["lose", -16]]);
    assert.deepEqual(db.history(2).map((e) => [e.outcome, e.elo_delta]), [["win", 16]]);
    // Rollback: the v4 server's INSERT (no author_elo_delta) still works on this file …
    db.raw.exec("INSERT INTO challenges (author_id, goal, seed, code, author_ticks, author_ops, status, created_at) VALUES (1, 'hay500', 1, 'x', 900, 9, 'closed', 7)");
    db.raw.prepare(insert).run(2, 8);
  } finally {
    db.close();
  }
  // … and the next v5 start fills those rows in too.
  db = await openDb(file);
  try {
    assert.deepEqual(db.history(1).map((e) => e.elo_delta), [-16, -16]);
  } finally {
    db.close();
  }
});

test("`node server/index.js`: FARMER_DB and PORT are respected, HOST defaults to 127.0.0.1, SIGTERM exits 0", async () => {
  const dbPath = join(dir, "fresh", "data", "env.db"); // the directories do not exist yet
  const run = async (env, fn) => {
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !["HOST", "PORT", "FARMER_DB", "FARMER_DIST", "TRUST_PROXY", "NODE_TEST_CONTEXT"].includes(k)));
    const child = spawn(process.execPath, [fileURLToPath(new URL("./index.js", import.meta.url))], {
      cwd: dir,
      env: { ...base, PORT: "0", FARMER_DB: dbPath, ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    try {
      let out = "";
      for await (const chunk of child.stdout) {
        out += chunk;
        if (out.includes("\n")) break;
      }
      const m = /listening on (http:\/\/([^:]+):(\d+)) \(db (.+)\)/.exec(out);
      assert.ok(m, out);
      await fn({ url: m[1], host: m[2], port: Number(m[3]), db: m[4] });
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      assert.deepEqual(await exited, [0, null]);
    } finally {
      child.kill("SIGKILL");
    }
  };
  let token;
  await run({}, async ({ url, host, db }) => {
    assert.equal(host, "127.0.0.1");
    assert.equal(db, dbPath);
    assert.equal((await call("GET", "/api/health", { at: url })).json.ok, true);
    token = (await register("Env-Player", url)).token;
    assert.ok(existsSync(dbPath));
  });
  // Same file, all interfaces: the player is still there.
  await run({ HOST: "0.0.0.0" }, async ({ url, host, port }) => {
    assert.equal(host, "localhost");
    assert.equal((await call("GET", "/api/players/me", { token, at: url })).json.name, "Env-Player");
    assert.equal((await call("GET", "/api/health", { at: `http://127.0.0.1:${port}` })).status, 200);
  });
  const raw = new DatabaseSync(dbPath);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM players").get().n, 1);
  raw.close();
});
