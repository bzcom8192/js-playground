// Daily race worker (v5 phase 3): one run on the race course, off the main
// thread (the arenaWorker.js pattern). The course is a throwaway world, so
// nothing here can touch the player's farm, save or records. Protocol:
//   in:  { code, segments, seed }
//   out: { type: "done", result } (a verifyDaily result) | { type: "error", error }
import { mapLine } from "./program.js";
import { verifyDaily } from "./verify.js";

self.onmessage = async (e) => {
  const { code, segments, seed } = e.data || {};
  try {
    const result = await verifyDaily({ code, seed, mapLine: Array.isArray(segments) ? (line) => mapLine(segments, line) : undefined });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", error: String(err?.message || err) });
  }
};
