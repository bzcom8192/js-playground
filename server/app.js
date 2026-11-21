// JS Farmer Online — HTTP app: the JSON API under /api/ and the built game
// (dist/) as static files with an SPA fallback. Plain node:http, no framework.
//
// Every error is JSON { error } with a fitting status. Write endpoints (every
// POST) need `Authorization: Bearer <token>` (except register) and share a
// simple in-memory rate limit per client IP.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
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
  };
}

/**
 * createApp({ db, distDir, rateLimit, trustProxy }) → (req, res) handler.
 *  db: an openDb() store. distDir: the built game (null = no static files).
 *  rateLimit: { max, windowMs } for write endpoints (per IP).
 *  trustProxy: take the client IP from X-Forwarded-For (behind a proxy).
 */
export function createApp({ db, distDir = null, rateLimit = {}, trustProxy = false } = {}) {
  const limiter = createRateLimiter(rateLimit);
  const root = distDir ? resolve(distDir) : null;

  const clientIp = (req) => {
    if (trustProxy) {
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || "?";
  };

  const auth = (req) => {
    const m = /^Bearer\s+([0-9a-f]{64})\s*$/i.exec(String(req.headers.authorization || ""));
    if (!m) throw new HttpError(401, "missing or malformed Authorization: Bearer <token>");
    const p = db.playerByToken(m[1].toLowerCase());
    if (!p) throw new HttpError(401, "unknown token");
    return p;
  };

  const intParam = (s) => (/^\d{1,15}$/.test(s) ? Number(s) : null);

  // ---------- API routes ----------
  async function api(req, res, path, url) {
    const method = req.method;
    const write = method === "POST";
    if (write && !limiter.allow(clientIp(req))) {
      res.setHeader("Retry-After", String(limiter.retryAfter(clientIp(req))));
      throw new HttpError(429, "too many requests, slow down");
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

    if (path === "/api/leaderboard") {
      allow("GET");
      const level = url.searchParams.get("level");
      const v = validateBoardQuery(url.searchParams.get("category"), level === null ? undefined : level);
      if (!v.ok) throw new HttpError(400, v.error);
      let rank = 0;
      let prev = null;
      const entries = db.leaderboard(v.category, v.level).map((row, i) => {
        const key = v.category === "dino" ? `${row.value}` : `${row.ticks}/${row.ops}`;
        if (key !== prev) rank = i + 1; // ties share a rank (1, 1, 3)
        prev = key;
        return {
          rank,
          playerId: row.player_id,
          name: row.name,
          ticks: row.ticks,
          ops: row.ops,
          value: row.value,
          seed: row.seed,
          createdAt: row.created_at,
        };
      });
      return sendJson(res, 200, { category: v.category, level: v.level, entries });
    }

    if (path === "/api/scores") {
      allow("POST");
      const player = auth(req);
      const body = await readJson(req);
      const v = validateScore(body);
      if (!v.ok) throw new HttpError(400, v.error);
      // Level-2 anti-cheat would replay the run here (see RESULT14.md).
      const id = db.addScore(player.id, v.score);
      return sendJson(res, 201, { id, ...v.score });
    }

    if (path === "/api/challenges") {
      allow("GET", "POST");
      if (method === "GET") return sendJson(res, 200, { challenges: db.openChallenges().map(challengeOut) });
      const player = auth(req);
      const body = await readJson(req);
      const v = validateChallenge(body);
      if (!v.ok) throw new HttpError(400, v.error);
      const id = db.addChallenge(player.id, v.challenge);
      return sendJson(res, 201, { ...challengeOut(db.challenge(id)), status: "open" });
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
          ? { playerId: r.player_id, name: r.name, ticks: r.ticks, ops: r.ops, outcome: r.outcome, eloDelta: r.elo_delta, createdAt: r.created_at }
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
      if (c.status !== "open") throw new HttpError(409, "this challenge already has a result");
      const body = await readJson(req);
      const v = validateResult(body);
      if (!v.ok) throw new HttpError(400, v.error);
      const r = db.closeChallenge(c.id, player.id, v.result, (ch, author, challenger) => {
        const score = raceScore(v.result, { ticks: ch.author_ticks, ops: ch.author_ops });
        const e = eloUpdate(challenger.elo, author.elo, score);
        return { outcome: outcomeOf(score), deltaChallenger: e.deltaA, deltaAuthor: e.deltaB };
      });
      if (!r.ok) throw r.code === "missing" ? new HttpError(404, "no such challenge") : new HttpError(409, "this challenge already has a result");
      return sendJson(res, 201, {
        challengeId: c.id,
        result: r.outcome, // for the challenger: "win" | "loss" | "draw"
        you: { ticks: v.result.ticks, ops: v.result.ops, elo: r.challenger.elo, delta: r.challenger.delta },
        author: { playerId: r.author.id, name: r.author.name, ticks: c.author_ticks, ops: c.author_ops, elo: r.author.elo, delta: r.author.delta },
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
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else {
        console.error("[farmer-online]", err);
        sendJson(res, 500, { error: "internal server error" });
      }
    }
  };
}
