// Scene graph for the 3D farm board. Pure three.js, no React and no
// renderer, so it can be exercised in node tests.
//
//  sync(game)        diff the (mutable) game state against what is shown and
//                    rebuild only the tiles/giants whose model changed
//  update(dt, opts)  per-frame work: growth scaling, pops, drone glide/bob
//  fit(w, h)         fixed camera framing for the current farm size
import * as THREE from "three";
import { findGiantPumpkins } from "../boardModel.js";
import { createModelKit, droneBand } from "./models.js";
import {
  boardTargetPx,
  dieScale,
  growthScale,
  isWrapJump,
  lerpAngle,
  modelKey,
  popScale,
  smoothToward,
  tileToWorld,
  waterLevel,
} from "./layout.js";

export const CAMERA_ELEVATION_DEG = 55;
const CAMERA_FOV = 22;
const HOVER = 0.95; // drone height above the tile tops
const POP_S = 0.28;
const DIE_S = 0.24;
const WHEAT_GREEN = new THREE.Color("#7fb23e");
const WHEAT_GOLD = new THREE.Color("#e6ad3c");

/** Segment shape: head, tail tip, or body (every other body segment has feet). */
export function dinoPartFor(i, len) {
  if (i === 0) return "head";
  if (i === len - 1) return "tail";
  return i % 2 === 1 ? "legs" : "body";
}

/** Width/height scale of segment i: a slightly big head, then the body tapers to ~0.78 at the tail. */
export const dinoSegScale = (i, len) => (i === 0 ? 1.12 : 1 - 0.22 * (i / Math.max(1, len - 1)));

const DIR_YAW = { North: Math.PI, East: Math.PI / 2, South: 0, West: -Math.PI / 2 };

/** Yaw of segment i: it faces the segment ahead (the head faces its last step). */
export function dinoYaw(body, i, dir) {
  const ahead = i === 0 ? null : body[i - 1];
  const from = i === 0 ? body[1] : body[i];
  const to = i === 0 ? body[0] : ahead;
  if (!from || !to) return DIR_YAW[dir] ?? 0;
  // Tile (dx, dy) → world (x, z) = (dx, −dy); model front is +z.
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

const variantOf = (x, y) => (x * 7 + y * 13 + ((x * y) % 5)) % 3;

export class FarmScene {
  constructor() {
    this.kit = createModelKit();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
    this.board = new THREE.Group();
    this.scene.add(this.board);

    // Warm sun from the upper left + soft sky/ground ambient.
    this.hemi = new THREE.HemisphereLight("#d8e8f5", "#8a5f33", 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#ffcf8c", 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.n = 0;
    this.game = null;
    this.tiles = [];
    this.giants = new Map();
    this.dying = [];
    // The dinosaur: one record per body segment (index-aligned with game.dino.body).
    this.dinoSegs = [];
    this.dinoSig = "";
    this.slab = null;
    this.view = { w: 0, h: 0 };
    this.animT = 0;
    this.builds = 0; // entity models built (tests / perf checks)

    // Drone 0 (the original). Megafarm helpers live in extraDrones
    // (extraDrones[k − 1] shows game.drones[k]), built on demand.
    this.drone = this._makeDrone(0);
    this.extraDrones = [];
  }

  _makeDrone(i) {
    const d = this.kit.buildDrone(droneBand(i));
    this.scene.add(d.root);
    this.scene.add(d.shadow);
    return {
      ...d,
      index: i,
      x: 0,
      z: 0,
      tx: null,
      ty: null,
      yawAngle: 0,
      flips: null,
      flipStart: -1,
      flipDur: 0.6,
    };
  }

  _dropDrone(rec) {
    this.scene.remove(rec.root, rec.shadow);
    this.kit.release(rec.shadow);
    this.kit.release(rec.root);
  }

  /** Every drone record, drone 0 first (index-aligned with game.drones). */
  get droneRecs() {
    return [this.drone, ...this.extraDrones];
  }

  // ---------- board structure ----------

  _clearBoard() {
    for (const rec of this.tiles) {
      if (rec.model) this._removeModel(rec.model, false);
      this.board.remove(rec.tile, rec.water);
    }
    for (const g of this.giants.values()) this._removeModel(g.model, false);
    for (const d of this.dying) this._removeModel(d.obj, false);
    for (const seg of this.dinoSegs) this._removeModel(seg.obj, false);
    this.dinoSegs = [];
    this.dinoSig = "";
    this.tiles = [];
    this.giants.clear();
    this.dying = [];
    if (this.slab) {
      this.board.remove(this.slab);
      this.kit.release(this.slab);
      this.slab = null;
    }
  }

  _buildBoard(game) {
    this._clearBoard();
    const n = game.size;
    this.n = n;
    this.slab = this.kit.buildSlab(n);
    this.board.add(this.slab);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const { x: wx, z: wz } = tileToWorld(n, x, y);
        const tile = this.kit.buildTile("Grassland");
        tile.position.set(wx, 0, wz);
        const water = this.kit.buildWater();
        water.position.set(wx, 0.01, wz);
        water.visible = false;
        this.board.add(tile, water);
        this.tiles.push({
          x,
          y,
          wx,
          wz,
          tile,
          water,
          ground: null,
          wl: 0,
          e: undefined,
          key: null,
          hidden: false,
          model: null,
          dp: 0,
          pop: 1,
        });
      }
    }
    this._fitShadow();
    if (this.view.w) this.fit(this.view.w, this.view.h);
  }

  _fitShadow() {
    const n = this.n;
    const half = n / 2 + 1.2;
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    const dist = n + 10;
    cam.near = 0.5;
    cam.far = dist * 2 + 4;
    this.sun.position.set(-0.72, 1.25, 0.5).normalize().multiplyScalar(dist);
    this.sun.target.position.set(0, 0, 0);
    const size = n > 6 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    cam.updateProjectionMatrix();
  }

  _removeModel(obj, animate) {
    if (!obj) return;
    if (animate) {
      this.dying.push({ obj, t: 0, base: obj.scale.clone() });
      return;
    }
    obj.parent?.remove(obj);
    this.kit.release(obj);
  }

  // ---------- diff ----------

  /** Bring the scene in line with the game state. Cheap when nothing changed. */
  sync(game) {
    if (!game) return false;
    const fresh = game !== this.game || game.size !== this.n;
    if (fresh) {
      this.game = game;
      this._buildBoard(game);
    }
    const n = this.n;
    let entitiesChanged = fresh;
    let changed = fresh;

    // Pass 1: ground, water and entity identity.
    for (const rec of this.tiles) {
      const t = game.tiles[rec.y * n + rec.x];
      if (rec.ground !== t.ground) {
        rec.ground = t.ground;
        this.kit.setTileGround(rec.tile, t.ground);
        changed = true;
      }
      const wl = waterLevel(t.water);
      if (wl !== rec.wl) {
        rec.wl = wl;
        this.kit.setWater(rec.water, wl);
        changed = true;
      }
      const key = modelKey(t.entity);
      if (t.entity !== rec.e || key !== rec.key) entitiesChanged = true;
    }

    if (entitiesChanged) {
      changed = true;
      const giants = findGiantPumpkins(game);
      const hidden = new Set(giants.flatMap((g) => g.cells));
      // Dinosaur tiles are drawn by the animated chain (_syncDino), not per tile.
      for (const p of game.dino?.body ?? []) hidden.add(p.y * n + p.x);

      for (const rec of this.tiles) {
        const t = game.tiles[rec.y * n + rec.x];
        const e = t.entity;
        const key = modelKey(e);
        const isHidden = hidden.has(rec.y * n + rec.x);
        const sameEntity = e === rec.e;
        if (sameEntity && key === rec.key && isHidden === rec.hidden) continue;

        const newEntity = !sameEntity;
        const wasShown = !!rec.model && !rec.hidden;
        // Harvest pop for a model that disappears (not when it merges into a giant).
        if (rec.model) this._removeModel(rec.model, !fresh && newEntity && wasShown && !isHidden);
        rec.model = null;
        if (newEntity) rec.dp = e ? Math.min(1, e.progress) : 0;
        rec.e = e;
        rec.key = key;
        rec.hidden = isHidden;
        if (e && !isHidden) {
          const model = this.kit.buildEntity(e, variantOf(rec.x, rec.y));
          if (model) {
            this.builds++;
            model.position.set(rec.wx, 0, rec.wz);
            this.board.add(model);
            rec.model = model;
            rec.pop = !fresh && newEntity ? 0 : 1;
            this._applyGrowth(rec, true);
          }
        }
      }

      // Giant pumpkins.
      const seen = new Set();
      for (const g of giants) {
        const gk = `${g.x0},${g.y0},${g.k}`;
        seen.add(gk);
        if (this.giants.has(gk)) continue;
        const model = this.kit.buildGiantPumpkin(g.k);
        this.builds++;
        const a = tileToWorld(n, g.x0, g.y0);
        const b = tileToWorld(n, g.x0 + g.k - 1, g.y0 + g.k - 1);
        model.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
        this.board.add(model);
        this.giants.set(gk, { model, pop: fresh ? 1 : 0 });
      }
      for (const [gk, g] of this.giants) {
        if (seen.has(gk)) continue;
        this._removeModel(g.model, !fresh);
        this.giants.delete(gk);
      }
    }
    if (this._syncDino(game, fresh)) changed = true;
    return changed;
  }

  /**
   * Keep one segment model per body tile. Records stay index-aligned with
   * game.dino.body (0 = head), so after a step every segment glides one tile
   * forward; a meal adds a segment where the tail was; a harvest pops the cut
   * segments away.
   */
  _syncDino(game, fresh) {
    const d = game.dino;
    const body = d?.body ?? [];
    const sig = body.map((p) => `${p.x},${p.y}`).join(";") + `|${d?.dir ?? ""}`;
    if (!fresh && sig === this.dinoSig) return false;
    this.dinoSig = sig;
    const n = this.n;
    const L = body.length;
    while (this.dinoSegs.length > L) {
      const seg = this.dinoSegs.pop();
      this._removeModel(seg.obj, !fresh);
    }
    for (let i = 0; i < L; i++) {
      const part = dinoPartFor(i, L);
      const w = tileToWorld(n, body[i].x, body[i].y);
      const yaw = dinoYaw(body, i, d.dir);
      let seg = this.dinoSegs[i];
      if (!seg) {
        const obj = this.kit.buildDinoSegment(part);
        this.board.add(obj);
        seg = { obj, x: w.x, z: w.z, yaw, pop: fresh ? 1 : 0 };
        this.dinoSegs.push(seg);
      } else {
        this.kit.setDinoPart(seg.obj, part);
        // A brand-new dinosaur somewhere else: jump instead of gliding across the farm.
        if (Math.abs(seg.x - w.x) + Math.abs(seg.z - w.z) > 1.6) {
          seg.x = w.x;
          seg.z = w.z;
          seg.yaw = yaw;
        }
      }
      seg.tx = w.x;
      seg.tz = w.z;
      seg.tyaw = yaw;
      seg.scale = dinoSegScale(i, L);
      this._placeDinoSeg(seg);
    }
    return true;
  }

  _placeDinoSeg(seg) {
    const p = popScale(seg.pop);
    seg.obj.position.set(seg.x, 0, seg.z);
    seg.obj.rotation.y = seg.yaw;
    // Thinner toward the tail, but always a full tile long so the bridges meet.
    seg.obj.scale.set(seg.scale * p, seg.scale * p, p);
  }

  _updateDino(dt, paused) {
    let moving = false;
    for (const seg of this.dinoSegs) {
      let dirty = false;
      if (!paused && (seg.x !== seg.tx || seg.z !== seg.tz || seg.yaw !== seg.tyaw)) {
        seg.x = smoothToward(seg.x, seg.tx, dt, 16);
        seg.z = smoothToward(seg.z, seg.tz, dt, 16);
        seg.yaw = lerpAngle(seg.yaw, seg.tyaw, 1 - Math.exp(-dt * 18));
        if (Math.abs(seg.x - seg.tx) < 1e-3) seg.x = seg.tx;
        if (Math.abs(seg.z - seg.tz) < 1e-3) seg.z = seg.tz;
        if (Math.abs(lerpAngle(seg.yaw, seg.tyaw, 1) - seg.yaw) < 1e-3) seg.yaw = seg.tyaw;
        dirty = true;
      }
      if (seg.pop < 1) {
        seg.pop = Math.min(1, seg.pop + dt / POP_S);
        dirty = true;
      }
      if (dirty) {
        this._placeDinoSeg(seg);
        moving = true;
      }
    }
    return moving;
  }

  _applyGrowth(rec, force = false) {
    const m = rec.model;
    if (!m) return;
    const type = rec.e.type;
    const [sx, sy, sz] = growthScale(type, rec.dp);
    const p = popScale(rec.pop);
    m.scale.set(sx * p, sy * p, sz * p);
    const wm = m.userData.wheatMaterial;
    if (wm && (force || Math.abs((m.userData.colorP ?? -1) - rec.dp) > 0.004)) {
      m.userData.colorP = rec.dp;
      wm.color.copy(WHEAT_GREEN).lerp(WHEAT_GOLD, Math.min(1, rec.dp) ** 1.5);
    }
  }

  // ---------- per frame ----------

  /**
   * Per-frame animation. `paused` freezes growth and the drone (pops still
   * finish). Returns true while something is moving (a render is needed).
   */
  update(dt, { paused = false, moveMs = 150 } = {}) {
    const game = this.game;
    if (!game) return false;
    dt = Math.min(dt, 0.1);
    let moving = false;
    if (!paused) this.animT += dt;

    // Growth + planting pops.
    for (const rec of this.tiles) {
      if (!rec.model) continue;
      const target = Math.min(1, rec.e.progress);
      let dirty = false;
      if (!paused && rec.dp !== target) {
        rec.dp = target < rec.dp - 0.25 ? target : smoothToward(rec.dp, target, dt, 9);
        if (Math.abs(rec.dp - target) < 0.002) rec.dp = target;
        dirty = true;
      }
      if (rec.pop < 1) {
        rec.pop = Math.min(1, rec.pop + dt / POP_S);
        dirty = true;
      }
      if (dirty) {
        this._applyGrowth(rec);
        moving = true;
      }
    }
    for (const g of this.giants.values()) {
      if (g.pop < 1) {
        g.pop = Math.min(1, g.pop + dt / POP_S);
        const s = popScale(g.pop);
        g.model.scale.setScalar(s);
        moving = true;
      }
    }
    // Harvest pops.
    if (this.dying.length) {
      moving = true;
      this.dying = this.dying.filter((d) => {
        d.t += dt / DIE_S;
        if (d.t >= 1) {
          this._removeModel(d.obj, false);
          return false;
        }
        const s = dieScale(d.t);
        d.obj.scale.set(d.base.x * s, d.base.y * s, d.base.z * s);
        return true;
      });
    }

    if (this._updateDino(dt, paused)) moving = true;
    if (this._updateDrones(dt, paused, moveMs)) moving = true;
    return moving;
  }

  _updateDrones(dt, paused, moveMs) {
    const game = this.game;
    const list = Array.isArray(game.drones) && game.drones.length ? game.drones : [game.drone];
    // Add / remove helper models to match the drone list (Megafarm).
    while (this.extraDrones.length < list.length - 1) this.extraDrones.push(this._makeDrone(this.extraDrones.length + 1));
    while (this.extraDrones.length > list.length - 1) this._dropDrone(this.extraDrones.pop());
    let moving = false;
    // Drone 0 always shows game.drone (the same object as drones[0]).
    if (this._updateDrone(this.drone, game.drone, dt, paused, moveMs)) moving = true;
    for (let k = 1; k < list.length; k++) {
      if (this._updateDrone(this.extraDrones[k - 1], list[k], dt, paused, moveMs)) moving = true;
    }
    return moving;
  }

  _updateDrone(d, drone, dt, paused, moveMs) {
    const { x, y, flips = 0, flipMs = 600 } = drone;
    const n = this.n;
    const target = tileToWorld(n, Math.min(x, n - 1), Math.min(y, n - 1));
    let moving = false;

    if (d.tx === null || isWrapJump(d.tx, d.ty, x, y)) {
      // First frame, or a wrap-around move: teleport instead of sliding across.
      d.x = target.x;
      d.z = target.z;
    } else if (!paused) {
      const rate = Math.max(8, Math.min(32, 3600 / Math.max(1, moveMs)));
      const px = d.x;
      const pz = d.z;
      d.x = smoothToward(d.x, target.x, dt, rate);
      d.z = smoothToward(d.z, target.z, dt, rate);
      if (Math.abs(d.x - target.x) < 1e-3) d.x = target.x;
      if (Math.abs(d.z - target.z) < 1e-3) d.z = target.z;
      const vx = d.x - px;
      const vz = d.z - pz;
      if (vx * vx + vz * vz > 1e-8) {
        // Face the direction of travel (model front is +z).
        d.yawAngle = lerpAngle(d.yawAngle, Math.atan2(vx, vz), 1 - Math.exp(-dt * 14));
      }
    }
    d.tx = x;
    d.ty = y;

    if (d.flips === null) d.flips = flips;
    if (flips !== d.flips) {
      d.flips = flips;
      d.flipStart = this.animT;
      d.flipDur = Math.max(0.08, flipMs / 1000);
    }
    let flipAngle = 0;
    let flipLift = 0;
    if (d.flipStart >= 0) {
      const u = (this.animT - d.flipStart) / d.flipDur;
      if (u >= 1) d.flipStart = -1;
      else {
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        flipAngle = e * Math.PI * 2;
        flipLift = Math.sin(u * Math.PI) * 0.25;
        moving = true;
      }
    }

    // Helpers bob out of phase with drone 0, so a stack on one tile still reads as several.
    const bob = Math.sin(this.animT * 3.4 + d.index * 1.9) * 0.045;
    // ~1.2 tiles wide on normal farms (like the reference), smaller on tiny ones.
    const scale = n <= 2 ? 0.62 : Math.min(1.45, 0.95 + 0.07 * n);
    d.root.position.set(d.x, HOVER + bob + flipLift, d.z);
    d.root.scale.setScalar(scale);
    d.yaw.rotation.y = d.yawAngle;
    d.flip.rotation.x = flipAngle;
    d.shadow.position.set(d.x, 0.016, d.z);
    const sh = (1 - bob * 2.2 - flipLift * 0.8) * scale;
    d.shadow.scale.set(sh, 1, sh);
    if (!paused) {
      for (let k = 0; k < d.rotors.length; k++) d.rotors[k].rotation.y += dt * (k % 2 ? -26 : 26);
      moving = true;
    }
    return moving;
  }

  // ---------- camera ----------

  /**
   * Fixed framing: camera ~50° above the board, looking North, distance and
   * look-at point solved so the slab (plus room for tall plants on the far
   * row) fills `boardTargetPx` and sits centred in the canvas.
   */
  fit(w, h) {
    this.view = { w, h };
    if (!w || !h || !this.n) return;
    const cam = this.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const n = this.n;
    const half = n / 2 + 0.08;
    const bottom = -0.15 - Math.min(0.62, 0.3 + 0.045 * n);
    const pts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pts.push(new THREE.Vector3(sx * half, 0, sz * half));
        pts.push(new THREE.Vector3(sx * half, bottom, sz * half));
      }
      pts.push(new THREE.Vector3(sx * half, 0.95, -half)); // tall plants, far row
    }
    const el = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    const target = new THREE.Vector3(0, 0, 0);
    const goal = boardTargetPx(n, w, h);
    let dist = n * 2.4 + 3;
    const p = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const q of pts) {
        p.copy(q).project(cam);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const pw = ((maxX - minX) / 2) * w;
      const ph = ((maxY - minY) / 2) * h;
      const s = Math.max(pw / goal.w, ph / goal.h);
      const cy = (minY + maxY) / 2;
      // Re-centre vertically: move the look-at point along z (North = −z).
      target.z -= cy * ((2 * half) / Math.max(0.05, maxY - minY));
      dist *= s;
      if (Math.abs(s - 1) < 0.002 && Math.abs(cy) < 0.002) break;
    }
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    this.cameraDistance = dist;
  }

  dispose() {
    this._clearBoard();
    this._dropDrone(this.drone);
    for (const rec of this.extraDrones) this._dropDrone(rec);
    this.extraDrones = [];
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.kit.dispose();
    this.game = null;
  }
}
