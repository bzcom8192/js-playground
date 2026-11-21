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
  let what = e
    ? `${ENTITY_INFO[e.type]?.icon ?? ""} ${e.type.replace("_", " ")}${e.progress < 1 ? ` ${Math.floor(e.progress * 100)}%` : ""} / ${tile.ground}`
    : tile.ground;
  if (game.maze) what += ` · ${mazeNeighbours(game)}`;
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

const SHORT = { North: "N", East: "E", South: "S", West: "W" };

/** In a maze: which neighbouring tiles are Hedge / Treasure, e.g. "🟩 Hedge N S W · 💰 Treasure E". */
export function mazeNeighbours(game) {
  const near = { Hedge: [], Treasure: [] };
  for (const dir of ["North", "East", "South", "West"]) {
    const n = W.neighbor(game, game.drone.x, game.drone.y, dir, false);
    // The farm edge is a maze wall too.
    const type = n ? W.tileAt(game, n.x, n.y).entity?.type : "Hedge";
    if (near[type]) near[type].push(SHORT[dir]);
  }
  const parts = Object.entries(near)
    .filter(([, dirs]) => dirs.length)
    .map(([type, dirs]) => `${ENTITY_INFO[type].icon} ${type} ${dirs.join(" ")}`);
  return parts.length ? parts.join(" · ") : "🧩 Maze";
}

/** Shallow equality for flat snapshot objects. */
export function sameFields(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}
