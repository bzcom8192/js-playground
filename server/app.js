// Semicolon Acres Online — HTTP app: the JSON API under /api/ and the built game
// (dist/) as static files with an SPA fallback. Plain node:http, no framework.
//
// Every error is JSON { error } with a fitting status. Write endpoints (every
// POST) need `Authorization: Bearer <token>` (except register) and share a
// simple in-memory rate limit: per player when the token is valid, per client
// IP otherwise (register, bad tokens).
//
// v4 phase 2 (anti-cheat level 2): arena challenges, challenge results, maze
// scores and (v5) dino scores and daily race entries are REPLAYED by the verifier (verifier.js: the engine in a
// worker_thread, tick caps + a wall-clock timeout) and stored with the
// server-measured ticks / ops; a run the replay can't reproduce is a 422.
//
// Maze scores run on the hidden maze of the week (mazeBenchmark.js). Whatever a
// program can see of it must not come back to its author: the answers carry
// only the measured numbers, never the seed and never text the program chose
// (error messages could spell out the walls).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { mazeBenchmark } from "./mazeBenchmark.js";
import { createVerifier } from "./verifier.js";
import { hashToken } from "./db.js";
import { GOALS } from "../src/farmer/arena.js";
import { MAZE_VERIFY_TICK_CAP } from "../src/farmer/verify.js";
import { bangkokDate, bangkokWeek, dailyCourse, dailyFailText, previousDate } from "../src/farmer/dailyRace.js";
import {
  ARENA_TICK_CAP,
  CHALLENGE_TTL_MS,
  DINO_BENCHMARK,
  DNF_TICKS,
  MAZE_BENCHMARK,
  RULES_VERSION,
  eloUpdate,
  outcomeOf,
  raceScore,
  validateBoardQuery,
  validateChallenge,
  validateName,
  validateResult,
  validateScore,
} from "../src/farmer/onlineRules.js";

export const BODY_LIMIT = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/** Fixed-window counter per key: allow(key) → true while under `max` per `windowMs`. */
export function createRateLimiter({ max = 60, windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map();
  let lastSweep = now();
  return {
    allow(key) {
      const t = now();
      if (t - lastSweep > windowMs) {
        for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        lastSweep = t;
      }
      let e = hits.get(key);
      if (!e || t - e.start >= windowMs) {
        e = { start: t, count: 0 };
        hits.set(key, e);
      }
      e.count++;
      return e.count <= max;
    },
    retryAfter(key) {
      const e = hits.get(key);
      return e ? Math.max(1, Math.ceil((e.start + windowMs - now()) / 1000)) : 1;
    },
  };
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    const type = String(req.headers["content-type"] || "");
    if (type && !/^application\/json\b/i.test(type)) {
      reject(new HttpError(415, "Content-Type must be application/json"));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        done = true;
        reject(new HttpError(413, "request body too large"));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolveBody({});
      try {
        resolveBody(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "body is not valid JSON"));
      }
    });
    req.on("error", (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

const playerOut = (p) => ({ playerId: p.id, name: p.name, elo: p.elo, createdAt: p.created_at });

function challengeOut(c) {
  return {
    id: c.id,
    authorId: c.author_id,
    authorName: c.author_name,
    authorElo: c.author_elo,
    goal: c.goal,
    seed: c.seed,
    authorTicks: c.author_ticks,
    authorOps: c.author_ops,
    createdAt: c.created_at,
    expiresAt: c.created_at + CHALLENGE_TTL_MS,
    verified: !!c.verified,
  };
}

const dailyOut = (e) => ({ rank: e.rank, playerId: e.player_id, name: e.name, ticks: e.ticks, ops: e.ops, createdAt: e.created_at, verified: !!e.verified });

// One finished challenge from the asking player's side. An expired challenge
// has no opponent and changes no ELO; closedAt is then its expiry time.
const historyOut = (h) => ({
  challengeId: h.challenge_id,
  role: h.role, // "author" | "challenger"
  opponentId: h.opponent_id,
  opponentName: h.opponent_name,
  goal: h.goal,
  seed: h.seed,
  myTicks: h.my_ticks,
  myOps: h.my_ops,
  opponentTicks: h.opponent_ticks,
  opponentOps: h.opponent_ops,
  outcome: h.outcome, // "win" | "lose" | "draw" | "expired"
  eloDelta: h.elo_delta,
  createdAt: h.created_at,
  closedAt: h.closed_at,
});

/** Why a challenge takes no (more) results. */
const closedError = (code) =>
  code === "missing"
    ? new HttpError(404, "no such challenge")
    : code === "expired"
      ? new HttpError(410, "this challenge has expired")
      : new HttpError(409, "this challenge already has a result");

// A stored score as answered (the program is not echoed back).
const withoutCode = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "code"));

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

/** A clean claimed { ticks, ops } from a request body (or null). Claims are
 *  only echoed back next to the server's numbers, never stored or used. */
function claimOf(ticks, ops) {
  const ok = (v) => Number.isInteger(v) && v >= 0;
  return ok(ticks) && ok(ops) ? { ticks, ops } : null;
}

/**
 * createApp({ db, distDir, rateLimit, trustProxy, verifier, now }) → (req, res) handler.
 *  db: an openDb() store. distDir: the built game (null = no static files).
 *  rateLimit: { max, windowMs } for write endpoints (per player token, per IP
 *    without a valid token).
 *  trustProxy: take the client IP from X-Forwarded-For (behind a proxy).
 *  verifier: a createVerifier() (default: a new one with the default limits).
 *  secret: what the hidden maze seeds are derived from (default: the DB's own).
 *  now: the clock of the daily race date and the benchmark week (tests).
 */
export function createApp({ db, distDir = null, rateLimit = {}, trustProxy = false, verifier = createVerifier(), secret = db.secret(), now = Date.now } = {}) {
  const limiter = createRateLimiter(rateLimit);
  const root = distDir ? resolve(distDir) : null;

  const clientIp = (req) => {
    if (trustProxy) {
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || "?";
  };

  const bearer = (req) => /^Bearer\s+([0-9a-f]{64})\s*$/i.exec(String(req.headers.authorization || ""))?.[1].toLowerCase() ?? null;
  const auth = (req) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, "missing or malformed Authorization: Bearer <token>");
    const p = db.playerByToken(token);
    if (!p) throw new HttpError(401, "unknown token");
    return p;
  };
  // Rate-limit bucket of a write: the player (by token hash) when the token is
  // valid — so players behind one tunnel / NAT address don't share a bucket —
  // else the client IP (register, missing or unknown tokens).
  const limitKey = (req, path) => {
    if (path !== "/api/auth/register") {
      const token = bearer(req);
      if (token && db.playerByToken(token)) return `t:${hashToken(token)}`;
    }
    return `ip:${clientIp(req)}`;
  };

  // Replay one job; verifier problems become HTTP errors: 422 (the run could
  // not be verified), 429 (verifier queue full: retry soon — not 503, which
  // the client reads as "server offline"), 503 (shutting down).
  // opaque: the job's maze is hidden, so a crash's text (it may be the program's
  // own) stays here.
  const replay = async (job, { opaque = false } = {}) => {
    const v = await verifier.verify(job);
    if (v.ok) return v.result;
    if (v.code === "busy") throw Object.assign(new HttpError(429, v.error), { retryAfter: 5 });
    if (v.code === "closed") throw Object.assign(new HttpError(503, v.error), { retryAfter: 5 });
    throw new HttpError(422, `could not verify the run: ${opaque && v.code === "crash" ? "the replay crashed" : v.error}`);
  };
  // Fixed texts only (see the header): no error message, no position.
  const mazeFailText = (r) => {
    if (r.reason === "wrong maze" || r.wrongStart) return `the program grew its maze away from the start tile (${MAZE_BENCHMARK.sx}, ${MAZE_BENCHMARK.sy})`;
    if (r.error) return "the program failed with an error on the benchmark farm";
    if (r.reason === "tick cap" || r.reason === "clock cap") return `the replay did not solve the maze within ${fmt(MAZE_VERIFY_TICK_CAP)} ticks`;
    if (r.reason === "op budget") return "the replay was cut off (too many API calls)";
    return "the replay ended without harvesting the treasure";
  };

  const dinoFailText = (r) => {
    if (r.error) return `the benchmark run failed: ${r.error}`;
    if (r.reason === "op budget") return "the benchmark run was cut off before it harvested the dinosaur (too many API calls)";
    if (r.reason === "clock cap") return `the benchmark run did not harvest the dinosaur within ${fmt(DINO_BENCHMARK.worldTicks)} world ticks`;
    return "the benchmark run ended without harvesting the dinosaur";
  };

  const intParam = (s) => (/^\d{1,15}$/.test(s) ? Number(s) : null);

  // ---------- API routes ----------
  async function api(req, res, path, url) {
    const method = req.method;
    const write = method === "POST";
    if (write) {
      const key = limitKey(req, path);
      if (!limiter.allow(key)) {
        res.setHeader("Retry-After", String(limiter.retryAfter(key)));
        throw new HttpError(429, "too many requests, slow down");
      }
    }
    const allow = (...methods) => {
      if (!methods.includes(method)) {
        res.setHeader("Allow", methods.join(", "));
        throw new HttpError(405, `method ${method} not allowed`);
      }
    };

    if (path === "/api/health") {
      allow("GET", "HEAD");
      return sendJson(res, 200, { ok: true });
    }

    if (path === "/api/auth/register") {
      allow("POST");
      const body = await readJson(req);
      const v = validateName(body?.name);
      if (!v.ok) throw new HttpError(400, v.error);
      const r = db.createPlayer(v.name);
      if (!r.ok) throw new HttpError(409, "that name is already taken");
      return sendJson(res, 201, { playerId: r.player.id, name: r.player.name, elo: r.player.elo, token: r.token });
    }

    if (path === "/api/players/me") {
      allow("GET");
      return sendJson(res, 200, playerOut(auth(req)));
    }

    if (path === "/api/players/me/history") {
      allow("GET");
      return sendJson(res, 200, { events: db.history(auth(req).id).map(historyOut) });
    }

    if (path === "/api/leaderboard") {
      allow("GET");
      const level = url.searchParams.get("level");
      const v = validateBoardQuery(url.searchParams.get("category"), level === null ? undefined : level);
      if (!v.ok) throw new HttpError(400, v.error);
      let rank = 0;
      let prev = null;
      const maze = v.category === "maze";
      const entries = db.leaderboard(v.category, v.level).map((row, i) => {
        const legacy = maze && row.period === null;
        const key = maze ? `${row.ticks}/${row.ops}` : `${row.value}`;
        if (key !== prev) rank = i + 1; // ties share a rank (1, 1, 3)
        prev = key;
        return {
          rank: legacy ? null : rank, // legacy entries follow the ranked ones
          playerId: row.player_id,
          name: row.name,
          ticks: row.ticks,
          ops: row.ops,
          value: row.value,
          seed: row.seed,
          size: row.size ?? null,
          sx: row.sx ?? null,
          sy: row.sy ?? null,
          createdAt: row.created_at,
          verified: !!row.verified,
          ...(maze && { period: row.period, legacy }),
        };
      });
      return sendJson(res, 200, { category: v.category, level: v.level, ...(maze && { period: bangkokWeek(now()) }), entries });
    }

    if (path === "/api/daily") {
      allow("GET");
      const course = dailyCourse(bangkokDate(now()));
      const board = db.dailyBoard(course.date).map(dailyOut);
      // Optional token: the asker's own best, also when it is off the board.
      const token = bearer(req);
      const player = token ? db.playerByToken(token) : null;
      const mine = player ? db.dailyEntry(course.date, player.id) : null;
      const before = previousDate(course.date);
      const winner = db.dailyBoard(before)[0];
      return sendJson(res, 200, {
        ...course,
        board,
        me: mine ? dailyOut(mine) : null,
        yesterday: winner ? { date: before, winner: { playerId: winner.player_id, name: winner.name, ticks: winner.ticks, ops: winner.ops } } : null,
      });
    }

    if (path === "/api/scores") {
      allow("POST");
      const player = auth(req);
      const body = await readJson(req);
      const v = validateScore(body);
      if (!v.ok) throw new HttpError(400, v.error);
      const score = v.score;
      if (score.category === "daily") {
        // The server's own date, fixed when the entry arrives (a replay that
        // ends after midnight still counts for the day it was sent in).
        const course = dailyCourse(bangkokDate(now()));
        const r = await replay({ kind: "daily", code: score.code, seed: course.seed });
        if (!r.solved) throw new HttpError(422, `daily race rejected: ${dailyFailText(r)}`);
        const stored = { ...score, ...course, ticks: r.ticks, ops: r.ops, verified: true };
        const id = db.addScore(player.id, stored);
        const mine = db.dailyEntry(course.date, player.id);
        return sendJson(res, 201, { id, ...withoutCode(stored), best: mine.id === id, rank: mine.rank });
      }
      if (score.category === "dino") {
        // The program runs on the fixed benchmark; the claim (a harvest on the
        // player's own farm) is only echoed back.
        const r = await replay({ kind: "dino", code: score.code });
        if (!r.harvested) throw new HttpError(422, `dino score rejected: ${dinoFailText(r)}`);
        const stored = { ...score, value: r.bone, ticks: r.ticks, ops: r.ops, verified: true };
        const id = db.addScore(player.id, stored);
        const claimed = Number.isInteger(body.value) && body.value > 0 ? { value: body.value } : null;
        return sendJson(res, 201, { id, ...withoutCode(stored), claimed });
      }
      // The hidden maze of the week the score arrives in. Its seed is neither
      // stored nor answered (it follows from the secret and the period).
      const bench = mazeBenchmark(secret, now());
      const r = await replay({ kind: "maze", code: score.code, level: score.level, seed: bench.seed(score.level) }, { opaque: true });
      if (!r.solved) throw new HttpError(422, `maze score rejected: ${mazeFailText(r)}`);
      const stored = { ...score, ticks: r.ticks, ops: r.ops, period: bench.period, verified: true };
      const id = db.addScore(player.id, stored);
      return sendJson(res, 201, { id, ...withoutCode(stored), claimed: claimOf(body.ticks, body.ops), replay: r.mode });
    }

    if (path === "/api/challenges") {
      allow("GET", "POST");
      if (method === "GET") return sendJson(res, 200, { challenges: db.openChallenges().map(challengeOut) });
      const player = auth(req);
      const body = await readJson(req);
      const v = validateChallenge(body);
      if (!v.ok) throw new HttpError(400, v.error);
      const goal = GOALS[v.challenge.goal];
      const r = await replay({ kind: "arena", code: v.challenge.code, goal: goal.id, seed: v.challenge.seed });
      if (!r.reached) {
        const why = r.error ? `it failed: ${r.error}` : `it did not reach ${goal.label} within ${fmt(ARENA_TICK_CAP)} ticks`;
        throw new HttpError(422, `challenge rejected: the server's replay on seed ${v.challenge.seed} did not reach the goal (${why})`);
      }
      const id = db.addChallenge(player.id, { ...v.challenge, authorTicks: r.ticks, authorOps: r.ops, verified: true });
      const claimed = claimOf(body.authorTicks, body.authorOps);
      return sendJson(res, 201, {
        ...challengeOut(db.challenge(id)),
        status: "open",
        claimed,
        corrected: !!claimed && (claimed.ticks !== r.ticks || claimed.ops !== r.ops),
      });
    }

    let m = /^\/api\/challenges\/([^/]+)$/.exec(path);
    if (m) {
      allow("GET");
      const id = intParam(m[1]);
      const c = id === null ? null : db.challenge(id);
      if (!c) throw new HttpError(404, "no such challenge");
      const r = db.resultFor(c.id);
      return sendJson(res, 200, {
        ...challengeOut(c),
        code: c.code,
        status: c.status,
        result: r
          ? { playerId: r.player_id, name: r.name, ticks: r.ticks, ops: r.ops, outcome: r.outcome, eloDelta: r.elo_delta, authorEloDelta: r.author_elo_delta, createdAt: r.created_at, verified: !!r.verified }
          : null,
      });
    }

    m = /^\/api\/challenges\/([^/]+)\/results$/.exec(path);
    if (m) {
      allow("POST");
      const player = auth(req);
      const id = intParam(m[1]);
      const c = id === null ? null : db.challenge(id);
      if (!c) throw new HttpError(404, "no such challenge");
      if (c.author_id === player.id) throw new HttpError(403, "you cannot answer your own challenge");
      if (c.status !== "open") throw closedError(c.status);
      const body = await readJson(req);
      const v = validateResult(body);
      if (!v.ok) throw new HttpError(400, v.error);
      // The challenger's program on the challenge seed, measured here. Missing
      // the goal is a valid answer (DNF: it loses); an unverifiable run is not.
      const rep = await replay({ kind: "arena", code: v.result.code, goal: c.goal, seed: c.seed });
      const measured = { ticks: rep.reached ? rep.ticks : DNF_TICKS, ops: rep.ops, code: v.result.code, verified: true };
      // Posted under older game numbers: the author's program is measured again,
      // so that both runs of the race were played by the same ones.
      let authorRun = null;
      if (c.rules !== RULES_VERSION) {
        const a = await replay({ kind: "arena", code: c.code, goal: c.goal, seed: c.seed });
        authorRun = { ticks: a.reached ? a.ticks : DNF_TICKS, ops: a.ops };
      }
      const decide = (ch, author, challenger) => {
        const score = raceScore(measured, { ticks: ch.author_ticks, ops: ch.author_ops });
        const e = eloUpdate(challenger.elo, author.elo, score);
        return { outcome: outcomeOf(score), deltaChallenger: e.deltaA, deltaAuthor: e.deltaB };
      };
      const r = db.closeChallenge(c.id, player.id, measured, decide, authorRun);
      if (!r.ok) throw closedError(r.code); // answered or expired while the replay ran
      return sendJson(res, 201, {
        challengeId: c.id,
        result: r.outcome, // for the challenger: "win" | "loss" | "draw"
        verified: true,
        you: {
          ticks: measured.ticks,
          ops: measured.ops,
          reached: rep.reached,
          error: rep.error,
          claimed: claimOf(body.ticks, body.ops),
          elo: r.challenger.elo,
          delta: r.challenger.delta,
        },
        author: { playerId: r.author.id, name: r.author.name, ticks: r.challenge.author_ticks, ops: r.challenge.author_ops, elo: r.author.elo, delta: r.author.delta },
      });
    }

    throw new HttpError(404, "no such endpoint");
  }

  // ---------- static files ----------
  async function serveStatic(req, res, path) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      throw new HttpError(405, `method ${req.method} not allowed`);
    }
    if (!root) throw new HttpError(404, "not found");
    let rel;
    try {
      rel = decodeURIComponent(path);
    } catch {
      throw new HttpError(400, "bad path");
    }
    if (rel.includes("\0")) throw new HttpError(400, "bad path");
    const file = resolve(join(root, normalize(rel)));
    let target = null;
    if (file === root || file.startsWith(root + sep)) {
      try {
        const st = await stat(file);
        if (st.isFile()) target = { file, st };
        else if (st.isDirectory()) {
          const idx = join(file, "index.html");
          const s2 = await stat(idx).catch(() => null);
          if (s2?.isFile()) target = { file: idx, st: s2 };
        }
      } catch {
        // not found → SPA fallback below
      }
    }
    if (!target) {
      // SPA fallback: unknown paths without a file extension get index.html;
      // a missing asset (.js, .png…) is a real 404.
      if (extname(rel)) throw new HttpError(404, "not found");
      const idx = join(root, "index.html");
      const st = await stat(idx).catch(() => null);
      if (!st?.isFile()) throw new HttpError(404, "the game is not built yet (run npm run build)");
      target = { file: idx, st };
    }
    const ext = extname(target.file).toLowerCase();
    const hashed = target.file.startsWith(join(root, "assets") + sep);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": target.st.size,
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(target.file).pipe(res);
  }

  return async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      return sendJson(res, 400, { error: "bad request URL" });
    }
    const path = url.pathname;
    try {
      if (path === "/api" || path.startsWith("/api/")) await api(req, res, path, url);
      else await serveStatic(req, res, path);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        if (err.retryAfter) res.setHeader("Retry-After", String(err.retryAfter));
        sendJson(res, err.status, { error: err.message });
      }
      else {
        console.error("[farmer-online]", err);
        sendJson(res, 500, { error: "internal server error" });
      }
    }
  };
}
