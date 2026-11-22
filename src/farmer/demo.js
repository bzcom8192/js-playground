// Demo farm for visual QA (#/farmer?demo=1). Never saved: the page leaves
// demo mode (back to the real save) on the first edit / run / save / buy.
import { UNLOCKS, WORLD_SIZES } from "./constants.js";
import * as W from "./world.js";
import { DEMO_WEATHER_SEED } from "./weather.js";

// A little of everything in beds around a centre path. Rows from North (y = 7)
// to South (y = 0).
//  W grown grass  g young grass  T tree  B bush  C carrot  R rice
//  P grown pumpkin  p growing pumpkin  D dead pumpkin  S sunflower  X cactus  . bare soil
const LAYOUT = [
  "TBTWWTBT",
  "RRRggCCC",
  "RRRgWPPC",
  "SX.gWPPC",
  "SXXgWCCC",
  "BPPPgpDB",
  "WPPPgXXS",
  "TPPPWXSS",
];

const CODES = {
  W: ["Grass", "Grassland", 1],
  g: ["Grass", "Grassland", 0.35],
  T: ["Tree", "Grassland", 1],
  B: ["Bush", "Grassland", 1],
  C: ["Carrot", "Soil", 1],
  P: ["Pumpkin", "Soil", 1],
  p: ["Pumpkin", "Soil", 0.8],
  D: ["Dead_Pumpkin", "Soil", 1],
  R: ["Rice", "Soil", 1],
  S: ["Sunflower", "Soil", 1],
  X: ["Cactus", "Soil", 1],
  ".": [null, "Soil", 0],
};

export function createDemoGame() {
  const s = W.createGame();
  for (const u of UNLOCKS) s.unlocks[u.id] = u.maxLevel;
  s.unlocks.Expand = WORLD_SIZES.indexOf(8);
  s.size = 8;
  s.tiles = Array.from({ length: 64 }, W.newTile);
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  LAYOUT.forEach((row, r) => {
    const y = 7 - r;
    [...row].forEach((ch, x) => {
      const [type, ground, progress] = CODES[ch];
      const tile = W.tileAt(s, x, y);
      tile.ground = ground;
      if (type) tile.entity = W.makeEntity(type, rng, progress);
      if (type === "Rice") tile.water = 0.8;
      else if (ground === "Soil" && (x + 2 * y) % 7 === 0) tile.water = 0.6;
    });
  });
  Object.assign(s.items, {
    Hay: 5240,
    Wood: 4480,
    Carrot: 2750,
    Pumpkin: 1890,
    Power: 320,
    Cactus: 940,
    Water: 18,
    Fertilizer: 45,
    Gold: 860,
    Bone: 144,
    Rice: 410,
  });
  s.drone.x = 3;
  s.drone.y = 4;
  // Demo farms never write personal records (records.js checks this flag).
  s.demo = true;
  // Weather runs on the demo farm from a fixed seed; it is never persisted
  // (serialize writes weather: null for a demo farm).
  s.weather = { seed: DEMO_WEATHER_SEED, time: 0 };
  return s;
}

export const isDemoHash = (hash) => /[?&]demo=1\b/.test(hash || "");
