// Geometry helpers for the 3D board models (three.js only, no DOM).
//
// Two kinds of parts exist:
//  part()   non-indexed, for the flat-shaded set pieces (hedge, chest, dinosaur)
//  piece()  indexed with smooth normals, for the crops, the bot and the planter.
//           Vertices are shared, so a smooth model costs fewer vertex-shader
//           runs than a flat one with half its triangles.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** Deterministic PRNG (mulberry32) so every variant looks the same each load. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix from position, Euler rotation (XYZ) and scale. */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/** Give every vertex a colour: a constant, or colorFn(position, scratch) → Color. */
function paint(g, color, colorFn) {
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color(color);
  const tmp = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let cc = c;
    if (colorFn) {
      p.fromBufferAttribute(pos, i);
      cc = colorFn(p, tmp.copy(c));
    }
    arr[i * 3] = cc.r;
    arr[i * 3 + 1] = cc.g;
    arr[i * 3 + 2] = cc.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

function keepOnly(g, names) {
  for (const name of Object.keys(g.attributes)) if (!names.includes(name)) g.deleteAttribute(name);
}

/**
 * Prepare one primitive for merging: non-indexed, transformed, with a flat
 * colour (or a per-vertex colour function) and only position/normal/color.
 */
export function part(geo, color, matrix, colorFn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (matrix) g.applyMatrix4(matrix);
  paint(g, color, colorFn);
  keepOnly(g, ["position", "normal", "color"]);
  return g;
}

/**
 * Like part(), but indexed and with the primitive's own (smooth) normals.
 * `color` null keeps colours the geometry already carries; `uv` keeps its UVs.
 * colorFn sees the position before `matrix` is applied.
 */
export function piece(geo, color, matrix, colorFn, { uv = false } = {}) {
  keepOnly(geo, uv ? ["position", "normal", "color", "uv"] : ["position", "normal", "color"]);
  if (color !== null) {
    geo.deleteAttribute("color");
    paint(geo, color, colorFn);
  }
  const g = geo.index ? geo : mergeVertices(geo, 1e-4);
  if (g !== geo) geo.dispose();
  g.clearGroups();
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

/** Merge parts into one geometry. With `groups`, part i becomes material group i. */
export function merge(parts, groups = false) {
  const g = mergeGeometries(parts, groups);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Shared vertices + freshly computed smooth normals (no seams at the poles or the wrap). */
export function weld(geo) {
  keepOnly(geo, ["position"]);
  const g = mergeVertices(geo, 1e-4);
  if (g !== geo) geo.dispose();
  g.computeVertexNormals();
  return g;
}

/** A box with small bevels. One bevel step (108 triangles) is enough at board zoom. */
export const rbox = (w, h, d, r = 0.015, steps = 1) =>
  new RoundedBoxGeometry(w, h, d, steps, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

/**
 * A round body along a path: one ring of `radial` vertices per point. A radius
 * of 0 closes the body in a single pole vertex. `rib(angle)` scales the radius
 * around the ring; `tint(u, angle, out)` colours it (u runs 0 → 1 along the path).
 */
export function tube(points, radii, radial, { rib = null, tint = null } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p)));
  const last = pts.length - 1;
  const pos = [];
  const col = [];
  const index = [];
  const c = new THREE.Color();
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  let prev = null;
  pts.forEach((p, i) => {
    tangent.subVectors(pts[Math.min(last, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    if (i === 0) normal.set(1, 0, 0);
    // Parallel transport: drop the part of the last normal that runs along the path.
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
    normal.normalize();
    binormal.crossVectors(tangent, normal);
    const n = radii[i] > 0 ? radial : 1;
    const start = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const a = (k / radial) * Math.PI * 2;
      const r = radii[i] * (rib ? rib(a, i / last) : 1);
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      pos.push(p.x + normal.x * ca + binormal.x * sa, p.y + normal.y * ca + binormal.y * sa, p.z + normal.z * ca + binormal.z * sa);
      if (tint) {
        tint(i / last, a, c);
        col.push(c.r, c.g, c.b);
      }
    }
    if (prev) {
      for (let k = 0; k < radial; k++) {
        const k1 = (k + 1) % radial;
        if (prev.n === 1 && n === 1) continue;
        if (prev.n === 1) index.push(prev.start, start + k1, start + k);
        else if (n === 1) index.push(prev.start + k, prev.start + k1, start);
        else {
          index.push(prev.start + k, prev.start + k1, start + k1);
          index.push(prev.start + k, start + k1, start + k);
        }
      }
    }
    prev = { start, n };
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (tint) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * A leaf or petal from the origin along +z, top side facing +y. `fold` lifts
 * the edges above the midrib, `arch` bends the leaf (a hump that ends `droop`
 * below its base). `steps` ≥ 2 rows along the length. One sheet of triangles:
 * draw it with a double-sided material, or pass `twoSided`.
 */
export function leaf(len, width, { steps = 2, fold = 0.2, arch = 0, droop = 0, widest = 0.45, twoSided = false } = {}) {
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // 0 at base and tip, 1 at `widest`.
    const w = (width / 2) * Math.sin(Math.PI * Math.pow(t, Math.log(0.5) / Math.log(widest)));
    rows.push({ z: len * t, y: arch * Math.sin(Math.PI * t) - droop * t * t, w: i === 0 || i === steps ? 0 : w });
  }
  const pos = [];
  const index = [];
  for (const side of twoSided ? [1, -1] : [1]) {
    const tri = (a, b, c) => (side > 0 ? index.push(a, b, c) : index.push(a, c, b));
    let prev = null;
    for (const r of rows) {
      const s = pos.length / 3;
      const ids = r.w === 0 ? [s, s, s] : [s, s + 1, s + 2];
      if (r.w === 0) pos.push(0, r.y, r.z);
      else pos.push(-r.w, r.y + r.w * fold, r.z, 0, r.y, r.z, r.w, r.y + r.w * fold, r.z);
      if (prev) {
        for (const k of [0, 1]) {
          if (prev[k] !== prev[k + 1]) tri(prev[k], ids[k + 1], prev[k + 1]);
          if (ids[k] !== ids[k + 1]) tri(prev[k], ids[k], ids[k + 1]);
        }
      }
      prev = ids;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * A thin stalk as one strip facing the camera (+z; the camera never turns).
 * Its normals bend outward like a round stalk's, at 2 triangles per section
 * instead of 6. Points are in the model's own space (do not rotate it).
 */
export function ribbon(points, radii) {
  const pos = [];
  const nor = [];
  const index = [];
  points.forEach(([x, y, z], i) => {
    pos.push(x - radii[i], y, z, x + radii[i], y, z);
    nor.push(-0.66, 0.34, 0.67, 0.66, 0.34, 0.67);
    if (i) {
      const b = i * 2;
      index.push(b - 2, b - 1, b + 1, b - 2, b + 1, b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  return g;
}

/** A smooth, slightly lumpy ball (foliage lobe). detail 2 = 180 triangles. */
export function lobe(radius, seed, { detail = 2, lump = 0.07, squash = 1 } = {}) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const r = rng(seed);
  const [a, b, c] = [r() * 6, r() * 6, r() * 6];
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).divideScalar(radius);
    const n = Math.sin(v.x * 5 + a) + Math.sin(v.y * 5 + b) + Math.sin(v.z * 5 + c);
    v.multiplyScalar(radius * (1 + (lump * n) / 2));
    pos.setXYZ(i, v.x, v.y * squash, v.z);
  }
  return weld(g);
}

/**
 * Small leaves lying on a set of lobes ([x, y, z, radius, color, squash]) so
 * a canopy reads as foliage. Each is one diamond (2 triangles) that keeps the
 * lobe's normal, so it catches light like the canopy under it.
 */
export function leafScatter(lobes, count, size, seed, { shade = [0.68, 1.34], minUp = -0.35 } = {}) {
  const r = rng(seed);
  const pos = [];
  const nor = [];
  const col = [];
  const index = [];
  const n = new THREE.Vector3();
  const u = new THREE.Vector3();
  const w = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const [x, y, z, rad, color, squash = 1] = lobes[i % lobes.length];
    const ny = minUp + (1 - minUp) * r();
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - ny * ny));
    n.set(Math.cos(a) * s, ny, Math.sin(a) * s);
    p.set(x + n.x * rad * 1.06, y + n.y * rad * squash * 1.06, z + n.z * rad * 1.06);
    if (lobes.some((l) => Math.hypot(p.x - l[0], (p.y - l[1]) / (l[5] ?? 1), p.z - l[2]) < l[3] * 1.02)) continue;
    // A random direction in the tangent plane, tipped outward a little.
    u.set(r() - 0.5, r() - 0.5, r() - 0.5);
    u.addScaledVector(n, -u.dot(n)).normalize();
    w.crossVectors(n, u);
    const len = size * (0.75 + r() * 0.5);
    c.set(color).multiplyScalar(shade[0] + (shade[1] - shade[0]) * r());
    const b = pos.length / 3;
    const corner = (fu, fw, fn) =>
      pos.push(
        p.x + u.x * len * fu + w.x * len * fw + n.x * len * fn,
        p.y + u.y * len * fu + w.y * len * fw + n.y * len * fn,
        p.z + u.z * len * fu + w.z * len * fw + n.z * len * fn,
      );
    corner(-0.5, 0, 0);
    corner(0, -0.32, 0.12);
    corner(0.6, 0, 0.3);
    corner(0, 0.32, 0.12);
    for (let k = 0; k < 4; k++) {
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
    }
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

/** Sphere with vertical lobes (pumpkin ribs), squashed, with a dimpled top. */
export function ribbedSphere(radius, { lobes = 8, w = 24, h = 10, squash = 0.62, dimple = 0.5, rib = 0.1 } = {}) {
  const g = new THREE.SphereGeometry(radius, w, h);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const phi = Math.atan2(v.z, v.x);
    const r = 1 - rib + rib * Math.pow(Math.abs(Math.cos((lobes / 2) * phi)), 0.6);
    const ny = v.y / radius;
    v.x *= r;
    v.z *= r;
    v.y *= squash * (1 - (1 - r) * 0.6); // grooves also dip over the shoulder
    if (ny > 0.55) v.y -= (ny - 0.55) * radius * dimple;
    if (ny < -0.7) v.y += (-0.7 - ny) * radius * 0.4; // flatter bottom
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return weld(g);
}
