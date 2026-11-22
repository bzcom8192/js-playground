// Semicolon Acres Online — SQLite storage (one file, default server/data/farmer-online.db).
// Uses the built-in `node:sqlite` (Node ≥ 22.5); falls back to `better-sqlite3`
// if this runtime has no node:sqlite and that package is installed. Only the
// API subset both share is used: exec(), prepare().run/get/all with `?` params.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { CHALLENGE_LIST_LIMIT, CHALLENGE_TTL_MS, ELO_START, HISTORY_LIMIT, LEADERBOARD_LIMIT } from "../src/farmer/onlineRules.js";

async function openRaw(file) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(file);
  } catch (err) {
    if (err?.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
  }
  const { default: Database } = await import("better-sqlite3");
  return new Database(file);
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  elo INTEGER NOT NULL DEFAULT ${ELO_START},
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  category TEXT NOT NULL,
  level INTEGER,
  ticks INTEGER,
  ops INTEGER,
  value INTEGER,
  seed INTEGER,
  created_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  size INTEGER,
  sx INTEGER,
  sy INTEGER,
  code TEXT
);
CREATE INDEX IF NOT EXISTS scores_board ON scores(category, level, player_id);
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES players(id),
  goal TEXT NOT NULL,
  seed INTEGER NOT NULL,
  code TEXT NOT NULL,
  author_ticks INTEGER NOT NULL,
  author_ops INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS challenges_open ON challenges(status, id);
CREATE INDEX IF NOT EXISTS challenges_author ON challenges(author_id, id);
CREATE TABLE IF NOT EXISTS challenge_results (
  id INTEGER PRIMARY KEY,
  challenge_id INTEGER NOT NULL UNIQUE REFERENCES challenges(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  ticks INTEGER NOT NULL,
  ops INTEGER NOT NULL,
  code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  elo_delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  author_elo_delta INTEGER
);
CREATE INDEX IF NOT EXISTS challenge_results_player ON challenge_results(player_id, id);
`;

// Columns added to an older DB file in place (new tables get them from SCHEMA).
// v4 phase 2: old rows keep verified = 0 (they were trust-based).
// v5: author_elo_delta (elo_delta is the challenger's). Nullable on purpose, so
// a rolled-back (older) server can keep inserting rows without it.
const ADDED_COLUMNS = {
  scores: ["verified INTEGER NOT NULL DEFAULT 0", "size INTEGER", "sx INTEGER", "sy INTEGER", "code TEXT"],
  challenges: ["verified INTEGER NOT NULL DEFAULT 0"],
  challenge_results: ["verified INTEGER NOT NULL DEFAULT 0", "author_elo_delta INTEGER"],
};

function migrate(db) {
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const col of cols) if (!have.has(col.split(" ")[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  }
  // Results stored before v5: ELO has always been zero-sum, so the author's
  // change is the challenger's, negated.
  db.exec("UPDATE challenge_results SET author_elo_delta = -elo_delta WHERE author_elo_delta IS NULL");
}

export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");

const isUnique = (err) => /UNIQUE constraint failed/i.test(String(err?.message));

/**
 * openDb(file) → the store. `file` may be ":memory:". Every write that touches
 * more than one row runs inside a transaction.
 */
export async function openDb(file, { now = Date.now } = {}) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = await openRaw(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);

  const q = {
    insertPlayer: db.prepare("INSERT INTO players (name, token_hash, elo, created_at) VALUES (?, ?, ?, ?)"),
    playerByHash: db.prepare("SELECT id, name, elo, created_at FROM players WHERE token_hash = ?"),
    playerById: db.prepare("SELECT id, name, elo, created_at FROM players WHERE id = ?"),
    setElo: db.prepare("UPDATE players SET elo = ? WHERE id = ?"),
    insertScore: db.prepare(
      "INSERT INTO scores (player_id, category, level, ticks, ops, value, seed, created_at, verified, size, sx, sy, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    // Best entry per player (window function), then the category's order.
    // Maze: only replay-verified rows count (phase-1 trust rows are hidden).
    boardMaze: db.prepare(`
      SELECT * FROM (
        SELECT s.id, s.player_id, p.name, s.ticks, s.ops, s.value, s.seed, s.created_at, s.verified, s.size, s.sx, s.sy,
               ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.ticks ASC, s.ops ASC, s.id ASC) AS rn
        FROM scores s JOIN players p ON p.id = s.player_id
        WHERE s.category = 'maze' AND s.level = ? AND s.verified = 1
      ) WHERE rn = 1 ORDER BY ticks ASC, ops ASC, id ASC LIMIT ${LEADERBOARD_LIMIT}`),
    boardDino: db.prepare(`
      SELECT * FROM (
        SELECT s.id, s.player_id, p.name, s.ticks, s.ops, s.value, s.seed, s.created_at, s.verified, s.size, s.sx, s.sy,
               ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.value DESC, s.id ASC) AS rn
        FROM scores s JOIN players p ON p.id = s.player_id
        WHERE s.category = 'dino'
      ) WHERE rn = 1 ORDER BY value DESC, id ASC LIMIT ${LEADERBOARD_LIMIT}`),
    insertChallenge: db.prepare(
      "INSERT INTO challenges (author_id, goal, seed, code, author_ticks, author_ops, status, created_at, verified) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
    ),
    openChallenges: db.prepare(`
      SELECT c.id, c.author_id, p.name AS author_name, p.elo AS author_elo, c.goal, c.seed, c.author_ticks, c.author_ops, c.created_at, c.verified
      FROM challenges c JOIN players p ON p.id = c.author_id
      WHERE c.status = 'open' AND c.created_at > ? ORDER BY c.id DESC LIMIT ${CHALLENGE_LIST_LIMIT}`),
    challenge: db.prepare(`
      SELECT c.*, p.name AS author_name, p.elo AS author_elo
      FROM challenges c JOIN players p ON p.id = c.author_id WHERE c.id = ?`),
    resultFor: db.prepare(`
      SELECT r.player_id, p.name, r.ticks, r.ops, r.outcome, r.elo_delta, r.author_elo_delta, r.created_at, r.verified
      FROM challenge_results r JOIN players p ON p.id = r.player_id WHERE r.challenge_id = ?`),
    closeChallenge: db.prepare("UPDATE challenges SET status = 'closed' WHERE id = ? AND status = 'open'"),
    insertResult: db.prepare(
      "INSERT INTO challenge_results (challenge_id, player_id, ticks, ops, code, outcome, elo_delta, author_elo_delta, created_at, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    // One player's finished challenges, from their side: authored + answered,
    // authored + expired (never answered), answered. Newest end first.
    // Params: author id | TTL, author id, expiry cutoff | challenger id.
    history: db.prepare(`
      SELECT * FROM (
        SELECT c.id AS challenge_id, 'author' AS role, p.id AS opponent_id, p.name AS opponent_name, c.goal, c.seed,
               c.author_ticks AS my_ticks, c.author_ops AS my_ops, r.ticks AS opponent_ticks, r.ops AS opponent_ops,
               CASE r.outcome WHEN 'win' THEN 'lose' WHEN 'loss' THEN 'win' ELSE 'draw' END AS outcome,
               r.author_elo_delta AS elo_delta, c.created_at, r.created_at AS closed_at
        FROM challenges c JOIN challenge_results r ON r.challenge_id = c.id JOIN players p ON p.id = r.player_id
        WHERE c.author_id = ?
        UNION ALL
        SELECT c.id, 'author', NULL, NULL, c.goal, c.seed, c.author_ticks, c.author_ops, NULL, NULL,
               'expired', 0, c.created_at, c.created_at + ?
        FROM challenges c
        WHERE c.author_id = ? AND c.status = 'open' AND c.created_at <= ?
        UNION ALL
        SELECT c.id, 'challenger', p.id, p.name, c.goal, c.seed, r.ticks, r.ops, c.author_ticks, c.author_ops,
               CASE r.outcome WHEN 'win' THEN 'win' WHEN 'loss' THEN 'lose' ELSE 'draw' END,
               r.elo_delta, c.created_at, r.created_at
        FROM challenge_results r JOIN challenges c ON c.id = r.challenge_id JOIN players p ON p.id = c.author_id
        WHERE r.player_id = ?
      ) ORDER BY closed_at DESC, challenge_id DESC LIMIT ${HISTORY_LIMIT}`),
  };

  // Challenge expiry is lazy (no cron, the stored status stays 'open'): an open
  // challenge older than the TTL reads as status 'expired' everywhere.
  const expiryCutoff = () => now() - CHALLENGE_TTL_MS;
  const readChallenge = (id) => {
    const c = q.challenge.get(id);
    if (!c) return null;
    return c.status === "open" && c.created_at <= expiryCutoff() ? { ...c, status: "expired" } : c;
  };

  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  return {
    raw: db,
    close: () => db.close(),
    tx,

    /** → { ok, player, token } | { ok: false, taken: true } */
    createPlayer(name) {
      const token = newToken();
      try {
        const r = q.insertPlayer.run(name, hashToken(token), ELO_START, now());
        return { ok: true, player: q.playerById.get(Number(r.lastInsertRowid)), token };
      } catch (err) {
        if (isUnique(err)) return { ok: false, taken: true };
        throw err;
      }
    },
    playerByToken: (token) => q.playerByHash.get(hashToken(token)) ?? null,
    playerById: (id) => q.playerById.get(id) ?? null,

    /** s: a validated score; s.verified (bool) = the server replayed it and
     *  s.ticks / s.ops are the server's numbers. */
    addScore(playerId, s) {
      const r = q.insertScore.run(
        playerId, s.category, s.level, s.ticks, s.ops, s.value, s.seed, now(),
        s.verified ? 1 : 0, s.size ?? null, s.sx ?? null, s.sy ?? null, s.code ?? null,
      );
      return Number(r.lastInsertRowid);
    },
    leaderboard: (category, level) => (category === "dino" ? q.boardDino.all() : q.boardMaze.all(level)),

    addChallenge(authorId, c) {
      const r = q.insertChallenge.run(authorId, c.goal, c.seed, c.code, c.authorTicks, c.authorOps, now(), c.verified ? 1 : 0);
      return Number(r.lastInsertRowid);
    },
    openChallenges: () => q.openChallenges.all(expiryCutoff()),
    /** status: 'open' | 'closed' | 'expired' (open for longer than the TTL). */
    challenge: readChallenge,
    resultFor: (id) => q.resultFor.get(id) ?? null,
    /** The player's latest finished challenges (answered, or expired unanswered). */
    history: (playerId) => q.history.all(playerId, CHALLENGE_TTL_MS, playerId, expiryCutoff(), playerId),

    /**
     * Close challenge `id` with a result, atomically: the open check, the
     * result row, the status flip and both players' ELO in one transaction.
     * decide(challengeRow, authorRow, challengerRow) → { outcome, deltaChallenger, deltaAuthor }.
     * → { ok, ... } | { ok: false, code: "missing" | "closed" | "expired" }
     */
    closeChallenge(id, playerId, result, decide) {
      return tx(() => {
        const c = readChallenge(id);
        if (!c) return { ok: false, code: "missing" };
        if (c.status === "expired") return { ok: false, code: "expired" };
        if (c.status !== "open") return { ok: false, code: "closed" };
        const author = q.playerById.get(c.author_id);
        const challenger = q.playerById.get(playerId);
        const d = decide(c, author, challenger);
        if (q.closeChallenge.run(id).changes !== 1) return { ok: false, code: "closed" };
        q.insertResult.run(id, playerId, result.ticks, result.ops, result.code, d.outcome, d.deltaChallenger, d.deltaAuthor, now(), result.verified ? 1 : 0);
        q.setElo.run(author.elo + d.deltaAuthor, author.id);
        q.setElo.run(challenger.elo + d.deltaChallenger, challenger.id);
        return {
          ok: true,
          challenge: c,
          outcome: d.outcome,
          author: { ...q.playerById.get(author.id), delta: d.deltaAuthor },
          challenger: { ...q.playerById.get(challenger.id), delta: d.deltaChallenger },
        };
      });
    },
  };
}
