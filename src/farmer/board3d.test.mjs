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
