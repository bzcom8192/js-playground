// Scene graph for the 3D farm board. Pure three.js, no React and no
// renderer, so it can be exercised in node tests.
//
//  sync(game)        diff the (mutable) game state against what is shown and
//                    rebuild only the tiles/giants whose model changed
//  update(dt, opts)  per-frame work: growth scaling, pops, the bots driving
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
const SHADOW_GROWTH_FRAMES = 3;
const POP_S = 0.28;
const DIE_S = 0.24;
const WHEAT_GREEN = new THREE.Color("#5cae8c");
const WHEAT_GOLD = new THREE.Color("#f2cd86");

const variantOf = (x, y) => (x * 7 + y * 13 + ((x * y) % 5)) % 3;

export class FarmScene {
  constructor() {
    this.kit = createModelKit();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
    this.board = new THREE.Group();
    this.scene.add(this.board);

    // Low morning sun from the upper left + a soft peach/lilac ambient.
    // The key is stronger than the fill so rounded models show their form.
    this.hemi = new THREE.HemisphereLight("#fff1e2", "#7d6a96", 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#ffdcb8", 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.n = 0;
    this.game = null;
    this.tiles = [];
    this.giants = new Map();
    this.dying = [];
    this.slab = null;
    this.view = { w: 0, h: 0 };
    this.animT = 0;
    this.builds = 0; // entity models built (tests / perf checks)
    // The shadow map is redrawn only when something that casts a shadow changed.
    // The bots never do (they carry a blob shadow), so an idle farm keeps its last
    // map. Changes marked dirty redraw it on the next frame; plants that merely
    // grow mark it stale, which redraws it every few frames.
    this.shadowDirty = true;
    this.shadowStale = false;
    this.shadowAge = 0; // rendered frames since the last redraw

    // Bot 0. Megafarm helpers live in extraDrones
    // (extraDrones[k − 1] shows game.drones[k]), built on demand.
    this.drone = this._makeDrone(0);
    this.extraDrones = [];
  }

  _makeDrone(i) {
    const d = this.kit.buildBot(droneBand(i));
    this.scene.add(d.root);
    this.scene.add(d.shadow);
    return {
      ...d,
      index: i,
      x: 0,
      z: 0,
      rx: 0, // last frame (wheel roll)
      rz: 0,
      tx: null,
      ty: null,
      yawAngle: 0,
      flips: null,
      flipStart: -1,
      flipDur: 0.6,
      status: null,
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
        const tile = this.kit.buildTile("Grassland", variantOf(x, y));
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
    const size = n > 6 ? 2560 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    cam.updateProjectionMatrix();
    this.shadowDirty = true;
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
        this.kit.setTileGround(rec.tile, t.ground, variantOf(rec.x, rec.y));
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
    if (changed) this.shadowDirty = true;
    return changed;
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
   * Per-frame animation. `paused` freezes growth and the bots (pops still
   * finish). `status` (idle / running / error / …) sets the bots' lights. Returns true while something is moving (a render is needed).
   */
  update(dt, { paused = false, moveMs = 150, status = "idle" } = {}) {
    const game = this.game;
    if (!game) return false;
    dt = Math.min(dt, 0.1);
    let moving = false;
    let popping = false;
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
        popping = true;
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
        moving = popping = true;
      }
    }
    // Harvest pops.
    if (this.dying.length) {
      moving = popping = true;
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

    if (popping) this.shadowDirty = true;
    else if (moving) this.shadowStale = true; // only growth so far
    if (this._updateDrones(dt, paused, moveMs)) moving = true;
    if (this._updateLights(paused ? "paused" : status)) moving = true;
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

  /** Status light of every bot. Returns true when a colour changed. */
  _updateLights(status) {
    let changed = false;
    for (const d of this.droneRecs) {
      if (d.status === status) continue;
      d.status = status;
      d.setStatus(status);
      changed = true;
    }
    return changed;
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
    let spinAngle = 0;
    let hop = 0;
    if (d.flipStart >= 0) {
      const u = (this.animT - d.flipStart) / d.flipDur;
      if (u >= 1) d.flipStart = -1;
      else {
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        spinAngle = e * Math.PI * 2;
        hop = Math.sin(u * Math.PI) * 0.06;
        moving = true;
      }
    }

    // Idling engine: a tiny suspension bounce, out of phase between bots.
    const bob = Math.abs(Math.sin(this.animT * 3.4 + d.index * 1.9)) * 0.018;
    // The wheels stand near the tile's corners on normal farms.
    const scale = n <= 2 ? 1.05 : Math.min(1.4, 1.05 + 0.04 * n);
    // Bots sharing a tile stand a little apart, so a stack still reads as several.
    const off = d.index ? 0.07 : 0;
    const ang = d.index * 2.4;
    const px = d.x + Math.cos(ang) * off;
    const pz = d.z + Math.sin(ang) * off;
    d.root.position.set(px, bob + hop, pz);
    d.root.scale.setScalar(scale);
    d.yaw.rotation.y = d.yawAngle;
    d.spin.rotation.y = spinAngle;
    d.shadow.position.set(px, 0.016, pz);
    d.shadow.scale.set(scale, 1, scale);
    if (!paused) {
      // Roll with the distance covered (wheel radius 0.085 at scale 1).
      const roll = Math.hypot(d.x - d.rx, d.z - d.rz) / (0.085 * scale);
      if (roll > 0 && roll < 20) for (const w of d.wheels) w.rotation.x += roll;
      moving = true;
    }
    d.rx = d.x;
    d.rz = d.z;
    return moving;
  }

  /** Whether the frame about to be drawn needs a fresh shadow map (call once per frame). */
  takeShadowDirty() {
    this.shadowAge++;
    const redraw = this.shadowDirty || (this.shadowStale && this.shadowAge >= SHADOW_GROWTH_FRAMES);
    if (redraw) {
      this.shadowDirty = this.shadowStale = false;
      this.shadowAge = 0;
    }
    return redraw;
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
