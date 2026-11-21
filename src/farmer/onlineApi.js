// JS Farmer Online (v4 phase 1) — the game's client for the Node server in
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
// does not touch it either.
import { MAZE_LEVELS, validateScore } from "./onlineRules.js";

export const IDENTITY_KEY = "farmer_online_v1";
export const OFFLINE_MESSAGE = "เซิร์ฟเวอร์ไม่ตอบสนอง";
export const DEFAULT_BASE = "/api";
export const DEFAULT_TIMEOUT_MS = 10_000;

export class OnlineError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.name = "OnlineError";
    this.status = status;
    this.offline = offline;
  }
}

// ---------- identity ----------

const defaultStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);

/** The stored identity, or null (none, unreadable or damaged). */
export function loadIdentity(storage = defaultStorage()) {
  try {
    const d = JSON.parse(storage?.getItem(IDENTITY_KEY) ?? "null");
    if (!d || d.v !== 1 || !Number.isInteger(d.playerId) || typeof d.name !== "string" || !/^[0-9a-f]{64}$/.test(d.token)) return null;
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

// ---------- HTTP ----------

/**
 * createOnlineApi({ fetchFn, base, timeoutMs }) → the API methods (all async).
 *  fetchFn defaults to the global fetch (looked up per call, so a page
 *  without fetch just reports offline).
 */
export function createOnlineApi({ fetchFn, base = DEFAULT_BASE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  const root = base.replace(/\/+$/, "");

  async function request(method, path, { body, token } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl && timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
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
    /** → { category, level, entries: [{ rank, playerId, name, ticks, ops, value, seed, createdAt }] } */
    leaderboard: (category, level = null) =>
      request("GET", `/leaderboard?category=${enc(category)}${level === null || level === undefined ? "" : `&level=${enc(level)}`}`),
    submitScore: (token, score) => request("POST", "/scores", { body: score, token }),
    /** → { challenges: [{ id, authorId, authorName, authorElo, goal, seed, authorTicks, authorOps, createdAt }] } */
    listChallenges: () => request("GET", "/challenges"),
    getChallenge: (id) => request("GET", `/challenges/${enc(id)}`),
    /** body: { goal, seed, code, authorTicks, authorOps } */
    createChallenge: (token, body) => request("POST", "/challenges", { body, token }),
    /** body: { ticks, ops, code } → { challengeId, result, you: { elo, delta, … }, author: { name, elo, delta, … } } */
    answerChallenge: (token, id, body) => request("POST", `/challenges/${enc(id)}/results`, { body, token }),
  };
}

/** The page's API client (same-origin /api). */
export const onlineApi = createOnlineApi();

// ---------- auto-submit of local records ----------

/** A local record event (runtime onRecord) → a POST /api/scores body, or null
 *  if it is not leaderboard material (maze level outside 1–3, insane numbers). */
export function scoreForRecord(ev) {
  let score = null;
  if (ev?.kind === "maze" && ev.attempt && MAZE_LEVELS.includes(ev.attempt.level)) {
    const a = ev.attempt;
    score = { category: "maze", level: a.level, ticks: a.ticks, ops: a.ops, seed: a.seed ?? null };
  } else if (ev?.kind === "dino" && ev.rec) {
    score = { category: "dino", value: ev.rec.bone };
  }
  return score && validateScore(score).ok ? score : null;
}

/**
 * Fire-and-forget: send a new local record to the leaderboard if this
 * browser has an identity. Never rejects. → Promise<{ sent, reason? }>
 */
export async function submitRecord(ev, { api = onlineApi, storage, demo = false } = {}) {
  try {
    if (demo) return { sent: false, reason: "demo" };
    const id = loadIdentity(storage === undefined ? defaultStorage() : storage);
    if (!id) return { sent: false, reason: "no identity" };
    const score = scoreForRecord(ev);
    if (!score) return { sent: false, reason: "not a leaderboard score" };
    await api.submitScore(id.token, score);
    return { sent: true, score };
  } catch (err) {
    return { sent: false, reason: String(err?.message || err) };
  }
}
