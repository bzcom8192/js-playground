// Display snapshot for the farm's info strip (StatusPill).
//
// The engine keeps mutating the same game object and refreshes the page at
// ~30 fps; at high game speed the strip's numbers (ticks, clock) then change
// too fast to read. The strip instead shows a plain snapshot of these fields,
// re-sampled every STRIP_REFRESH_MS (see useSampled.js). Display-only: the
// engine still runs at full speed.
import { ENTITY_INFO } from "./constants.js";
import * as W from "./world.js";

export const STRIP_REFRESH_MS = 250;

/** Plain (primitive-only) values the strip renders, in display form. */
export function stripFields(game, stats, status, paused) {
  const tile = W.droneTile(game);
  const e = tile.entity;
  const what = e
    ? `${ENTITY_INFO[e.type]?.icon ?? ""} ${e.type.replace("_", " ")}${e.progress < 1 ? ` ${Math.floor(e.progress * 100)}%` : ""} / ${tile.ground}`
    : tile.ground;
  return {
    x: game.drone.x,
    y: game.drone.y,
    what,
    water: tile.water > 0.005 ? Math.round(tile.water * 100) : null,
    elapsed: stats.elapsed.toFixed(1),
    ticks: stats.ticks.toLocaleString("en-US"),
    measure: stats.lastMeasure ?? null,
    status: paused ? "paused" : status,
  };
}

/** Shallow equality for flat snapshot objects. */
export function sameFields(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}
