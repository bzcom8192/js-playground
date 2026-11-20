// Pure board helpers for FarmBoard (unit-tested in node).
import * as W from "./world.js";

/** Fully grown pumpkin groups forming a k×k square (k ≥ 2) → giant pumpkins. */
export function findGiantPumpkins(game) {
  const n = game.size;
  const seen = new Set();
  const giants = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      if (seen.has(k)) continue;
      const e = game.tiles[k].entity;
      if (!e || e.type !== "Pumpkin" || !W.isGrown(e)) continue;
      const group = W.pumpkinGroup(game, x, y);
      group.forEach((g) => seen.add(g.y * n + g.x));
      const xs = group.map((g) => g.x);
      const ys = group.map((g) => g.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const side = Math.max(...xs) - x0 + 1;
      if (side >= 2 && side === Math.max(...ys) - y0 + 1 && group.length === side * side) {
        giants.push({ x0, y0, k: side, cells: group.map((g) => g.y * n + g.x) });
      }
    }
  }
  return giants;
}

