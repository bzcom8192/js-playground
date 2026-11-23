// 3D board: layout math, model kit and scene diffing (node, no WebGL).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as W from "./world.js";
import { createDemoGame } from "./demo.js";
import { findGiantPumpkins } from "./boardModel.js";
import {
  boardTargetPx,
  dieScale,
  growthScale,
  isWrapJump,
  lerpAngle,
  modelKey,
  popScale,
  tileToWorld,
  waterLevel,
} from "./board3d/layout.js";
import { countTriangles, createModelKit } from "./board3d/models.js";
import { CAMERA_ELEVATION_DEG, FarmScene } from "./board3d/FarmScene.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("tileToWorld centres the board, North is −z (away from the camera)", () => {
  assert.deepEqual(tileToWorld(1, 0, 0), { x: 0, z: 0 });
  const sw = tileToWorld(8, 0, 0);
  const ne = tileToWorld(8, 7, 7);
  assert.ok(near(sw.x, -3.5) && near(sw.z, 3.5));
  assert.ok(near(ne.x, 3.5) && near(ne.z, -3.5));
});

test("wrap detection and angle lerp", () => {
  assert.equal(isWrapJump(0, 0, 1, 0), false);
  assert.equal(isWrapJump(0, 0, 7, 0), true);
  assert.equal(isWrapJump(3, 7, 3, 0), true);
  // Shortest path across ±π.
  const a = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(near(Math.abs(a), Math.PI, 1e-9));
});

test("growth, pop and harvest scales", () => {
  const [gx0, gy0] = growthScale("Grass", 0);
  const [gx1, gy1] = growthScale("Grass", 1);
  assert.ok(gy0 < 0.25 && gy1 === 1 && gx1 === 1 && gx0 > 0.5, "wheat shoots up");
  assert.deepEqual(growthScale("Tree", 1), [1, 1, 1]);
  assert.ok(growthScale("Tree", 0)[0] === 0.3);
  assert.ok(growthScale("Bush", 0.5)[0] > growthScale("Bush", 0.2)[0]);
  assert.ok(near(popScale(0), 0.6));
  assert.equal(popScale(1), 1);
  let peak = 0;
  for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, popScale(t));
  assert.ok(peak > 1 && peak < 1.1, `pop stays subtle (${peak})`);
  assert.ok(dieScale(0.3) > 1 && dieScale(1) === 0);
});

test("modelKey only rebuilds when the model really changes", () => {
  assert.equal(modelKey(null), null);
  assert.equal(modelKey({ type: "Grass", progress: 0.2 }), modelKey({ type: "Grass", progress: 1 }));
  assert.equal(modelKey({ type: "Tree", progress: 0.2 }), modelKey({ type: "Tree", progress: 1 }));
  assert.notEqual(modelKey({ type: "Bush", progress: 0.2 }), modelKey({ type: "Bush", progress: 1 }));
  assert.notEqual(modelKey({ type: "Cactus", size: 3, progress: 1 }), modelKey({ type: "Cactus", size: 4, progress: 1 }));
  assert.equal(waterLevel(0), 0);
  assert.equal(waterLevel(0.6), 6);
  assert.equal(waterLevel(5), 10);
});

test("board target size grows with the farm and fits the area", () => {
  const a = boardTargetPx(1, 1000, 900).w;
  const b = boardTargetPx(8, 1000, 900).w;
  const c = boardTargetPx(12, 1000, 900).w;
  assert.ok(a < b && b <= c);
  assert.ok(c <= 1000 * 0.88 + 1e-9);
});

test("model kit builds every entity, giants, slab and bot; dispose is clean", () => {
  const kit = createModelKit();
  const types = ["Grass", "Bush", "Tree", "Carrot", "Pumpkin", "Dead_Pumpkin", "Sunflower", "Cactus"];
  for (const type of types) {
    for (const progress of [0.3, 1]) {
      const obj = kit.buildEntity({ type, progress, size: 4, petals: 9 }, 1);
      assert.ok(obj, type);
      let meshes = 0;
      obj.traverse((o) => o.isMesh && meshes++);
      assert.ok(meshes >= 1, `${type} has a mesh`);
      assert.ok(countTriangles(obj) > 10, `${type} has geometry`);
      kit.release(obj);
    }
  }
  assert.equal(kit.buildEntity({ type: "Nope", progress: 1 }), null);
  const giant = kit.buildGiantPumpkin(3);
  const box = new THREE.Box3().setFromObject(giant);
  assert.ok(box.max.x - box.min.x > 2.4 && box.max.x - box.min.x < 3.3, "giant spans ~k tiles");
  const slab = kit.buildSlab(8);
  kit.release(slab);
  const d = kit.buildBot();
  assert.equal(d.wheels.length, 4);
  // The status light has its own colour per state; unknown states read as idle.
  const colors = ["idle", "running", "paused", "error"].map((s) => (d.setStatus(s), d.light.material.color.getHexString()));
  assert.equal(new Set(colors).size, 4);
  d.setStatus("stopped");
  assert.equal(d.light.material.color.getHexString(), colors[0]);
  kit.release(d.root);
  kit.release(d.shadow);
  // Geometry is shared per variant.
  const g1 = kit.buildEntity({ type: "Tree", progress: 1 }, 0);
  const g2 = kit.buildEntity({ type: "Tree", progress: 1 }, 3);
  assert.equal(g1.children[0].geometry, g2.children[0].geometry);
  kit.dispose();
  assert.equal(kit.stats().geometries, 0);
});

test("scene sync: demo farm, giant pumpkins hidden tiles, no rebuild when unchanged", () => {
  const game = createDemoGame();
  const fs = new FarmScene();
  fs.sync(game);
  const giants = findGiantPumpkins(game);
  assert.equal(giants.length, 2);
  const hiddenCells = giants.reduce((s, g) => s + g.cells.length, 0);
  const entities = game.tiles.filter((t) => t.entity).length;
  assert.equal(fs.builds, entities - hiddenCells + giants.length);
  assert.equal(fs.giants.size, 2);
  const before = fs.builds;
  for (let i = 0; i < 5; i++) {
    fs.sync(game);
    fs.update(1 / 60);
  }
  assert.equal(fs.builds, before, "steady state never rebuilds");
  fs.dispose();
});

test("scene sync: harvest pops out, planting pops in, growth only rescales", () => {
  const game = W.createGame();
  game.tiles[0].entity = W.makeEntity("Bush", Math.random, 0.2);
  const fs = new FarmScene();
  fs.sync(game);
  const rec = fs.tiles[0];
  const builds = fs.builds;
  assert.equal(rec.pop, 1, "initial build has no pop");
  const s0 = rec.model.scale.x;

  game.tiles[0].entity.progress = 0.6;
  fs.sync(game);
  for (let i = 0; i < 60; i++) fs.update(1 / 60);
  assert.equal(fs.builds, builds, "growth does not rebuild");
  assert.ok(rec.model.scale.x > s0, "growth scales the model");

  game.tiles[0].entity = null; // harvested
  fs.sync(game);
  assert.equal(rec.model, null);
  assert.equal(fs.dying.length, 1, "harvest pop");
  fs.update(0.1);
  fs.update(0.1);
  fs.update(0.1);
  assert.equal(fs.dying.length, 0, "harvest pop finishes and frees the model");

  game.tiles[0].entity = W.makeEntity("Bush", Math.random, 0);
  fs.sync(game);
  assert.ok(rec.pop < 1, "planting pop");
  fs.update(0.1);
  fs.update(0.1);
  fs.update(0.1);
  assert.equal(rec.pop, 1);

  game.tiles[0].ground = "Soil";
  game.tiles[0].water = 0.5;
  fs.sync(game);
  assert.equal(rec.water.visible, true);
  fs.dispose();
});

test("pause freezes growth and the drone", () => {
  const game = W.createGame();
  game.unlocks.Expand = 3;
  game.size = 4;
  game.tiles = Array.from({ length: 16 }, W.newTile);
  game.tiles[5].entity = W.makeEntity("Grass", Math.random, 0.1);
  const fs = new FarmScene();
  fs.sync(game);
  fs.update(1 / 60);
  game.tiles[5].entity.progress = 0.9;
  game.drone.x = 1;
  fs.sync(game);
  const dp = fs.tiles[5].dp;
  const dx = fs.drone.x;
  for (let i = 0; i < 30; i++) fs.update(1 / 60, { paused: true });
  assert.equal(fs.tiles[5].dp, dp);
  assert.equal(fs.drone.x, dx);
  for (let i = 0; i < 60; i++) fs.update(1 / 60, { paused: false });
  assert.ok(fs.tiles[5].dp > 0.85);
  fs.dispose();
});

test("drone glides between tiles, teleports across a wrap, faces its travel", () => {
  const game = W.createGame();
  game.size = 4;
  game.tiles = Array.from({ length: 16 }, W.newTile);
  const fs = new FarmScene();
  fs.sync(game);
  fs.update(1 / 60, { moveMs: 150 });
  const start = fs.drone.x;
  game.drone.x = 1; // East
  fs.update(1 / 60, { moveMs: 150 });
  const target = tileToWorld(4, 1, 0).x;
  assert.ok(fs.drone.x > start && fs.drone.x < target, "mid-glide after one frame");
  assert.ok(near(fs.drone.yawAngle, 0, 1) && fs.drone.yawAngle > 0, "turning toward +x");
  for (let i = 0; i < 60; i++) fs.update(1 / 60, { moveMs: 150 });
  assert.ok(near(fs.drone.x, target, 1e-3));
  game.drone.x = 0;
  game.drone.y = 3; // wrap South → North edge
  fs.update(1 / 60, { moveMs: 150 });
  assert.ok(near(fs.drone.z, tileToWorld(4, 0, 3).z), "wrap teleports");
  fs.dispose();
});

test("camera: fixed ~55° framing, board centred and sized to the target", () => {
  const game = createDemoGame();
  const fs = new FarmScene();
  fs.sync(game);
  fs.fit(1056, 940);
  const cam = fs.camera;
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const pitch = (Math.asin(-dir.y) * 180) / Math.PI;
  assert.ok(Math.abs(pitch - CAMERA_ELEVATION_DEG) < 0.5, `pitch ${pitch}`);
  // Near edge (South) projects wider than the far edge (North).
  const p = (x, z) => new THREE.Vector3(x, 0, z).project(cam);
  const nearW = p(4, 4).x - p(-4, 4).x;
  const farW = p(4, -4).x - p(-4, -4).x;
  assert.ok(farW < nearW && farW > nearW * 0.75, "far side slightly smaller");
  assert.ok(Math.abs(p(0, 0).x) < 1e-6, "centred horizontally");
  const wantPx = boardTargetPx(8, 1056, 940).w;
  assert.ok(Math.abs((nearW / 2) * 1056 - wantPx) < wantPx * 0.06, "near edge ≈ target width");
  fs.dispose();
});

test("12×12 farm full of wheat stays within the triangle budget", () => {
  const game = W.createGame();
  game.size = 12;
  game.tiles = Array.from({ length: 144 }, () => ({ ...W.newTile(), entity: W.makeEntity("Grass", Math.random, 1) }));
  const fs = new FarmScene();
  fs.sync(game);
  const tris = countTriangles(fs.scene);
  assert.ok(tris < 400_000, `${tris} triangles`);
  let meshes = 0;
  fs.scene.traverse((o) => o.isMesh && o.visible && meshes++);
  assert.ok(meshes < 500, `${meshes} meshes`);
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) {
    fs.sync(game);
    fs.update(1 / 60);
  }
  const perFrame = (performance.now() - t0) / 120;
  assert.ok(perFrame < 4, `per-frame CPU ${perFrame.toFixed(3)} ms`);
  fs.dispose();
});

// ---------- detail pass (BRIEF18) ----------

/** The demo layout repeated over a 12×12 farm; `only` fills every tile with that ripe crop. */
function farm12(only) {
  const game = createDemoGame();
  const src = game.tiles;
  game.size = 12;
  game.tiles = Array.from({ length: 144 }, (_, i) => {
    const t = structuredClone(src[(Math.floor(i / 12) % 8) * 8 + ((i % 12) % 8)]);
    if (only) t.entity = { ...W.makeEntity(only, Math.random, 1), size: 9 };
    return t;
  });
  return game;
}

test("triangle budget: full 12×12 demo farm < 180k, any single crop < 300k", () => {
  const count = (game) => {
    const fs = new FarmScene();
    fs.sync(game);
    fs.update(1 / 60);
    const tris = countTriangles(fs.scene);
    fs.dispose();
    return tris;
  };
  const demo = count(farm12());
  assert.ok(demo < 180_000, `demo 12×12: ${demo}`);
  for (const type of ["Grass", "Rice", "Dead_Rice", "Bush", "Tree", "Carrot", "Dead_Pumpkin", "Sunflower", "Cactus"]) {
    const tris = count(farm12(type));
    assert.ok(tris < 300_000, `${type}: ${tris}`);
  }
});

test("crops are smooth, indexed and shared; ripe models differ from young ones", () => {
  const kit = createModelKit();
  const meshOf = (type, progress, variant = 0) => {
    let mesh;
    kit.buildEntity({ type, progress, size: 4 }, variant).traverse((o) => o.isMesh && (mesh = o));
    return mesh;
  };
  for (const type of ["Grass", "Rice", "Dead_Rice", "Bush", "Tree", "Carrot", "Pumpkin", "Dead_Pumpkin", "Sunflower", "Cactus"]) {
    const a = meshOf(type, 1, 0);
    assert.ok(a.geometry.index, `${type} shares vertices`);
    assert.ok(!a.material.flatShading, `${type} is smooth-shaded`);
    assert.equal(a.geometry, meshOf(type, 1, 3).geometry, `${type}: one geometry per variant, not per tile`);
    for (const name of ["position", "normal", "color"]) {
      assert.ok(a.geometry.attributes[name].array.every(Number.isFinite), `${type} ${name} is finite`);
    }
    assert.ok(a.geometry.boundingBox.min.y < 0.02, `${type} stands on the ground`);
  }
  // Ripe bush = berries, ripe carrot = orange shoulder, ripe cactus = flower.
  for (const type of ["Bush", "Carrot", "Cactus"]) {
    assert.ok(countTriangles(meshOf(type, 1)) > countTriangles(meshOf(type, 0.5)), `${type} ripens visibly`);
  }
  // Cactus height still follows its size, 0 → 9.
  let last = 0;
  for (let size = 0; size <= 9; size++) {
    let mesh;
    kit.buildEntity({ type: "Cactus", progress: 1, size }).traverse((o) => o.isMesh && (mesh = o));
    const h = mesh.geometry.boundingBox.max.y;
    assert.ok(h > last + 0.02, `cactus ${size}: ${h}`);
    last = h;
  }
  // Merged pumpkins use their own finer mesh, shared by every giant.
  const g3 = kit.buildGiantPumpkin(3).children[0].geometry;
  assert.equal(g3, kit.buildGiantPumpkin(2).children[0].geometry);
  assert.ok(g3.index.count > 2 * meshOf("Pumpkin", 1).geometry.index.count);
  kit.dispose();
});

test("bot: paint, metal, rubber and glass have their own surface; bots of one colour share meshes", () => {
  const kit = createModelKit();
  const a = kit.buildBot();
  const b = kit.buildBot();
  const bodyOf = (d) => d.spin.children[0];
  assert.equal(bodyOf(a).geometry, bodyOf(b).geometry);
  assert.equal(a.wheels[0].geometry, b.wheels[3].geometry);
  const mats = [...bodyOf(a).material, ...a.wheels[0].material];
  for (const m of [bodyOf(a), a.wheels[0]]) assert.equal(m.geometry.groups.length, m.material.length);
  const surfaces = new Set(mats.map((m) => `${m.roughness}/${m.metalness}`));
  assert.equal(surfaces.size, 4);
  const [paint, metal, glass] = bodyOf(a).material;
  const rubber = a.wheels[0].material[0];
  assert.ok(metal.metalness > paint.metalness && rubber.metalness === 0);
  assert.ok(glass.roughness < paint.roughness && paint.roughness < rubber.roughness);
  // Wheels stand on the ground and stay round enough to roll.
  const box = a.wheels[0].geometry.boundingBox;
  assert.ok(near(box.max.y, 0.085, 0.004) && near(box.min.y, -0.085, 0.004), "wheel radius unchanged");
  for (const d of [a, b]) {
    kit.release(d.root);
    kit.release(d.shadow);
  }
  kit.dispose();
});

test("tiles: soil is furrowed, grass is not, and two looks alternate per ground", () => {
  const kit = createModelKit();
  const soil = kit.buildTile("Soil", 0);
  const grass = kit.buildTile("Grassland", 0);
  assert.ok(soil.geometry.attributes.position.array.some((v, i) => i % 3 === 1 && v < -0.02 && v > -0.05), "furrows");
  assert.ok(soil.geometry.boundingBox.max.y <= 1e-9, "ridges stay below the water plane");
  assert.notEqual(soil.geometry, grass.geometry);
  assert.notEqual(soil.material[1], kit.buildTile("Soil", 1).material[1]);
  assert.equal(soil.material[1], kit.buildTile("Soil", 2).material[1]);
  kit.setTileGround(grass, "Soil", 0);
  assert.equal(grass.geometry, soil.geometry);
  assert.equal(grass.material, soil.material);
  kit.dispose();
});

test("shadow map is redrawn only when a shadow caster changes", () => {
  const game = W.createGame();
  game.size = 3;
  game.tiles = Array.from({ length: 9 }, W.newTile);
  game.tiles[4].entity = W.makeEntity("Bush", Math.random, 0.2);
  const fs = new FarmScene();
  const frame = () => {
    fs.sync(game);
    fs.update(1 / 60);
    return fs.takeShadowDirty();
  };
  assert.equal(frame(), true, "first frame");
  for (let i = 0; i < 5; i++) frame();
  assert.equal(frame(), false, "idle farm keeps its shadows");
  game.drone.x = 1;
  for (let i = 0; i < 10; i++) assert.equal(frame(), false, "the bots cast no shadow-map shadow");
  // Growth: every third frame while it lasts, and never left stale.
  game.tiles[4].entity.progress = 0.8;
  const seen = Array.from({ length: 60 }, frame);
  const redraws = seen.filter(Boolean).length;
  assert.ok(redraws > 3 && redraws <= 21, `${redraws} redraws in 60 frames`);
  for (let i = 1; i < seen.length; i++) assert.ok(!(seen[i] && seen[i - 1]), "not on consecutive frames");
  assert.equal(fs.shadowStale, false);
  // Harvest and planting: at once.
  game.tiles[4].entity = null;
  assert.equal(frame(), true);
  for (let i = 0; i < 60; i++) frame();
  game.tiles[0].entity = W.makeEntity("Tree", Math.random, 0);
  assert.equal(frame(), true);
  fs.dispose();
});

// ---------- BRIEF22: the set pieces are gone ----------

test("no hedge, chest, apple or dinosaur models are left; a stray old tile type builds nothing and hides no ground", () => {
  const kit = createModelKit();
  for (const type of ["Hedge", "Treasure", "Apple", "Dinosaur"]) assert.equal(kit.buildEntity({ type, progress: 1 }, 0), null, type);
  assert.equal(kit.buildDinoSegment, undefined);
  assert.equal(kit.setDinoPart, undefined);
  kit.dispose();
  // A hand-made state with an old entity on a tile (a save never loads one): nothing drawn, the ground stays.
  const game = W.createGame();
  game.size = 2;
  game.tiles = Array.from({ length: 4 }, W.newTile);
  game.tiles[1].entity = { type: "Hedge", progress: 1 };
  const fs = new FarmScene();
  for (let i = 0; i < 60; i++) {
    fs.sync(game);
    fs.update(1 / 60);
  }
  assert.ok(fs.tiles.every((r) => r.tile.visible));
  assert.equal(fs.tiles[1].model, null);
  fs.dispose();
});
