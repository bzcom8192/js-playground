// v5 phase 3 (Daily Maze Race): the race rules, the replay on the race course
// and the client's data mapping (mock fetch). The HTTP / storage side is in
// server/server.test.mjs. No test reads the wall clock: dates are injected.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailySeed } from "./contracts.js";
import { RACE, bangkokDate, dailyCourse, dailyFailText, previousDate } from "./dailyRace.js";
import { playDaily } from "./dailyClient.js";
import { EXAMPLES } from "./examples.js";
import { generateSeededMaze, pathDistances } from "./maze.js";
import { DAILY_TOP, dailyView } from "./onlineDaily.js";
import { OnlineError, createOnlineApi } from "./onlineApi.js";
import { CODE_MAX, validateBoardQuery, validateScore } from "./onlineRules.js";
import { buildProgram } from "./program.js";
import { mazeVerifyWorld, runVerification, verifyDaily } from "./verify.js";

const DATE = "2026-11-22";
const SEED = dailyCourse(DATE).seed;
const MAZE_RUNNER = EXAMPLES.find((e) => e.id === "maze").code;
const SOLVER = `const seen = new Set();
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

// ---------- rules ----------

test("daily race: the date changes at midnight in Bangkok (17:00 UTC)", () => {
  assert.equal(bangkokDate(Date.UTC(2026, 10, 22, 16, 59, 59, 999)), "2026-11-22");
  assert.equal(bangkokDate(Date.UTC(2026, 10, 22, 17, 0, 0, 0)), "2026-11-23");
  assert.equal(bangkokDate(Date.UTC(2026, 11, 31, 17)), "2027-01-01");
  // The fixed offset is what the time zone database says, in every season.
  const tz = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += 1000 * 3600 * 37) assert.equal(bangkokDate(t), tz.format(t));
  assert.equal(previousDate("2026-11-22"), "2026-11-21");
  assert.equal(previousDate("2027-01-01"), "2026-12-31");
  assert.equal(previousDate("2028-03-01"), "2028-02-29");
});

test("daily race: one fixed course per date, seeded like the daily contracts", () => {
  assert.deepEqual(dailyCourse(DATE), { date: DATE, seed: dailySeed(DATE), size: 8, level: 1, sx: 0, sy: 0 });
  assert.deepEqual(dailyCourse(DATE), dailyCourse(DATE));
  const seeds = new Set();
  for (let d = 1; d <= 30; d++) {
    const { seed } = dailyCourse(`2026-11-${String(d).padStart(2, "0")}`);
    seeds.add(seed);
    // Every day's treasure is a real walk away.
    const { walls, treasure } = generateSeededMaze(RACE.size, RACE.sx, RACE.sy, seed);
    assert.ok(pathDistances(RACE.size, walls, RACE.sx, RACE.sy)[treasure.y * RACE.size + treasure.x] >= 10);
  }
  assert.equal(seeds.size, 30);
  for (const bad of ["", "today", "2026-1-1", null, undefined]) assert.throws(() => dailyCourse(bad), /bad race date/);
});

test("daily race: a score is { category, code }; claimed dates, seeds and numbers are ignored", () => {
  const body = { category: "daily", code: "harvest();", date: "1999-01-01", seed: 5, ticks: 1, ops: 1, size: 3, sx: 2, sy: 2, level: 3 };
  const expected = { category: "daily", ticks: null, ops: null, value: null, seed: null, size: 8, level: 1, sx: 0, sy: 0, code: "harvest();" };
  assert.deepEqual(validateScore(body), { ok: true, score: expected });
  for (const code of [undefined, null, "", "  \n", 42, "x".repeat(CODE_MAX + 1)]) {
    const r = validateScore({ category: "daily", code });
    assert.equal(r.ok, false);
    assert.match(r.error, /code/);
  }
  assert.equal(validateBoardQuery("daily").ok, false, "the race has its own endpoint");
});

// ---------- the course ----------

test("daily race: a solver is timed on the day's maze from the start of the run, identically every time", async () => {
  const r = await verifyDaily({ code: SOLVER, seed: SEED });
  assert.equal(r.solved, true, JSON.stringify(r));
  assert.deepEqual([r.kind, r.seed, r.error], ["daily", SEED, null]);
  assert.ok(r.ticks > 0 && r.ops > 0 && r.ops <= r.ticks);
  assert.deepEqual(await runVerification({ kind: "daily", code: SOLVER, seed: SEED, ticks: 1, ops: 1 }), r, "deterministic, no claims");
  assert.deepEqual(await playDaily({ code: SOLVER, seed: SEED }), r, "the client's local run is the same replay");
  // Time before the first step counts too.
  const late = await verifyDaily({ code: `spin_in_place();\n${SOLVER}`, seed: SEED });
  assert.ok(late.ticks > r.ticks);
  assert.equal(late.ops, r.ops + 1);
  // Another day, another maze.
  const other = await verifyDaily({ code: SOLVER, seed: dailyCourse("2026-11-23").seed });
  assert.equal(other.solved, true);
  assert.notDeepEqual([other.ticks, other.ops], [r.ticks, r.ops]);
});

test("daily race: the shortest path costs one action per step, on exactly the maze of the day's seed", async () => {
  const { walls, treasure } = generateSeededMaze(RACE.size, RACE.sx, RACE.sy, SEED);
  const { state } = mazeVerifyWorld({ seed: SEED, ...RACE }, { prespawned: true });
  assert.deepEqual(state.tiles.map((t) => t.entity?.type === "Hedge"), walls);
  assert.equal(state.unlocks.Mazes, 1);
  const dist = pathDistances(RACE.size, walls, treasure.x, treasure.y);
  const steps = [];
  let [x, y] = [RACE.sx, RACE.sy];
  while (dist[y * RACE.size + x] > 0) {
    for (const [d, dx, dy] of [["North", 0, 1], ["East", 1, 0], ["South", 0, -1], ["West", -1, 0]]) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < 0 || ny < 0 || nx >= RACE.size || ny >= RACE.size) continue;
      if (dist[ny * RACE.size + nx] !== dist[y * RACE.size + x] - 1) continue;
      steps.push(`move(${d});`);
      [x, y] = [nx, ny];
      break;
    }
  }
  const best = await verifyDaily({ code: `${steps.join("\n")}\nharvest();`, seed: SEED });
  assert.equal(best.solved, true, JSON.stringify(best));
  assert.equal(best.ops, steps.length + 1);
  const solver = await verifyDaily({ code: SOLVER, seed: SEED });
  assert.ok(best.ticks <= solver.ticks && best.ops < solver.ops);
});

test("daily race: programs that grow their own maze on the farm still race the standing one", async () => {
  // The Field Guide example only spawns when it is not already in a maze.
  const example = await verifyDaily({ code: MAZE_RUNNER, seed: SEED });
  assert.equal(example.solved, true, JSON.stringify(example));
  // use_item() on the start tile does nothing here; it only costs time.
  const plain = await verifyDaily({ code: SOLVER, seed: SEED });
  const spawns = await verifyDaily({ code: `use_item(Items.Fertilizer);\n${SOLVER}`, seed: SEED });
  assert.equal(spawns.solved, true);
  assert.ok(spawns.ops > plain.ops);
});

test("daily race: bots can't be parked on the treasure before the clock starts", async () => {
  const { treasure } = generateSeededMaze(RACE.size, RACE.sx, RACE.sy, SEED);
  const go = (n, d) => `for (let i = 0; i < ${n}; i++) move(${d});`;
  const code = `if (num_bots() === 1) {
  spawn_bot();
  for (let i = 0; i < 20; i++) spin_in_place();
  use_item(Items.Fertilizer);
  for (let i = 0; i < 100; i++) spin_in_place();
} else {
  ${go(treasure.x, "East")}
  ${go(treasure.y, "North")}
  for (let i = 0; i < 100; i++) { if (get_entity_type() === Entities.Treasure) harvest(); spin_in_place(); }
}`;
  assert.equal((await verifyDaily({ code, seed: SEED })).solved, false, "the hedges are there from the start");
});

test("daily race: runs that don't harvest the course's treasure have no score, and say why", async () => {
  for (const [code, why] of [
    ["harvest();", /ended without harvesting the treasure/],
    ["nope();", /failed: .*nope/],
    ["let x = ;", /failed: /],
    ["while (true) move(North);", /tick limit/],
    ["while (true) { move(North); for (let i = 0; i < 500; i++) get_pos_x(); }", /too many API calls|tick limit/],
    // clear() away from the course, then solve a maze of its own.
    [`clear(); plant(Entities.Bush); while (!can_harvest()) spin_in_place(); use_item(Items.Fertilizer);\n${SOLVER}`, /another maze/],
  ]) {
    const r = await verifyDaily({ code, seed: SEED });
    assert.deepEqual([r.solved, r.ticks, r.ops], [false, null, null], code);
    assert.match(dailyFailText(r), why, code);
  }
});

test("daily race: a local run's error names the player's file and line", async () => {
  const files = [
    { id: 1, name: "main", code: "helper();" },
    { id: 2, name: "tools", code: "function helper() {\n  nope();\n}" },
  ];
  const prog = buildProgram(files, 1);
  const r = await playDaily({ code: prog.code, segments: prog.segments, seed: SEED });
  assert.equal(r.solved, false);
  assert.match(r.error, /tools/);
  assert.match(r.error, /nope/);
});

// ---------- client data ----------

function apiWith(reply) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([init.method, url, init.headers.Authorization ?? null, init.body === undefined ? null : JSON.parse(init.body)]);
    const { status = 200, json } = reply(url);
    return { ok: status < 300, status, json: async () => json };
  };
  return { api: createOnlineApi({ fetchFn }), calls };
}

const row = (rank, playerId, ticks = 4000 + rank, ops = 30) => ({ rank, playerId, name: `P${playerId}`, ticks, ops, createdAt: 1, verified: true });
const answer = (over = {}) => ({ ...dailyCourse(DATE), board: [row(1, 11), row(2, 12)], me: null, yesterday: null, ...over });

test("daily client: request shapes (GET /daily with and without a token, submitting a program)", async () => {
  const { api, calls } = apiWith(() => ({ json: answer() }));
  const token = "ab".repeat(32);
  await api.daily();
  await api.daily(token);
  await api.submitScore(token, { category: "daily", code: "harvest();" });
  assert.deepEqual(calls, [
    ["GET", "/api/daily", null, null],
    ["GET", "/api/daily", `Bearer ${token}`, null],
    ["POST", "/api/scores", `Bearer ${token}`, { category: "daily", code: "harvest();" }],
  ]);
  const old = apiWith(() => ({ status: 404, json: { error: "no such endpoint" } }));
  await assert.rejects(old.api.daily(), (err) => err instanceof OnlineError && err.status === 404 && !err.offline);
});

test("daily client: an answer becomes the section's data", async () => {
  const board = Array.from({ length: 14 }, (_, i) => row(i + 1, 100 + i));
  const yesterday = { date: "2026-11-21", winner: { playerId: 7, name: "Nok", ticks: 3999, ops: 27 } };
  const { api } = apiWith(() => ({ json: answer({ board, yesterday }) }));
  const data = await api.daily();

  const guest = dailyView(data);
  assert.deepEqual([guest.date, guest.seed, guest.size], [DATE, SEED, 8]);
  assert.equal(guest.rows.length, DAILY_TOP);
  assert.deepEqual(guest.rows[0], { rank: 1, playerId: 100, name: "P100", ticks: 4001, ops: 30, mine: false });
  assert.deepEqual([guest.mine, guest.outside], [null, null]);
  assert.deepEqual(guest.yesterday, { date: "2026-11-21", name: "Nok", ticks: 3999 });

  const inTop = dailyView(data, 102);
  assert.equal(inTop.mine.rank, 3);
  assert.equal(inTop.rows[2].mine, true);
  assert.equal(inTop.outside, null);

  const below = dailyView(data, 112);
  assert.equal(below.mine.rank, 13);
  assert.equal(below.outside, below.mine, "on the board, but below the top 10");

  // Off the board (it stops at 50): the server's `me`.
  const off = dailyView({ ...data, me: row(61, 900, 9999) }, 900);
  assert.deepEqual([off.mine.rank, off.mine.ticks, off.outside], [61, 9999, off.mine]);
  // … never somebody else's (an answer from before the identity changed).
  assert.equal(dailyView({ ...data, me: row(61, 900) }, 901).mine, null);
  assert.equal(dailyView({ ...data, me: row(61, 900) }).mine, null);
});

test("daily client: no entries, no winner, and broken answers", () => {
  const empty = dailyView(answer({ board: [] }), 5);
  assert.deepEqual([empty.rows, empty.mine, empty.outside, empty.yesterday], [[], null, null, null]);
  for (const bad of [null, undefined, false, {}, "x", { date: DATE }, answer({ date: "soon" }), answer({ seed: -1 }), answer({ seed: "5" }), answer({ seed: null })]) {
    assert.equal(dailyView(bad, 5), null, JSON.stringify(bad));
  }
  const messy = dailyView(answer({ board: [null, {}, row(1, 5), { ...row(2, 6), ticks: "fast" }], me: "x", yesterday: { date: "2026-11-21", winner: null } }), 5);
  assert.deepEqual(messy.rows.map((r) => r.playerId), [5]);
  assert.equal(messy.yesterday, null);
  assert.deepEqual(dailyView(answer({ board: "none" }), 5).rows, []);
});
