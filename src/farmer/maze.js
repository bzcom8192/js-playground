// JS Farmer — maze generation and maze geometry helpers (pure, no DOM).
//
// The farm grid itself is the maze: every tile is either a path tile (empty
// ground the drone can walk on) or a wall tile (an Entities.Hedge). Path
// tiles form a perfect maze — a spanning tree: every path tile is reachable
// and there is exactly one simple path between any two of them.
//
// Layout: the classic "cells + walls" lattice. Maze cells are the tiles whose
// x and y have the same parity as the drone's tile, so the drone always stands
// on a cell. A recursive backtracker (iterative DFS) visits every cell and
// carves the tile between two consecutive cells into a passage. Everything
// that is not a cell or a carved passage stays a hedge. Edges do not wrap.

import { DIR_DELTA } from "./constants.js";

const DIRS = ["North", "East", "South", "West"];

// ---------- seeds ----------
// Maze layout + treasure placement come from a seeded PRNG: a maze is fully
// determined by (seed, farm size, start tile), so a seed can be replayed for
// a fair comparison. The seed itself is drawn from ambient randomness.

export const SEED_MAX = 0xffffffff;

/** mulberry32: tiny, fast 32-bit PRNG → () => float in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random unsigned 32-bit seed from `rng` (ambient by default). */
export const randomSeed = (rng = Math.random) => Math.floor(rng() * 4294967296) >>> 0;

/** A valid seed (integer 0 … 2³²−1) or null. Accepts numbers and digit strings. */
export function parseSeed(v) {
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^\d{1,10}$/.test(t)) return null;
    v = Number(t);
  }
  return Number.isInteger(v) && v >= 0 && v <= SEED_MAX ? v : null;
}

/** generateMaze with the layout drawn from `seed` (see mulberry32). */
export const generateSeededMaze = (size, startX, startY, seed) => generateMaze(size, startX, startY, mulberry32(seed));

/**
 * generateMaze(size, startX, startY, rng) →
 *   { walls: boolean[size*size] (true = hedge), treasure: {x, y}, cells }
 * `treasure` is the path tile farthest (by path distance) from the start;
 * ties go to the first one found by the BFS (deterministic for a given rng).
 */
export function generateMaze(size, startX, startY, rng = Math.random) {
  const n = size;
  const walls = new Array(n * n).fill(true);
  const at = (x, y) => y * n + x;
  const isCell = (x, y) =>
    x >= 0 && y >= 0 && x < n && y < n && (x - startX) % 2 === 0 && (y - startY) % 2 === 0;

  const visited = new Set();
  const stack = [[startX, startY]];
  visited.add(at(startX, startY));
  walls[at(startX, startY)] = false;
  let cells = 1;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [];
    for (const d of DIRS) {
      const [dx, dy] = DIR_DELTA[d];
      const nx = x + 2 * dx;
      const ny = y + 2 * dy;
      if (isCell(nx, ny) && !visited.has(at(nx, ny))) options.push([nx, ny, x + dx, y + dy]);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, wx, wy] = options[Math.floor(rng() * options.length) % options.length];
    walls[at(wx, wy)] = false;
    walls[at(nx, ny)] = false;
    visited.add(at(nx, ny));
    cells++;
    stack.push([nx, ny]);
  }

  const dist = pathDistances(n, walls, startX, startY);
  let best = at(startX, startY);
  for (let i = 0; i < dist.length; i++) if (dist[i] > dist[best]) best = i;
  return { walls, treasure: { x: best % n, y: Math.floor(best / n) }, cells };
}

/** BFS distances over path tiles (4-neighbour, no wrap); -1 = unreachable or wall. */
export function pathDistances(n, walls, sx, sy) {
  const dist = new Array(n * n).fill(-1);
  if (walls[sy * n + sx]) return dist;
  dist[sy * n + sx] = 0;
  const queue = [[sx, sy]];
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q];
    for (const d of DIRS) {
      const [dx, dy] = DIR_DELTA[d];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const k = ny * n + nx;
      if (walls[k] || dist[k] !== -1) continue;
      dist[k] = dist[y * n + x] + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

/**
 * Direction of the treasure as seen from (x, y): the dominant axis of the
 * offset (dx = tx − x, dy = ty − y). |dx| ≥ |dy| → East/West (ties go to the
 * horizontal axis), otherwise North/South. null when (x, y) is the treasure.
 */
export function treasureDirection(x, y, tx, ty) {
  const dx = tx - x;
  const dy = ty - y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "East" : "West";
  return dy > 0 ? "North" : "South";
}
