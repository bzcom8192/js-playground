// Ground tiles and the raised planter box around the board.
import * as THREE from "three";
import { M, merge, piece, rbox, rng } from "./geom.js";
import { SOIL_FURROWS } from "./textures.js";

const TILE = 0.93;
const TILE_H = 0.16;
const FURROW_DEPTH = 0.026;
const STAINS = ["#7c5468", "#714b60", "#674358"];
const TRIM = "#e9cfb2";
const TRIM_DARK = "#d3b596";
const POST = "#54394a";
const BRASS = "#f0b03f";

/**
 * One tile, with two material groups: 0 = sides, 1 = top. A soil top is cut
 * into furrows; a grass top is flat and grows a few short blades. The
 * underside is never visible, so it has no faces.
 */
export function tileGeometry(ground, variant = 0) {
  const h = TILE / 2;
  const soil = ground === "Soil";
  const rows = soil ? SOIL_FURROWS * 4 : 1;
  const y = (u) => (soil ? (-FURROW_DEPTH * (1 - Math.cos(u * SOIL_FURROWS * Math.PI * 2))) / 2 : 0);

  // Sides: four plain walls (they meet the furrows half-way up).
  const side = { pos: [], nor: [], uv: [], index: [] };
  const top = { pos: [], nor: [], uv: [], index: [] };
  const quad = (g, pts, n, uvs) => {
    const b = g.pos.length / 3;
    pts.forEach((p, i) => {
      g.pos.push(...p);
      g.nor.push(...n);
      g.uv.push(...(uvs ? uvs[i] : [0, 0]));
    });
    g.index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const B = -TILE_H;
  const T = soil ? -FURROW_DEPTH / 2 : 0;
  quad(side, [[-h, B, h], [h, B, h], [h, y(1), h], [-h, y(1), h]], [0, 0, 1]);
  quad(side, [[h, B, -h], [-h, B, -h], [-h, y(0), -h], [h, y(0), -h]], [0, 0, -1]);
  quad(side, [[h, B, h], [h, B, -h], [h, T, -h], [h, T, h]], [1, 0, 0]);
  quad(side, [[-h, B, -h], [-h, B, h], [-h, T, h], [-h, T, -h]], [-1, 0, 0]);
  // Top: one strip across, shared vertices along z so the furrows shade smoothly.
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    const z = -h + u * TILE;
    const slope = soil ? (FURROW_DEPTH * Math.sin(u * SOIL_FURROWS * Math.PI * 2) * SOIL_FURROWS * Math.PI) / TILE : 0;
    const len = Math.hypot(1, slope);
    for (const x of [-h, h]) {
      top.pos.push(x, y(u), z);
      top.nor.push(0, 1 / len, slope / len);
      top.uv.push(x / TILE + 0.5, 1 - u);
    }
    if (i < rows) {
      const b = i * 2;
      top.index.push(b, b + 2, b + 3, b, b + 3, b + 1);
    }
  }
  if (!soil) {
    const r = rng(811 + variant);
    for (let i = 0; i < 24; i++) {
      const x = (r() - 0.5) * (TILE - 0.1);
      const z = (r() - 0.5) * (TILE - 0.1);
      const b = top.pos.length / 3;
      const lean = (r() - 0.5) * 0.06;
      top.pos.push(x - 0.011, 0, z, x + 0.011, 0, z, x + lean, 0.035 + r() * 0.045, z - 0.01);
      const uv = [0.1 + r() * 0.8, 0.1 + r() * 0.8];
      for (let k = 0; k < 3; k++) {
        top.nor.push(0, 1, 0);
        top.uv.push(...uv);
      }
      top.index.push(b, b + 1, b + 2);
    }
  }

  const g = new THREE.BufferGeometry();
  const nSide = side.pos.length / 3;
  g.setAttribute("position", new THREE.Float32BufferAttribute([...side.pos, ...top.pos], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([...side.nor, ...top.nor], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([...side.uv, ...top.uv], 2));
  g.setIndex([...side.index, ...top.index.map((i) => i + nSide)]);
  g.addGroup(0, side.index.length, 0);
  g.addGroup(side.index.length, top.index.length, 1);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * The box itself: four plank-textured walls (group 0) and the earth that shows
 * between the tiles (group 1). Only those gaps are drawn, not the whole top:
 * a full face would be shaded under every tile and never seen.
 */
export function slabGeometry(n) {
  const { side, thick } = planterSize(n);
  const h = side / 2;
  const pos = [];
  const nor = [];
  const uv = [];
  const index = [];
  const quad = (pts, nrm) => {
    const b = pos.length / 3;
    pts.forEach((p, i) => {
      pos.push(...p);
      nor.push(...nrm);
      uv.push(i === 1 || i === 2 ? 1 : 0, i > 1 ? 1 : 0);
    });
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const T = -0.1;
  const B = T - thick;
  quad([[-h, B, h], [h, B, h], [h, T, h], [-h, T, h]], [0, 0, 1]);
  quad([[h, B, -h], [-h, B, -h], [-h, T, -h], [h, T, -h]], [0, 0, -1]);
  quad([[h, B, h], [h, B, -h], [h, T, -h], [h, T, h]], [1, 0, 0]);
  quad([[-h, B, -h], [-h, B, h], [-h, T, h], [-h, T, -h]], [-1, 0, 0]);
  const walls = index.length;
  const under = 0.006; // strips reach a hair under the tiles
  for (let i = 0; i <= n; i++) {
    const a = i === 0 ? -h : i - n / 2 - (1 - TILE) / 2 - under;
    const b = i === n ? h : i - n / 2 + (1 - TILE) / 2 + under;
    quad([[a, T, h], [b, T, h], [b, T, -h], [a, T, -h]], [0, 1, 0]);
    quad([[-h, T, b], [h, T, b], [h, T, a], [-h, T, a]], [0, 1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.addGroup(0, walls, 0);
  g.addGroup(walls, index.length - walls, 1);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function planterSize(n) {
  return { side: n + 0.16, thick: Math.min(0.62, 0.3 + 0.045 * n) }; // shallower for tiny farms
}

/**
 * Real planks on the front wall (the only wall the fixed camera can see):
 * three courses with staggered joints and brass nails, plus upright battens.
 * Keeps UVs for the wood-grain texture.
 */
export function planksGeometry(n) {
  const { side, thick } = planterSize(n);
  const r = rng(53);
  const parts = [];
  const course = thick / 3;
  const face = side / 2;
  const planks = Math.max(1, Math.round(side / 2.6));
  for (let c = 0; c < 3; c++) {
    const y = -0.1 - course * (c + 0.5);
    // Joints are staggered by a third of a plank per course.
    const cuts = [-side / 2];
    for (let k = 0; k < planks; k++) {
      const x = -side / 2 + ((k + (c + 1) / 3) * side) / planks;
      if (x > -side / 2 + 0.3 && x < side / 2 - 0.3) cuts.push(x);
    }
    cuts.push(side / 2);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const w = cuts[k + 1] - cuts[k] - 0.014;
      const g = new THREE.BoxGeometry(w, course - 0.014, 0.05);
      // Keep the top and front faces (6 indices per face; order ±x ±y ±z). The ends
      // are seen edge-on from the camera and only leave slivers under MSAA.
      const ix = Array.from(g.index.array);
      g.setIndex([...ix.slice(12, 18), ...ix.slice(24, 30)]);
      const uv = g.attributes.uv;
      const [du, dv] = [r(), r()];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.8 + du, uv.getY(i) * 0.4 + dv);
      const tone = new THREE.Color(STAINS[c]).multiplyScalar(0.94 + r() * 0.16);
      parts.push(piece(g, tone, M((cuts[k] + cuts[k + 1]) / 2, y, face + 0.008), null, { uv: true }));
    }
  }
  return merge(parts);
}

/** Trim: stepped rim, upright battens, corner posts with brass caps and feet, nails. */
export function frameGeometry(n) {
  const { side, thick } = planterSize(n);
  const parts = [];
  const add = (geo, color, m) => parts.push(piece(geo, color, m));
  const rim = 0.1;
  const edge = side / 2 + rim / 2 - 0.02;
  // Rims end inside the corner posts, which are slim on a tiny farm.
  for (const s of [-1, 1]) {
    add(rbox(edge * 2, 0.1, rim, 0.02), TRIM, M(0, -0.06, s * edge));
    add(rbox(rim, 0.1, edge * 2, 0.02), TRIM, M(s * edge, -0.06, 0));
    // A thin inner bead where the rim meets the bed.
    add(new THREE.BoxGeometry(side, 0.04, 0.026), TRIM_DARK, M(0, -0.05, s * (edge - rim / 2 - 0.004)));
    add(new THREE.BoxGeometry(0.026, 0.04, side), TRIM_DARK, M(s * (edge - rim / 2 - 0.004), -0.05, 0));
  }
  // Moulding under the front rim and a skirting board at the foot.
  const front = side / 2 + 0.034;
  add(new THREE.BoxGeometry(side, 0.03, 0.04), TRIM_DARK, M(0, -0.122, front + 0.012));
  add(new THREE.BoxGeometry(side, 0.05, 0.034), POST, M(0, -0.1 - thick + 0.03, front + 0.008));
  // Battens across the front, one about every two tiles, each with two nails.
  const bays = Math.max(1, Math.round(n / 2));
  const battenH = thick - 0.05;
  for (let i = 1; i < bays; i++) {
    const x = -side / 2 + (i * side) / bays;
    add(new THREE.BoxGeometry(0.09, battenH, 0.03), POST, M(x, -0.12 - battenH / 2, front + 0.014));
    for (const k of [0.16, 0.84]) add(new THREE.SphereGeometry(0.018, 6, 3), BRASS, M(x, -0.12 - battenH * k, front + 0.03, 0, 0, 0, 1, 1, 0.6));
  }
  // Corner posts: bevelled, on a wider foot, with a two-step brass cap.
  const post = Math.min(0.24, 0.1 + 0.018 * n); // slimmer on tiny farms
  const postH = thick + 0.16;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const at = (y) => M(sx * edge, y, sz * edge);
      add(new THREE.BoxGeometry(post, postH, post), POST, at(0.06 - postH / 2));
      add(new THREE.BoxGeometry(post * 1.14, 0.05, post * 1.14), "#472f3f", at(0.06 - postH + 0.02));
      add(rbox(post * 1.15, 0.05, post * 1.15, 0.016), BRASS, at(0.08));
      add(new THREE.SphereGeometry(post * 0.36, 12, 3, 0, Math.PI * 2, 0, Math.PI / 2), BRASS, M(sx * edge, 0.103, sz * edge, 0, 0, 0, 1, 0.5, 1));
      add(new THREE.BoxGeometry(post * 1.05, 0.022, post * 1.05), BRASS, at(-0.1));
    }
  }
  return merge(parts);
}
