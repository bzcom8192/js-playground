// Runs an arena match for the UI: in a Web Worker when the browser has them
// (arenaWorker.js), else on the main thread (same runMatch, same result: the
// match is deterministic either way).
import { runMatch, runSolo } from "./arena.js";
import { mapLine } from "./program.js";
import { runInWorker } from "./workerRun.js";

/**
 * playMatch({ code, segments, bot, goal, seed, onProgress }) → Promise<match>
 *  segments: the buildProgram() segments (error lines map back to files).
 */
export function playMatch({ code, segments, bot, goal, seed, onProgress = () => {}, solo = false }) {
  return runInWorker({
    make: () => new Worker(new URL("./arenaWorker.js", import.meta.url), { type: "module" }),
    message: { code, segments, bot, goal, seed, solo },
    local: () => (solo ? runSolo : runMatch)({ code, bot, goal, seed, onProgress, mapLine: segments ? (line) => mapLine(segments, line) : undefined }),
    onProgress,
  });
}

/** playSolo({ code, segments, goal, seed, onProgress }) → Promise<solo result> (see arena.js runSolo). */
export const playSolo = (opts) => playMatch({ ...opts, bot: "rookie", solo: true });
