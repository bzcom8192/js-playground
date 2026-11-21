// Runs an arena match for the UI: in a Web Worker when the browser has them
// (arenaWorker.js), else on the main thread (same runMatch, same result: the
// match is deterministic either way).
import { runMatch, runSolo } from "./arena.js";
import { mapLine } from "./program.js";

/**
 * playMatch({ code, segments, bot, goal, seed, onProgress }) → Promise<match>
 *  segments: the buildProgram() segments (error lines map back to files).
 */
export function playMatch({ code, segments, bot, goal, seed, onProgress = () => {}, solo = false }) {
  const local = () =>
    (solo ? runSolo : runMatch)({ code, bot, goal, seed, onProgress, mapLine: segments ? (line) => mapLine(segments, line) : undefined });
  if (typeof Worker === "undefined") return local();
  let worker;
  try {
    worker = new Worker(new URL("./arenaWorker.js", import.meta.url), { type: "module" });
  } catch {
    return local();
  }
  return new Promise((resolve, reject) => {
    let heard = false;
    worker.onmessage = (e) => {
      heard = true;
      const msg = e.data || {};
      if (msg.type === "progress") onProgress(msg.p);
      else {
        worker.terminate();
        if (msg.type === "done") resolve(msg.match);
        else reject(new Error(msg.error || "arena worker failed"));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      // The worker never started (e.g. blocked): fall back to the main thread.
      if (!heard) local().then(resolve, reject);
      else reject(new Error(e.message || "arena worker failed"));
    };
    worker.postMessage({ code, segments, bot, goal, seed, solo });
  });
}

/** playSolo({ code, segments, goal, seed, onProgress }) → Promise<solo result> (see arena.js runSolo). */
export const playSolo = (opts) => playMatch({ ...opts, bot: "rookie", solo: true });
