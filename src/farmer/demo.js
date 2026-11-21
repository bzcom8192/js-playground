// Demo farm for visual QA (#/farmer?demo=1). Never saved: the page leaves
// demo mode (back to the real save) on the first edit / run / save / buy.
import { UNLOCKS, WORLD_SIZES } from "./constants.js";
import * as W from "./world.js";
import { DEMO_WEATHER_SEED } from "./weather.js";

// Rows from North (y = 7) to South (y = 0).
//  W wheat (grown grass)  g young grass  T tree  B bush  C carrot
//  P grown pumpkin  p growing pumpkin  D dead pumpkin  S sunflower  X cactus  . bare soil
const LAYOUT = [
  "TWWTWCWS",
  "WTWWTWCS",
  "PPTCWTWX",
  "PPCBWWTX",
  "pDCBCWWX",
  "PPPpSWBX",
  "PPPCCWWg",
  "PPPp.CWW",
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
      if (ground === "Soil" && (x + y) % 5 === 0) tile.water = 0.6;
    });
  });
  Object.assign(s.items, {
    Hay: 9000,
    Wood: 10100,
    Carrot: 6100,
    Pumpkin: 3260,
    Power: 3320,
    Cactus: 2300,
    Water: 616,
    Fertilizer: 155,
    Gold: 1440,
    Bone: 625,
  });
  s.drone.x = 4;
  s.drone.y = 4;
  // Demo farms never write personal records (records.js checks this flag).
  s.demo = true;
  // Weather runs on the demo farm from a fixed seed; it is never persisted
  // (serialize writes weather: null for a demo farm).
  s.weather = { seed: DEMO_WEATHER_SEED, time: 0 };
  return s;
}

export const isDemoHash = (hash) => /[?&]demo=1\b/.test(hash || "");
