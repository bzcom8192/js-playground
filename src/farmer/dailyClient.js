// Runs the player's program on the daily race course for the UI: the same
// replay the server does (verifyDaily), in a Web Worker when the browser has them.
import { mapLine } from "./program.js";
import { verifyDaily } from "./verify.js";
import { runInWorker } from "./workerRun.js";

/** A local race run is stopped after this long (the server allows 10 s). */
export const DAILY_RUN_TIMEOUT_MS = 30_000;

/** playDaily({ code, segments, seed }) → Promise<verifyDaily result>. */
export const playDaily = ({ code, segments, seed }) =>
  runInWorker({
    make: () => new Worker(new URL("./dailyWorker.js", import.meta.url), { type: "module" }),
    message: { code, segments, seed },
    local: () => verifyDaily({ code, seed, mapLine: segments ? (line) => mapLine(segments, line) : undefined }),
    timeoutMs: DAILY_RUN_TIMEOUT_MS,
  });
