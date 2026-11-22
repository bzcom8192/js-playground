// Semicolon Acres Online — the replay verifier (anti-cheat level 2). Every
// verification runs src/farmer/verify.js in its OWN worker_thread
// (verifyWorker.js) with:
//  - a wall-clock timeout (default VERIFY_TIMEOUT_MS = 10 s): past it the
//    worker is terminated — also mid-busy-loop — and the job is rejected;
//  - V8 heap limits (resourceLimits), so a memory bomb kills only the worker;
//  - the engine's own caps (arena 200,000 ticks; maze replay 5,000,000 run
//    ticks / virtual ms and 2,000,000 ops, also for the daily race; dino benchmark 300,000 virtual ms
//    and 2,000,000 ops), which end normal runs on their own.
// At most `maxConcurrent` workers run at once; up to `maxQueue` more jobs
// wait; beyond that verify() answers { ok: false, code: "busy" } at once.
// The API process never runs submitted code itself and never throws from
// verify(): every failure is a { ok: false, code, error } value.
import { Worker } from "node:worker_threads";
import { VERIFY_TIMEOUT_MS } from "../src/farmer/verify.js";
import { DINO_MAX_BONE } from "../src/farmer/onlineRules.js";

const WORKER_URL = new URL("./verifyWorker.js", import.meta.url);

export const DEFAULT_RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 });

const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Shape check of a worker's answer (it ran untrusted code: trust nothing). */
function cleanResult(job, r) {
  if (!r || typeof r !== "object") return null;
  if (job.kind === "arena") {
    if (typeof r.reached !== "boolean" || !isCount(r.ticks) || !isCount(r.ops)) return null;
    return { kind: "arena", reached: r.reached, ticks: r.ticks, ops: r.ops, reason: String(r.reason ?? ""), error: r.error == null ? null : String(r.error) };
  }
  if (job.kind === "dino") {
    if (typeof r.harvested !== "boolean") return null;
    if (r.harvested && (!isCount(r.bone) || r.bone < 1 || r.bone > DINO_MAX_BONE || !isCount(r.ticks) || !isCount(r.ops))) return null;
    return {
      kind: "dino",
      harvested: r.harvested,
      bone: r.harvested ? r.bone : null,
      ticks: r.harvested ? r.ticks : null,
      ops: r.harvested ? r.ops : null,
      reason: String(r.reason ?? ""),
      error: r.error == null ? null : String(r.error),
    };
  }
  if (typeof r.solved !== "boolean") return null;
  if (r.solved && (!isCount(r.ticks) || !isCount(r.ops))) return null;
  if (job.kind === "daily") {
    return {
      kind: "daily",
      solved: r.solved,
      ticks: r.solved ? r.ticks : null,
      ops: r.solved ? r.ops : null,
      reason: String(r.reason ?? ""),
      error: r.error == null ? null : String(r.error),
    };
  }
  return {
    kind: "maze",
    solved: r.solved,
    mode: String(r.mode ?? ""),
    ticks: r.solved ? r.ticks : null,
    ops: r.solved ? r.ops : null,
    reason: String(r.reason ?? ""),
    firstTry: r.firstTry == null ? null : String(r.firstTry),
    wrongStart: r.wrongStart && isCount(r.wrongStart.x) && isCount(r.wrongStart.y) ? { x: r.wrongStart.x, y: r.wrongStart.y } : null,
    error: r.error == null ? null : String(r.error),
  };
}

/**
 * createVerifier({ timeoutMs, maxConcurrent, maxQueue, resourceLimits }) →
 *  { verify(job) → Promise<{ ok: true, result, ms } | { ok: false, code, error }>,
 *    close(), stats() }
 *  job: { kind: "arena", code, goal, seed } | { kind: "maze", code, level, seed }
 *    | { kind: "dino", code } | { kind: "daily", code, seed }
 *  code: "timeout" | "crash" | "busy" | "closed"
 */
export function createVerifier({ timeoutMs = VERIFY_TIMEOUT_MS, maxConcurrent = 2, maxQueue = 16, resourceLimits = DEFAULT_RESOURCE_LIMITS } = {}) {
  const running = new Set();
  const queue = [];
  let closed = false;

  function runOne(job) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let worker;
      try {
        worker = new Worker(WORKER_URL, { workerData: job, resourceLimits, stdout: true, stderr: true, env: {} });
      } catch (err) {
        resolve({ ok: false, code: "crash", error: `could not start the verifier: ${err?.message || err}` });
        return;
      }
      worker.stdout?.resume(); // discard anything the worker prints
      worker.stderr?.resume();
      running.add(worker);
      let settled = false;
      const done = (out) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        running.delete(worker);
        worker.terminate().catch(() => {});
        resolve(out);
      };
      const timer = setTimeout(
        () => done({ ok: false, code: "timeout", error: `the replay took longer than ${Math.round(timeoutMs / 100) / 10} s (wall-clock limit)` }),
        timeoutMs,
      );
      worker.on("message", (msg) => {
        if (!msg || typeof msg !== "object" || msg.ok !== true) {
          return done({ ok: false, code: "crash", error: `the replay failed: ${String(msg?.error ?? "no result")}` });
        }
        const result = cleanResult(job, msg.result);
        if (!result) return done({ ok: false, code: "crash", error: "the replay returned a malformed result" });
        done({ ok: true, result, ms: Date.now() - t0 });
      });
      worker.on("error", (err) => {
        const oom = err?.code === "ERR_WORKER_OUT_OF_MEMORY";
        done({ ok: false, code: "crash", error: oom ? "the replay ran out of memory" : `the replay crashed: ${err?.message || err}` });
      });
      worker.on("exit", (c) => done({ ok: false, code: "crash", error: `the replay ended without a result (exit ${c})` }));
    });
  }

  function pump() {
    while (!closed && running.size < maxConcurrent && queue.length) {
      const { job, resolve } = queue.shift();
      const slot = runOne(job);
      // runOne adds its worker synchronously; reserve the slot until it settles.
      slot.then((out) => {
        resolve(out);
        pump();
      });
    }
  }

  return {
    verify(job) {
      if (closed) return Promise.resolve({ ok: false, code: "closed", error: "the verifier is shut down" });
      if (running.size >= maxConcurrent && queue.length >= maxQueue) {
        return Promise.resolve({ ok: false, code: "busy", error: "the replay verifier is busy, try again in a moment" });
      }
      return new Promise((resolve) => {
        queue.push({ job, resolve });
        pump();
      });
    },
    stats: () => ({ running: running.size, queued: queue.length }),
    async close() {
      closed = true;
      for (const q of queue.splice(0)) q.resolve({ ok: false, code: "closed", error: "the verifier is shut down" });
      await Promise.all([...running].map((w) => w.terminate().catch(() => {})));
      running.clear();
    },
  };
}
