// Arena match worker (v3 phase 3): runs one headless match off the main
// thread, so the farm's 3D rendering and the page loop never slow a match
// down (and a match can never stall the page). Protocol:
//   in:  { code, segments, bot, goal, seed, solo? }
//   out: { type: "progress", p } … then { type: "done", result } | { type: "error", error }
//   result: the runMatch() match; solo (v4 friend arena): runSolo() instead, its
//   result ({ reached, ticks, ops, … }).
import { runMatch, runSolo } from "./arena.js";
import { mapLine } from "./program.js";

self.onmessage = async (e) => {
  const { code, segments, bot, goal, seed, solo } = e.data || {};
  try {
    const result = await (solo ? runSolo : runMatch)({
      code,
      bot,
      goal,
      seed,
      mapLine: Array.isArray(segments) ? (line) => mapLine(segments, line) : undefined,
      onProgress: (p) => self.postMessage({ type: "progress", p }),
      uiPause: () => Promise.resolve(), // no UI in here: progress messages are enough
      uiEveryMs: 50,
    });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", error: String(err?.message || err) });
  }
};
