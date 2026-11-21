// Display snapshot for the farm's info strip (StatusPill).
//
// The engine keeps mutating the same game object and refreshes the page at
// ~30 fps; at high game speed the strip's numbers (ticks, clock) then change
// too fast to read. The strip instead shows a plain snapshot of these fields,
// re-sampled every STRIP_REFRESH_MS (see useSampled.js). Display-only: the
// engine still runs at full speed.
import { ENTITY_INFO, RICE_WITHER_TICKS } from "./constants.js";
import * as W from "./world.js";
import { WEATHER_TICKS_PER_SEC, weatherLabel } from "./weather.js";

export const STRIP_REFRESH_MS = 250;

/** Plain (primitive-only) values the strip renders, in display form. */
export function stripFields(game, stats, status, paused) {
  const tile = W.droneTile(game);
  const e = tile.entity;
  let what = e
    ? `${ENTITY_INFO[e.type]?.icon ?? ""} ${e.type.replace("_", " ")}${e.progress < 1 ? ` ${Math.floor(e.progress * 100)}%` : ""}${dinoPart(game)} / ${tile.ground}`
    : tile.ground;
  if (game.maze) what += ` · ${mazeNeighbours(game)}`;
  // Growing rice on a dry tile: how long it has been dry (it withers past the limit).
  if (e?.type === "Rice" && e.progress < 1 && e.dry > 0) what += ` · dry ${Math.floor(e.dry)}/${RICE_WITHER_TICKS}`;
  const fields = {
    x: game.drone.x,
    y: game.drone.y,
    what,
    water: tile.water > 0.005 ? Math.round(tile.water * 100) : null,
    elapsed: stats.elapsed.toFixed(1),
    ticks: stats.ticks.toLocaleString("en-US"),
    measure: stats.lastMeasure ?? null,
    status: paused ? "paused" : status,
  };
  // Megafarm: the strip still follows drone 0; with helpers on the farm it
  // also notes how many drones there are (absent with one drone, so the
  // single-drone strip is exactly as before).
  const drones = W.allDrones(game).length;
  if (drones > 1) fields.drones = drones;
  // Weather (v3 phase 4): icon + name, absent on a weatherless world.
  const weather = W.currentWeather(game);
  if (weather) fields.weather = weatherLabel(weather);
  return fields;
}

/** On a dinosaur segment: " head 1/5", " 3/5" or " tail 5/5" (segment from the head / length). */
export function dinoPart(game) {
  const i = W.dinoSegment(game, game.drone.x, game.drone.y);
  if (i < 0) return "";
  const len = game.dino.body.length;
  const label = i === 0 ? " head" : i === len - 1 ? " tail" : "";
  return `${label} ${i + 1}/${len}`;
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

// Info window → Weather: sampled like the strip, but once a second (the
// forecast's tick count is re-blurred every world tick). The forecast shown
// is exactly what get_forecast() returns at that tick — the same approximate
// data, never the true time — so the UI gives away nothing a program can't buy.
export const WEATHER_REFRESH_MS = 1000;

/** Plain display values for the Weather section, or null without weather. */
export function weatherFields(game) {
  const now = W.currentWeather(game);
  if (!now) return null;
  const f = W.weatherForecast(game);
  return {
    now,
    next: f.next,
    inTicks: f.inTicks,
    // ≈ farm time, from the approximate ticks (10 world ticks per second).
    approxSeconds: Math.round(f.inTicks / WEATHER_TICKS_PER_SEC),
  };
}
