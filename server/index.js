// JS Farmer Online server: `npm run server` (= node server/index.js).
//
// Serves the built game from dist/ and the JSON API under /api/ on one port.
// Env: PORT (default 4188), HOST (default 0.0.0.0), FARMER_DB (default
// server/data/farmer-online.db), FARMER_DIST (default dist/), TRUST_PROXY=1
// (rate-limit by X-Forwarded-For), RATE_LIMIT (write requests / min / IP, 60).
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PORT = 4188;
export const DEFAULT_DB = resolve(here, "data", "farmer-online.db");
export const DEFAULT_DIST = resolve(here, "..", "dist");

/** startServer({ port, host, dbPath, distDir, rateLimit, trustProxy }) → { server, db, url, close() } */
export async function startServer({
  port = DEFAULT_PORT,
  host = "0.0.0.0",
  dbPath = DEFAULT_DB,
  distDir = DEFAULT_DIST,
  rateLimit,
  trustProxy = false,
} = {}) {
  const db = await openDb(dbPath);
  const server = createServer(createApp({ db, distDir, rateLimit, trustProxy }));
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
      server.closeAllConnections?.();
    });
  return { server, db, url, port: addr.port, close };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = process.env;
  const s = await startServer({
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    host: env.HOST || "0.0.0.0",
    dbPath: env.FARMER_DB ? resolve(env.FARMER_DB) : DEFAULT_DB,
    distDir: env.FARMER_DIST ? resolve(env.FARMER_DIST) : DEFAULT_DIST,
    rateLimit: { max: env.RATE_LIMIT ? Number(env.RATE_LIMIT) : 60, windowMs: 60_000 },
    trustProxy: env.TRUST_PROXY === "1",
  });
  console.log(`JS Farmer Online listening on ${s.url} (db ${env.FARMER_DB || DEFAULT_DB})`);
  const shutdown = () => s.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
