// Semicolon Acres Online server: `npm run server` (= node server/index.js).
//
// Serves the built game from dist/ and the JSON API under /api/ on one port.
// Env: PORT (default 4188), HOST (default 127.0.0.1: in production Apache is
// the only public entry; HOST=0.0.0.0 to listen on every interface), FARMER_DB
// (default server/data/farmer-online.db), FARMER_DIST (default dist/),
// TRUST_PROXY=1 (rate-limit by X-Forwarded-For), RATE_LIMIT (write requests /
// min per player token, or per IP without one; 60), VERIFY_TIMEOUT_MS
// (wall-clock limit of one replay, 10000), VERIFY_WORKERS (replays at once, 2).
// Deploying it (systemd + Apache): server/README.md.
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createVerifier } from "./verifier.js";

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PORT = 4188;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_DB = resolve(here, "data", "farmer-online.db");
export const DEFAULT_DIST = resolve(here, "..", "dist");

/** startServer({ port, host, dbPath, distDir, rateLimit, trustProxy, verify, verifier, now })
 *  → { server, db, verifier, url, close() }
 *  verify: createVerifier() options ({ timeoutMs, maxConcurrent, maxQueue }),
 *  or pass a ready `verifier` (it is then not closed by close()).
 *  now: the clock of the stored timestamps, the challenge expiry and the daily
 *  race date (tests). */
export async function startServer({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  dbPath = DEFAULT_DB,
  distDir = DEFAULT_DIST,
  rateLimit,
  trustProxy = false,
  verify = {},
  verifier: given = null,
  now = Date.now,
} = {}) {
  const db = await openDb(dbPath, { now });
  const verifier = given ?? createVerifier(verify);
  const server = createServer(createApp({ db, distDir, rateLimit, trustProxy, verifier, now }));
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, ok);
  });
  const addr = server.address();
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${addr.port}`;
  const close = () =>
    new Promise((ok) => {
      server.close(() => {
        db.close();
        ok();
      });
      if (!given) void verifier.close();
      server.closeAllConnections?.();
    });
  return { server, db, verifier, url, port: addr.port, close };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = process.env;
  const s = await startServer({
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    host: env.HOST || DEFAULT_HOST,
    dbPath: env.FARMER_DB ? resolve(env.FARMER_DB) : DEFAULT_DB,
    distDir: env.FARMER_DIST ? resolve(env.FARMER_DIST) : DEFAULT_DIST,
    rateLimit: { max: env.RATE_LIMIT ? Number(env.RATE_LIMIT) : 60, windowMs: 60_000 },
    trustProxy: env.TRUST_PROXY === "1",
    verify: {
      ...(env.VERIFY_TIMEOUT_MS ? { timeoutMs: Number(env.VERIFY_TIMEOUT_MS) } : {}),
      ...(env.VERIFY_WORKERS ? { maxConcurrent: Number(env.VERIFY_WORKERS) } : {}),
    },
  });
  console.log(`Semicolon Acres Online listening on ${s.url} (db ${env.FARMER_DB || DEFAULT_DB})`);
  const shutdown = () => s.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
