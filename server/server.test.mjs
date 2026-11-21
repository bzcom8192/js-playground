// JS Farmer Online server tests (node --test). Each test file run gets its
// own temp SQLite file; the server listens on an ephemeral port.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { startServer } from "./index.js";
import { createRateLimiter } from "./app.js";
import { hashToken } from "./db.js";
import { DINO_MAX_BONE, DNF_TICKS, eloUpdate } from "../src/farmer/onlineRules.js";

let dir;
let srv;
let base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "farmer-online-"));
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>farmer</title>");
  writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");
  srv = await startServer({ port: 0, host: "127.0.0.1", dbPath: join(dir, "test.db"), distDir: dist, rateLimit: { max: 10_000, windowMs: 60_000 } });
  base = srv.url;
});

after(async () => {
  await srv?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
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
async function register(name = `p${++nameSeq}-${Date.now() % 100000}`) {
  const r = await call("POST", "/api/auth/register", { body: { name } });
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
  const row = srv.db.raw.prepare("SELECT token_hash FROM players WHERE id = ?").get(r.json.playerId);
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
    { category: "dino", level: 1, value: 10 }, // dino has no level
    { category: "dino", value: 0 },
    { category: "dino", value: DINO_MAX_BONE + 1 },
    { category: "dino" },
    { category: "dino", value: 10, ticks: -1 },
  ];
  for (const body of bad) {
    const r = await call("POST", "/api/scores", { body, token });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
    assert.equal(typeof r.json.error, "string");
  }
  assert.equal((await call("POST", "/api/scores", { body: "{not json", token })).status, 400);
  assert.equal((await call("POST", "/api/scores", { body: [1, 2], token })).status, 400);
  const ok = await call("POST", "/api/scores", { body: { category: "maze", level: 1, ticks: 2400, ops: 12, seed: 7 }, token });
  assert.equal(ok.status, 201, ok.text);
  const dino = await call("POST", "/api/scores", { body: { category: "dino", value: DINO_MAX_BONE }, token });
  assert.equal(dino.status, 201, dino.text);
});

test("leaderboard: best entry per player, maze = fewest ticks then ops, dino = most Bone", async () => {
  const a = await register("LB-A");
  const b = await register("LB-B");
  const c = await register("LB-C");
  const post = (p, body) => call("POST", "/api/scores", { body, token: p.token }).then((r) => assert.equal(r.status, 201, r.text));
  // Level 2 is only used by this test.
  await post(a, { category: "maze", level: 2, ticks: 5000, ops: 40 });
  await post(a, { category: "maze", level: 2, ticks: 3000, ops: 50 }); // a's best
  await post(a, { category: "maze", level: 2, ticks: 9000, ops: 10 });
  await post(b, { category: "maze", level: 2, ticks: 3000, ops: 45 }); // same ticks, fewer ops → ahead of a
  await post(c, { category: "maze", level: 2, ticks: 2000, ops: 900 });
  await post(c, { category: "maze", level: 3, ticks: 100, ops: 1 }); // other level: ignored
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

  const d = await register("LB-D");
  for (const [p, v] of [[a, 50], [a, 400], [b, 400], [d, 90], [d, 12]]) await post(p, { category: "dino", value: v });
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

  for (const q of ["category=maze", "category=maze&level=9", "category=dino&level=1", "category=x", ""]) {
    const r = await call("GET", `/api/leaderboard?${q}`);
    assert.equal(r.status, 400, q);
  }
});

test("leaderboard is capped at 50 entries", async () => {
  for (let i = 0; i < 53; i++) {
    const p = await register(`cap${i}`);
    const r = await call("POST", "/api/scores", { body: { category: "maze", level: 3, ticks: 10_000 + i, ops: 5 }, token: p.token });
    assert.equal(r.status, 201);
  }
  const lb = await call("GET", "/api/leaderboard?category=maze&level=3");
  assert.equal(lb.json.entries.length, 50);
});

// ---------- challenges + ELO ----------

const CODE = "while (true) { harvest(); }";

async function makeChallenge(author, { ticks = 50_000, ops = 300, goal = "hay500", seed = 1234 } = {}) {
  const r = await call("POST", "/api/challenges", { body: { goal, seed, code: CODE, authorTicks: ticks, authorOps: ops }, token: author.token });
  assert.equal(r.status, 201, r.text);
  return r.json;
}
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
    { goal: listed.goal, seed: listed.seed, authorTicks: listed.authorTicks, authorOps: listed.authorOps, authorName: listed.authorName },
    { goal: "hay500", seed: 1234, authorTicks: 50_000, authorOps: 300, authorName: "Author1" },
  );
  assert.equal(listed.code, undefined, "the list does not carry code");

  const full = await call("GET", `/api/challenges/${ch.id}`);
  assert.equal(full.json.code, CODE);
  assert.equal(full.json.result, null);

  const res = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: 40_000, ops: 900, code: "harvest()" }, token: challenger.token });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.result, "win");
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
  const again = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: 1, ops: 1, code: "x" }, token: third.token });
  assert.equal(again.status, 409);
  assert.equal((await me(third)).elo, 1000);
});

test("ELO math: loss, tie → fewer ops, exact draw, DNF, unequal ratings", async () => {
  // loss: more ticks
  {
    const a = await register("EloA1");
    const b = await register("EloB1");
    const ch = await makeChallenge(a, { ticks: 50_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: 50_001, ops: 1, code: "x" }, token: b.token });
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
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: 50_000, ops: 299, code: "x" }, token: b.token });
    assert.equal(r.json.result, "win");
  }
  // exact tie → draw, equal ratings → no change
  {
    const a = await register("EloA3");
    const b = await register("EloB3");
    const ch = await makeChallenge(a, { ticks: 50_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: 50_000, ops: 300, code: "x" }, token: b.token });
    assert.equal(r.json.result, "draw");
    assert.equal(r.json.you.delta, 0);
    assert.equal(r.json.author.delta, 0);
  }
  // did not finish → loss
  {
    const a = await register("EloA4");
    const b = await register("EloB4");
    const ch = await makeChallenge(a, { ticks: 199_000, ops: 300 });
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: DNF_TICKS, ops: 5, code: "x" }, token: b.token });
    assert.equal(r.status, 201);
    assert.equal(r.json.result, "loss");
  }
  // unequal ratings: a 1016 author (won before) vs a fresh 1000 player, then a draw
  {
    const a = await register("EloA5");
    const b = await register("EloB5");
    const c = await register("EloC5");
    const ch1 = await makeChallenge(b, { ticks: 60_000, ops: 10 });
    await call("POST", `/api/challenges/${ch1.id}/results`, { body: { ticks: 50_000, ops: 10, code: "x" }, token: a.token }); // a 1016, b 984
    const ch2 = await makeChallenge(a, { ticks: 50_000, ops: 10 });
    const r = await call("POST", `/api/challenges/${ch2.id}/results`, { body: { ticks: 50_000, ops: 10, code: "x" }, token: c.token });
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
  const r = await call("POST", `/api/challenges/${ch.id}/results`, { body: { ticks: 1, ops: 1, code: "x" }, token: a.token });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /own challenge/);
  assert.equal((await call("GET", `/api/challenges/${ch.id}`)).json.status, "open");
  assert.equal((await me(a)).elo, 1000);
});

test("challenge / result validation and missing challenges", async () => {
  const a = await register("Valid1");
  const b = await register("Valid2");
  const good = { goal: "wood800", seed: 99, code: CODE, authorTicks: 80_000, authorOps: 500 };
  for (const patch of [
    { goal: "gold200" },
    { seed: -1 },
    { seed: 1.5 },
    { code: "" },
    { code: "x".repeat(100_001) },
    { authorTicks: 0 },
    { authorTicks: 200_001 }, // did not reach the goal: no challenge
    { authorOps: 0 },
  ]) {
    const r = await call("POST", "/api/challenges", { body: { ...good, ...patch }, token: a.token });
    assert.equal(r.status, 400, JSON.stringify(patch));
  }
  const ch = await makeChallenge(a);
  for (const body of [{ ticks: 0, ops: 1, code: "x" }, { ticks: DNF_TICKS + 1, ops: 1, code: "x" }, { ticks: 10, ops: -1, code: "x" }, { ticks: 10, ops: 1 }]) {
    const r = await call("POST", `/api/challenges/${ch.id}/results`, { body, token: b.token });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await call("GET", `/api/challenges/${ch.id}`)).json.status, "open");
  assert.equal((await call("GET", "/api/challenges/999999")).status, 404);
  assert.equal((await call("GET", "/api/challenges/abc")).status, 404);
  assert.equal((await call("POST", "/api/challenges/999999/results", { body: { ticks: 1, ops: 1, code: "x" }, token: b.token })).status, 404);
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
