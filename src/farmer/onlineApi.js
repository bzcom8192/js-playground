// Semicolon Acres Online (v4 phase 1) — the game's client for the Node server in
// server/ (same-origin /api by default). No React here: plain functions the
// Online window, the engine's auto-submit and the tests use.
//
// Offline-first: every network problem (no server, timeout, a proxy's HTML
// error page, a tunnel 502) becomes an OnlineError with `offline: true` and
// the message OFFLINE_MESSAGE; real API errors keep the server's { error }
// text and HTTP status. Nothing here ever throws into gameplay:
// submitRecord() never rejects.
//
// Identity: localStorage `farmer_online_v1` = { v: 1, playerId, name, token }.
// It holds a credential, so it is NOT part of Save Data / Import Data
// (saveData.js only exports farmer_save_v1 + farmer_files_v1) and Reset Save
// does not touch it either. v5: it has its own export / import file (the
// Online window's "ส่งออกบัญชี" / "นำเข้าบัญชี"), see below.
import { bangkokWeek } from "./dailyRace.js";
import { MAZE_LEVELS, validateName, validateScore } from "./onlineRules.js";

export const IDENTITY_KEY = "farmer_online_v1";
export const OFFLINE_MESSAGE = "เซิร์ฟเวอร์ไม่ตอบสนอง";
export const DEFAULT_BASE = "/api";
export const DEFAULT_TIMEOUT_MS = 10_000;
/** A score is answered only after its replay (10 s at most, plus the queue). */
export const REPLAY_TIMEOUT_MS = 30_000;

export class OnlineError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.name = "OnlineError";
    this.status = status;
    this.offline = offline;
  }
}

// ---------- identity ----------

const TOKEN_RE = /^[0-9a-f]{64}$/;

const defaultStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);

/** The stored identity, or null (none, unreadable or damaged). */
export function loadIdentity(storage = defaultStorage()) {
  try {
    const d = JSON.parse(storage?.getItem(IDENTITY_KEY) ?? "null");
    if (!d || d.v !== 1 || !Number.isInteger(d.playerId) || typeof d.name !== "string" || !TOKEN_RE.test(d.token)) return null;
    return { playerId: d.playerId, name: d.name, token: d.token };
  } catch {
    return null;
  }
}

export function saveIdentity({ playerId, name, token }, storage = defaultStorage()) {
  try {
    storage?.setItem(IDENTITY_KEY, JSON.stringify({ v: 1, playerId, name, token }));
    return true;
  } catch {
    return false;
  }
}

export function clearIdentity(storage = defaultStorage()) {
  try {
    storage?.removeItem(IDENTITY_KEY);
  } catch {
    // ignore
  }
}

// ---------- identity export / import (v5) ----------
// A file of its own: { format: "js-farmer-identity", v: 1, name, token }. The
// token IS the account (there is no password), so the file is a credential.

export const IDENTITY_FORMAT = "js-farmer-identity";
export const IDENTITY_VERSION = 1;
/** A real file is under 250 bytes; anything far bigger is not one. */
export const IDENTITY_FILE_MAX = 4096;

export function buildIdentityExport({ name, token }) {
  return { format: IDENTITY_FORMAT, v: IDENTITY_VERSION, name, token };
}

/** Download name; anything but letters, marks, digits, - and _ becomes "_". */
export const identityFileName = (name) => `semicolon-acres-identity-${String(name).replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "_")}.json`;

/** An identity file's text → { ok, name, token } | { ok: false, error }. */
export function parseIdentityImport(text) {
  if (typeof text !== "string" || text.length > IDENTITY_FILE_MAX) return { ok: false, error: "That file is not a Semicolon Acres identity." };
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!d || d.format !== IDENTITY_FORMAT) return { ok: false, error: "That file is not a Semicolon Acres identity." };
  if (d.v !== IDENTITY_VERSION) return { ok: false, error: "That identity file has an unknown version." };
  const name = validateName(d.name);
  if (!name.ok || typeof d.token !== "string" || !TOKEN_RE.test(d.token)) return { ok: false, error: "That identity file is damaged." };
  return { ok: true, name: name.name, token: d.token };
}

/**
 * Check an identity file against the server → { identity, profile }. Saves
 * nothing: the caller confirms first. The server's id and name count (the
 * file's name is only a label). Rejects with an OnlineError: a bad file, a
 * token the server does not know (401) or offline.
 */
export async function verifyIdentityImport(text, api = onlineApi) {
  const parsed = parseIdentityImport(text);
  if (!parsed.ok) throw new OnlineError(parsed.error);
  let me;
  try {
    me = await api.me(parsed.token);
  } catch (err) {
    if (err?.status === 401) throw new OnlineError("The server does not know this identity, so it was not imported.", { status: 401 });
    throw err;
  }
  if (!Number.isInteger(me?.playerId) || typeof me.name !== "string") throw new OnlineError("The server's answer was not understood; nothing was imported.");
  return { identity: { playerId: me.playerId, name: me.name, token: parsed.token }, profile: me };
}

// ---------- HTTP ----------

/**
 * createOnlineApi({ fetchFn, base, timeoutMs, replayTimeoutMs }) → the API methods (all async).
 *  fetchFn defaults to the global fetch (looked up per call, so a page
 *  without fetch just reports offline).
 */
export function createOnlineApi({ fetchFn, base = DEFAULT_BASE, timeoutMs = DEFAULT_TIMEOUT_MS, replayTimeoutMs = REPLAY_TIMEOUT_MS } = {}) {
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  const root = base.replace(/\/+$/, "");

  async function request(method, path, { body, token, wait = timeoutMs } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl && wait > 0 ? setTimeout(() => ctrl.abort(), wait) : null;
    let res;
    try {
      res = await doFetch(root + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl?.signal,
      });
    } catch {
      throw new OnlineError(OFFLINE_MESSAGE, { offline: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const isApi = data && typeof data === "object" && !Array.isArray(data);
    if (!isApi) {
      // Not our JSON (an HTML page, a tunnel / proxy error): the API is not there.
      throw new OnlineError(OFFLINE_MESSAGE, { status: res.status || 0, offline: true });
    }
    if (!res.ok) {
      const offline = res.status === 502 || res.status === 503 || res.status === 504;
      throw new OnlineError(typeof data.error === "string" ? data.error : `HTTP ${res.status}`, { status: res.status, offline });
    }
    return data;
  }

  const enc = encodeURIComponent;
  return {
    request,
    health: () => request("GET", "/health"),
    /** → { playerId, name, elo, token } */
    register: (name) => request("POST", "/auth/register", { body: { name } }),
    /** → { playerId, name, elo, createdAt } */
    me: (token) => request("GET", "/players/me", { token }),
    /** → { events: [{ challengeId, role, opponentId, opponentName, goal, seed, myTicks, myOps, opponentTicks,
     *  opponentOps, outcome: "win" | "lose" | "draw" | "expired", eloDelta, createdAt, closedAt }] } (latest 20) */
    history: (token) => request("GET", "/players/me/history", { token }),
    /** → { category, level, entries: [{ rank, playerId, name, ticks, ops, value, seed, size, sx, sy, createdAt, verified }] }
     *  maze: also period (the current week) and per entry period + legacy; legacy
     *  entries (a maze the player chose) come last, with rank null. */
    leaderboard: (category, level = null) =>
      request("GET", `/leaderboard?category=${enc(category)}${level === null || level === undefined ? "" : `&level=${enc(level)}`}`),
    /** maze: { category, level, code, ticks?, ops? } → the stored benchmark result:
     *  the SERVER's ticks / ops on its hidden maze of the week (+ period, claimed,
     *  verified).
     *  dino: { category, code, value? } → the stored benchmark result: the
     *  SERVER's value (Bone) / ticks / ops (+ claimed, verified).
     *  daily: { category, code } → the stored race result: the SERVER's date, seed,
     *  ticks / ops (+ best: my best today?, rank: my rank today). */
    submitScore: (token, score) => request("POST", "/scores", { body: score, token, wait: replayTimeoutMs }),
    /** → { date, seed, size, level, sx, sy, board: [{ rank, playerId, name, ticks, ops, createdAt, verified }],
     *  me (with a token: my best today, the same shape, or null), yesterday: { date, winner } | null } */
    daily: (token) => request("GET", "/daily", { token }),
    /** → { challenges: [{ id, authorId, authorName, authorElo, goal, seed, authorTicks, authorOps, createdAt, expiresAt, verified }] } */
    listChallenges: () => request("GET", "/challenges"),
    getChallenge: (id) => request("GET", `/challenges/${enc(id)}`),
    /** body: { goal, seed, code, authorTicks?, authorOps? } (the claims are ignored:
     *  the server replays the code) → the challenge with the server's authorTicks / authorOps */
    createChallenge: (token, body) => request("POST", "/challenges", { body, token }),
    /** body: { code, ticks?, ops? } (claims ignored, replayed) → { challengeId, result, verified,
     *  you: { ticks, ops, reached, elo, delta, … }, author: { name, ticks, ops, elo, delta, … } } */
    answerChallenge: (token, id, body) => request("POST", `/challenges/${enc(id)}/results`, { body, token }),
  };
}

/** The page's API client (same-origin /api). */
export const onlineApi = createOnlineApi();

// ---------- auto-submit of local records ----------

/** A local record event (runtime onRecord) → a POST /api/scores body, or null
 *  if it is not leaderboard material (maze level outside 1–3, insane numbers,
 *  no program to replay).
 *  Both carry the program as it ran (ev.code, helper files included); the
 *  server runs it on its own benchmark (maze: the hidden maze of the week, dino:
 *  the benchmark farm) and keeps what IT measures there. The local numbers are
 *  only echoed back. */
export function scoreForRecord(ev) {
  let score = null;
  if (ev?.kind === "maze" && ev.attempt && MAZE_LEVELS.includes(ev.attempt.level)) {
    const a = ev.attempt;
    score = { category: "maze", level: a.level, ticks: a.ticks, ops: a.ops, code: ev.code };
  } else if (ev?.kind === "dino" && ev.rec) {
    score = { category: "dino", value: ev.rec.bone, code: ev.code };
  }
  return score && validateScore(score).ok ? score : null;
}

// The program each identity (token) sent last, per board (and week, for the
// mazes): its benchmark result does not depend on the local record, so a run
// that keeps beating its own record sends the same program only once.
const lastSent = new Map();
const sentKey = (token, score, now) => [token, score.category, ...(score.category === "maze" ? [score.level, bangkokWeek(now)] : [])].join("|");

/**
 * Fire-and-forget: send a new local record to the leaderboard if this
 * browser has an identity. Never rejects. → Promise<{ sent, score?, stored?,
 * reason?, rejected? }> — stored: the server's answer (its benchmark result);
 * rejected: the program has no benchmark result (422).
 */
export async function submitRecord(ev, { api = onlineApi, storage, demo = false, sent = lastSent, now = Date.now() } = {}) {
  let undo = () => {};
  try {
    if (demo) return { sent: false, reason: "demo" };
    const id = loadIdentity(storage === undefined ? defaultStorage() : storage);
    if (!id) return { sent: false, reason: "no identity" };
    const score = scoreForRecord(ev);
    if (!score) return { sent: false, reason: "not a leaderboard score" };
    const key = sentKey(id.token, score, now);
    if (sent.get(key) === score.code) return { sent: false, reason: "already sent" };
    sent.set(key, score.code);
    undo = () => sent.get(key) === score.code && sent.delete(key);
    const stored = await api.submitScore(id.token, score);
    return { sent: true, score, stored: stored && typeof stored === "object" ? stored : null };
  } catch (err) {
    const out = { sent: false, reason: String(err?.message || err) };
    if (err?.status === 422) out.rejected = true;
    else undo(); // it never got there: the next record may try again
    return out;
  }
}

/**
 * The "ส่งคะแนน Dino" button: send a program for the dino benchmark now, whatever
 * the local records are (and also if it was sent before). → the stored result
 * with the SERVER's value / ticks / ops. Rejects with an OnlineError (422: the
 * program harvests nothing there). A later record of the same program is then
 * not sent again: its result is known.
 */
export async function submitDinoProgram(code, { token, api = onlineApi, sent = lastSent } = {}) {
  const score = { category: "dino", code };
  const ok = validateScore(score);
  if (!ok.ok) throw new OnlineError(ok.error);
  const stored = await api.submitScore(token, score);
  if (!Number.isInteger(stored?.value)) throw new OnlineError("The server's answer was not understood.");
  sent.set(sentKey(token, score), code);
  return stored;
}
