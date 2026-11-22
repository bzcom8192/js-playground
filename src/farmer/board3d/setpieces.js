// Set pieces: maze hedge, treasure chest, apple and the dinosaur's segments.
// Like the crops (crops.js), each function returns ONE merged, vertex-coloured,
// smooth geometry that the kit caches and shares between tiles.
//
// Budget (board3d.test.mjs): a 12×12 farm of hedges or of one dinosaur stays
// under the 300k triangles of any single crop. A maze is at most 143 hedges + one
// chest; there are at most 9 apples.
import * as THREE from "three";
import { leaf, leafSheet, M, merge, piece, rbox, rng, tube, weld } from "./geom.js";

// ---------- hedge ----------

const HEDGE_W = 0.98;
const HEDGE_H = 0.5;
const HEDGE_LEAF = ["#265650", "#32716a", "#3c8078", "#2a5f58", "#4a9488"];

/** How far the clipped body bulges at a point: shared waves, so neighbours differ little at the seam. */
const bulge = (x, y, z, a) => 0.012 * (Math.sin(x * 9 + a) + Math.sin(y * 11 + a * 2) + Math.sin(z * 10 - a));

/** A clipped hedge that fills its tile: a soft-edged body under a coat of small leaves. */
export function hedgeGeometry(seed) {
  const r = rng(seed);
  const a = r() * 6;
  // Darker toward the ground, like a clipped hedge in its own shade.
  const shadeAt = (y) => 0.56 + 0.44 * Math.max(0, Math.min(1, y / HEDGE_H));
  const parts = [];

  // Body: a box whose upper edges are rounded off and whose faces are uneven.
  const body = new THREE.BoxGeometry(HEDGE_W, HEDGE_H, HEDGE_W, 3, 2, 3);
  const pos = body.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const top = Math.max(0, v.y / (HEDGE_H / 2)); // 0 up to half height, 1 at the top
    const edge = Math.max(Math.abs(v.x), Math.abs(v.z)) / (HEDGE_W / 2);
    const foot = v.y < -HEDGE_H / 2 + 1e-6;
    // The foot stays full width and goes into the ground: the tile under a hedge
    // is not drawn (FarmScene), so it has to close that hole.
    const k = foot ? 1 : 1 - 0.05 * top * top + bulge(v.x, v.y, v.z, a);
    if (foot) v.y -= 0.06;
    if (top === 1 && edge > 0.99) v.y -= 0.035;
    v.set(v.x * k, v.y + (top === 1 ? bulge(v.z, v.x, v.y, a) : 0), v.z * k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  body.translate(0, HEDGE_H / 2, 0);
  parts.push(piece(weld(body), "#24534e", null, (p, c) => c.multiplyScalar(shadeAt(p.y))));

  // Low tufts on top break the ruler-straight edge a hedge row would have.
  const tufts = [];
  for (let i = 0; i < 5; i++) {
    const [gx, gz] = [[-0.26, -0.22], [0.24, -0.27], [0.02, 0.02], [-0.24, 0.26], [0.27, 0.24]][i];
    const tuft = weld(new THREE.IcosahedronGeometry(0.18 + r() * 0.04, 0));
    const [tx, tz, rad] = [gx + (r() - 0.5) * 0.08, gz + (r() - 0.5) * 0.08, 0.2];
    tufts.push([tx, tz, rad]);
    parts.push(piece(tuft, "#2a5f58", M(tx, HEDGE_H - 0.03, tz, 0, r() * 3, 0, 1.15, 0.38, 1.15)));
  }
  const mound = (x, z) => Math.max(0, ...tufts.map(([tx, tz, rad]) => 0.045 * (1 - Math.hypot(x - tx, z - tz) / rad)));

  // The leaves: an even, jittered grid over the top and the three sides the fixed camera can see.
  const at = [];
  const grid = (n, m, place) => {
    for (let i = 0; i < n * m; i++) place(((i % n) + r()) / n - 0.5, (Math.floor(i / n) + r()) / m);
  };
  const top = (x, z) => {
    const k = Math.max(Math.abs(x), Math.abs(z));
    const round = Math.max(0, (k - 0.36) / 0.14); // the rounded rim leans outward
    const n = new THREE.Vector3((x / k) * round * 0.7, 1, (z / k) * round * 0.7).normalize();
    at.push({ p: new THREE.Vector3(x * 0.97, HEDGE_H + 0.012 - round * 0.03 + mound(x, z), z * 0.97), n });
  };
  grid(8, 8, (x, t) => top(x, t - 0.5));
  grid(8, 3, (x, t) => at.push({ p: new THREE.Vector3(x * 0.97, 0.03 + t * 0.45, 0.475), n: new THREE.Vector3(0, 0.25, 1).normalize() }));
  for (const s of [-1, 1]) grid(5, 1, (z, t) => at.push({ p: new THREE.Vector3(s * 0.475, 0.05 + t * 0.43, z * 0.95), n: new THREE.Vector3(s, 0.25, 0).normalize() }));
  const c = new THREE.Color();
  const leaves = leafSheet(
    at.map(({ p, n }) => ({ p, n, color: c.set(HEDGE_LEAF[Math.floor(r() * HEDGE_LEAF.length)]).multiplyScalar(shadeAt(p.y) * (0.8 + r() * 0.5)).clone() })),
    0.16,
    r,
  );
  // No leaf reaches more than a twig's length into the next tile.
  const lp = leaves.attributes.position;
  const clip = (k) => Math.max(-0.54, Math.min(0.54, k));
  for (let i = 0; i < lp.count; i++) lp.setXYZ(i, clip(lp.getX(i)), lp.getY(i), clip(lp.getZ(i)));
  // Leaves first: the depth test then skips most of the body behind them.
  return merge([piece(leaves, null), ...parts]);
}

// ---------- treasure chest ----------

const CHEST_W = 0.68;
const CHEST_D = 0.46;
const CHEST_H = 0.28; // the box, up to the lid
const LID_RISE = 0.2;
const LID_STEPS = 12;

/** Height of the lid above the box at depth z ∈ [−D/2, D/2]: a low barrel, not a half circle. */
const lidY = (z, rise = LID_RISE, d = CHEST_D) => rise * Math.sqrt(Math.max(0, 1 - ((2 * z) / d) ** 2)) ** 0.85;

/** A barrel of width w lying along x, with closed ends: the lid, or a strap over it. */
function barrel(w, grow = 0) {
  const d = CHEST_D + grow * 2;
  const rows = [];
  for (let i = 0; i <= LID_STEPS; i++) {
    const t = Math.cos((i / LID_STEPS) * Math.PI); // dense where the curve is steep
    const z = (t * d) / 2;
    rows.push([z, lidY(z, LID_RISE + grow, d)]);
  }
  const pos = [];
  const index = [];
  for (const [z, y] of rows) pos.push(-w / 2, y, z, w / 2, y, z);
  for (let i = 0; i < LID_STEPS; i++) {
    const b = i * 2;
    index.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
  // End walls keep their own vertices: a crisp edge against the curved top.
  for (const s of [-1, 1]) {
    const start = pos.length / 3;
    pos.push((s * w) / 2, 0, 0);
    for (const [z, y] of rows) pos.push((s * w) / 2, y, z);
    for (let i = 0; i < LID_STEPS; i++) {
      const [p, q] = [start + 1 + i, start + 2 + i];
      if (s > 0) index.push(start, q, p);
      else index.push(start, p, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A treasure chest: planked body, barrel lid, riveted bands, hasp and padlock. The front faces +z. */
export function treasureGeometry() {
  const parts = [];
  const wood = ["#d99a2b", "#e2a935", "#cf8f25"];
  const band = "#5b4470";
  const bandLight = "#7c6393";
  const brass = "#f7d35c";
  const rivet = (x, y, z) => parts.push(piece(weld(new THREE.OctahedronGeometry(0.016, 0)), brass, M(x, y, z)));

  // Body: three planks a side, each a hair proud of the gap behind it.
  parts.push(piece(rbox(CHEST_W - 0.03, CHEST_H, CHEST_D - 0.03, 0.01), "#8a5a17", M(0, CHEST_H / 2, 0)));
  const ph = (CHEST_H - 0.02) / 3;
  for (let i = 0; i < 3; i++) {
    const plank = rbox(CHEST_W, ph - 0.008, CHEST_D, 0.012);
    parts.push(piece(plank, wood[i], M(0, 0.01 + ph * (i + 0.5), 0), (p, c) => c.multiplyScalar(0.92 + 0.08 * Math.sin(p.x * 21 + i * 2))));
  }
  // Lid: the barrel, shaded like staves running along it.
  const staves = (p, c) => c.multiplyScalar(0.9 + 0.1 * Math.cos((p.z / CHEST_D) * Math.PI * 12));
  parts.push(piece(barrel(CHEST_W), brass, M(0, CHEST_H + 0.015, 0), staves));
  // Rim between box and lid, feet, and the iron corners of the box.
  parts.push(piece(rbox(CHEST_W + 0.025, 0.04, CHEST_D + 0.025, 0.01), band, M(0, CHEST_H, 0)));
  parts.push(piece(rbox(CHEST_W + 0.02, 0.035, CHEST_D + 0.02, 0.01), band, M(0, 0.0175, 0)));
  for (const x of [-1, 1]) {
    parts.push(piece(rbox(0.05, CHEST_H, 0.05, 0.012), band, M((x * (CHEST_W - 0.03)) / 2, CHEST_H / 2, (CHEST_D - 0.03) / 2)));
  }
  // Bands: two straps over body and lid, with rivets.
  for (const x of [-CHEST_W * 0.27, CHEST_W * 0.27]) {
    parts.push(piece(rbox(0.07, CHEST_H, CHEST_D + 0.018, 0.008), bandLight, M(x, CHEST_H / 2, 0)));
    parts.push(piece(barrel(0.07, 0.012), bandLight, M(x, CHEST_H + 0.015, 0)));
    for (const y of [0.075, 0.205]) rivet(x, y, CHEST_D / 2 + 0.012);
    for (const z of [0.2, 0.1, -0.05]) rivet(x, CHEST_H + 0.027 + lidY(z, LID_RISE + 0.012, CHEST_D + 0.024), z);
  }
  // A ring handle on the side the camera can see best.
  parts.push(piece(weld(new THREE.TorusGeometry(0.055, 0.011, 5, 12)), brass, M(CHEST_W / 2 + 0.015, 0.16, 0, 0, Math.PI / 2, 0)));
  // Hasp hanging from the lid, then the padlock: a round body with a shackle and a keyhole.
  const front = CHEST_D / 2;
  parts.push(piece(rbox(0.07, 0.12, 0.02, 0.008), band, M(0, CHEST_H + 0.035, front + 0.016)));
  parts.push(piece(weld(new THREE.TorusGeometry(0.035, 0.01, 5, 10, Math.PI)), "#b9a7c9", M(0, CHEST_H - 0.02, front + 0.038)));
  parts.push(piece(weld(new THREE.CylinderGeometry(0.062, 0.062, 0.04, 16)), "#fff0a0", M(0, CHEST_H - 0.062, front + 0.034, Math.PI / 2, 0, 0)));
  parts.push(piece(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), "#3a2208", M(0, CHEST_H - 0.052, front + 0.056, Math.PI / 2, 0, 0)));
  parts.push(piece(new THREE.BoxGeometry(0.013, 0.036, 0.012), "#3a2208", M(0, CHEST_H - 0.074, front + 0.056)));
  // Spilled coins: milled edges, some leaning on each other.
  for (const [x, y, z, tilt] of [
    [0.4, 0.012, 0.22, 0],
    [0.37, 0.034, 0.25, 0.25],
    [-0.36, 0.012, 0.3, 0],
    [0.27, 0.012, 0.35, 0],
    [-0.27, 0.012, 0.37, 0],
  ]) {
    const coin = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14);
    parts.push(piece(coin, brass, M(x, y, z, tilt, 0, tilt), (p, c) => c.multiplyScalar(Math.hypot(p.x, p.z) < 0.045 ? 1 : 0.82)));
  }
  return merge(parts);
}

// ---------- apple ----------

const APPLE_R = 0.15;

export function appleGeometry() {
  const parts = [];
  // A lathe-like body: wide shoulders, five soft lobes, a hollow at the stem and at the blossom end.
  const body = new THREE.SphereGeometry(1, 20, 14);
  const pos = body.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const phi = Math.atan2(v.z, v.x);
    const around = Math.hypot(v.x, v.z);
    const lobes = 1 + 0.035 * Math.cos(phi * 5) * (0.35 - 0.65 * v.y);
    const w = (around + 0.16 * around * (1 - around)) * lobes * (1 + 0.08 * v.y);
    const hollow = (v.y > 0 ? 0.34 : 0.22) * Math.max(0, 1 - around / 0.62) ** 1.6;
    const y = v.y * 0.95 - Math.sign(v.y) * hollow;
    pos.setXYZ(i, Math.cos(phi) * w * APPLE_R, (y + 0.88) * APPLE_R, Math.sin(phi) * w * APPLE_R);
  }
  const red = new THREE.Color("#d32f3a");
  const blush = new THREE.Color("#ff7a55");
  const pale = new THREE.Color("#f2d06b");
  parts.push(
    piece(weld(body), "#d32f3a", null, (p, c) => {
      const phi = Math.atan2(p.z, p.x);
      const up = p.y / (APPLE_R * 1.8);
      const streak = 0.5 + 0.5 * Math.sin(phi * 13 + Math.sin(phi * 4) * 2);
      c.copy(red).multiplyScalar(0.72 + 0.32 * up);
      if (p.z > 0) c.lerp(blush, 0.45 * (p.z / APPLE_R) * Math.min(1, up * 1.6)); // the sunny cheek, toward the camera
      return c.lerp(pale, Math.max(0, up - 0.7) * (1.1 + streak * 1.3)); // pale streaks around the stem
    }),
  );
  // A bent stem with a thicker end, and one leaf on it.
  const stem = tube([[0, 0.19, 0], [0.004, 0.25, 0], [0.018, 0.3, 0.004], [0.034, 0.335, 0.008]], [0.011, 0.01, 0.011, 0.017], 6, {
    tint: (u, _, c) => c.set("#6b4a3a").multiplyScalar(0.8 + 0.5 * u),
  });
  parts.push(piece(stem, null));
  const blade = leaf(0.15, 0.085, { steps: 4, fold: 0.35, arch: 0.03, droop: 0.05, twoSided: true });
  parts.push(piece(blade, "#4f9d5c", M(0.014, 0.275, 0, -0.15, 1.1, 0), (p, c) => c.multiplyScalar(Math.abs(p.x) < 0.004 ? 1.3 : 0.95)));
  // What is left of the blossom, underneath, and a highlight fleck on the cheek.
  parts.push(piece(weld(new THREE.OctahedronGeometry(0.018, 0)), "#4a3524", M(0, 0.02, 0, 0, 0.4, 0, 1, 0.5, 1)));
  return merge(parts);
}

// ---------- dinosaur ----------
// Segments face +z: a segment's +z points at the segment ahead of it (toward the
// head), and the head's +z is its snout. Body and tail carry a neck-like bridge
// that ends well inside the segment ahead, with one smooth skin from rump to
// bridge, so the chain reads as one animal, also round corners.

const SKIN = new THREE.Color("#8b6fc0");
const SKIN_DARK = new THREE.Color("#5a4390");
const SKIN_LIGHT = new THREE.Color("#a78bd8");
const BELLY = new THREE.Color("#f3dfc6");
const FIN = "#ff9d7a";

/**
 * Skin by place: a pale belly, darker flanks, lighter back, soft bands across.
 * `a` is the angle around a +z tube: 0 = right side, π/2 = up.
 */
function skin(a, z, c, band = 1) {
  const up = Math.sin(a);
  c.copy(SKIN).lerp(SKIN_LIGHT, Math.max(0, up) * 0.28);
  if (up > -0.35) c.lerp(SKIN_DARK, band * 0.5 * Math.max(0, Math.sin(z * Math.PI * 4)) * Math.max(0, Math.min(1, (up + 0.35) * 2)));
  if (up < -0.2) c.lerp(BELLY, Math.min(1, (-0.2 - up) * 2.2));
  return c.multiplyScalar(0.84 + 0.16 * Math.max(0, up + 0.4));
}

/** A skin tube along z. `rows`: [z, y, radius, height factor]. */
function skinTube(rows, radial, band = 1) {
  const z0 = rows[0][0];
  const span = rows.at(-1)[0] - z0;
  const pts = rows.map(([z, y]) => [0, y, z]);
  const at = (u) => {
    const k = Math.min(rows.length - 1, Math.round(u * (rows.length - 1)));
    return rows[k];
  };
  return piece(
    tube(pts, rows.map((r) => r[2]), radial, {
      rib: (a, u) => {
        const h = at(u)[3] ?? 1; // squash the ring vertically by h
        return h === 1 ? 1 : h / Math.hypot(h * Math.cos(a), Math.sin(a));
      },
      tint: (u, a, c) => skin(a, z0 + span * u, c, band),
    }),
    null,
  );
}

/** A rounded, leaf-like back fin of height h, standing on y = 0 and swept back (−z). */
function fin(h) {
  const g = new THREE.SphereGeometry(0.5, 7, 5);
  g.scale(0.07, h * 1.25, h * 1.15);
  g.rotateX(-0.45);
  g.translate(0, h * 0.5, -h * 0.15);
  return weld(g);
}
const finAt = (h, x, y, z, tip = 1) => piece(fin(h), FIN, M(x, y, z), (p, c) => c.multiplyScalar(0.78 + 0.34 * tip * Math.max(0, Math.min(1, p.y / h))));

const ball = (r, w, h, color, m, fn) => piece(weld(new THREE.SphereGeometry(r, w, h)), color, m, fn);

export function dinoHeadGeometry() {
  const parts = [];
  // Skull and snout in one skin: a domed brow that runs down to a blunt muzzle.
  parts.push(
    skinTube(
      [
        [-0.33, 0.29, 0],
        [-0.29, 0.29, 0.14, 0.9],
        [-0.19, 0.31, 0.225, 0.9],
        [-0.05, 0.325, 0.255, 0.88],
        [0.07, 0.32, 0.238, 0.86],
        [0.17, 0.3, 0.195, 0.78],
        [0.26, 0.288, 0.17, 0.7],
        [0.33, 0.28, 0.145, 0.66],
        [0.37, 0.274, 0.08, 0.7],
        [0.382, 0.272, 0],
      ],
      16,
      0.5,
    ),
  );
  // Lower jaw under it, a smile where they meet.
  const jaw = tube([[0, 0.17, -0.06], [0, 0.168, 0.04], [0, 0.17, 0.16], [0, 0.178, 0.27], [0, 0.185, 0.33], [0, 0.19, 0.345]], [0, 0.13, 0.142, 0.122, 0.075, 0], 12, {
    rib: (a) => 0.55 / Math.hypot(0.55 * Math.cos(a), Math.sin(a)),
    tint: (u, a, c) => c.copy(BELLY).multiplyScalar(0.82 + 0.18 * Math.max(0, Math.sin(a) + 0.6)),
  });
  parts.push(piece(jaw, null));
  const smile = [];
  for (let i = 0; i <= 8; i++) {
    const a = -1.15 + (i / 8) * 2.3;
    smile.push([Math.sin(a) * 0.158, 0.212 + 0.03 * Math.abs(Math.sin(a)) ** 2, 0.2 + Math.cos(a) * 0.145]);
  }
  parts.push(piece(tube(smile, [0, 0.008, 0.009, 0.009, 0.009, 0.009, 0.009, 0.008, 0], 5), "#3c2a66"));
  for (const s of [-1, 1]) {
    parts.push(ball(0.02, 8, 6, "#3c2a66", M(s * 0.062, 0.385, 0.315, 0.5, 0, 0, 1, 0.6, 1.1)));
    parts.push(ball(0.06, 10, 6, "#e7a5b4", M(s * 0.188, 0.262, 0.13, 0, s * 0.35, 0, 0.35, 0.7, 1))); // cheek
    // Big eyes on top of the head (they read from the 55° camera whichever way it faces).
    const [ex, ey, ez] = [s * 0.125, 0.452, 0.075];
    parts.push(ball(0.07, 14, 10, "#fffaf0", M(ex, ey, ez)));
    // Amber iris, pupil and two glints lie on the eyeball, looking forward and up.
    const look = new THREE.Vector3(s * 0.12, 0.5, 0.86).normalize();
    const on = (k, r, x = 0, y = 0) => [ex + look.x * k + x, ey + look.y * k + y, ez + look.z * k, 0, 0, 0, r];
    parts.push(ball(0.046, 12, 8, "#e9a13b", M(...on(0.035, 1))));
    parts.push(ball(0.032, 10, 8, "#1d1426", M(...on(0.056, 1))));
    parts.push(ball(0.011, 6, 5, "#ffffff", M(...on(0.079, 1, 0.012, 0.014))));
    parts.push(ball(0.006, 6, 4, "#ffffff", M(...on(0.081, 1, -0.012, -0.006))));
    // Eyelid: a skin cap over the back of the eye.
    const lid = new THREE.SphereGeometry(0.079, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    parts.push(piece(weld(lid), `#${SKIN.getHexString()}`, M(ex, ey - 0.004, ez - 0.004, -1.35, 0, -s * 0.15)));
  }
  // Crest down the back of the head.
  for (const [z, h, y] of [
    [0.03, 0.09, 0.525],
    [-0.07, 0.13, 0.525],
    [-0.19, 0.11, 0.49],
  ]) {
    parts.push(finAt(h, 0, y - 0.015, z));
  }
  return merge(parts);
}

/** Shared by body and tail: the bridge ends inside the segment ahead, as thick as that one's rump. */
const BRIDGE = [
  [0.22, 0.272, 0.235, 0.86],
  [0.4, 0.268, 0.212, 0.88],
  [0.6, 0.268, 0.205, 0.88],
  [0.8, 0.268, 0.19, 0.88],
  [0.86, 0.268, 0],
];

export function dinoBodyGeometry(legs) {
  const parts = [
    skinTube(
      [
        [-0.34, 0.26, 0],
        [-0.32, 0.262, 0.12, 0.85],
        [-0.24, 0.266, 0.205, 0.85],
        [-0.12, 0.272, 0.258, 0.84],
        [0.04, 0.275, 0.268, 0.84],
        ...BRIDGE,
      ],
      12,
    ),
  ];
  for (const [z, h] of [
    [-0.12, 0.13],
    [0.09, 0.16],
    [0.34, 0.13],
    [0.56, 0.11],
  ]) {
    parts.push(finAt(h, 0, z > 0.3 ? 0.445 : 0.485, z));
  }
  // Freckles on the shoulders: flat discs lying on the skin, [z, angle above the side, size].
  for (const s of [-1, 1]) {
    for (const [z, a, size] of [
      [-0.1, 0.75, 0.04],
      [0.0, 0.42, 0.03],
      [0.1, 0.8, 0.034],
      [0.2, 0.5, 0.026],
      [0.44, 0.72, 0.028],
      [0.53, 0.46, 0.022],
    ]) {
      const [R, h] = z > 0.3 ? [0.21, 0.88] : [0.262, 0.845];
      const rad = (R * h) / Math.hypot(h * Math.cos(a), Math.sin(a));
      const spot = weld(new THREE.OctahedronGeometry(size * 1.15, 0));
      parts.push(piece(spot, `#${SKIN_DARK.getHexString()}`, M(s * Math.cos(a) * rad, 0.272 + Math.sin(a) * rad, z, 0, 0, s * a, 0.32, 1, 1.15)));
    }
  }
  if (legs) {
    for (const s of [-1, 1]) {
      for (const z of [-0.13, 0.15]) {
        const x = s * 0.21;
        // A thigh that grows out of the flank, a foot with three pale claws.
        const leg = tube([[x * 0.8, 0.24, z], [x, 0.19, z], [x * 1.06, 0.1, z + 0.005], [x * 1.06, 0.045, z + 0.015], [x * 1.06, 0.004, z + 0.02]], [0.06, 0.092, 0.068, 0.072, 0], 8, {
          tint: (u, a, c) => c.copy(SKIN).lerp(SKIN_DARK, 0.25 + 0.6 * u),
        });
        parts.push(piece(leg, null));
        for (const d of [-0.04, 0, 0.04]) parts.push(piece(weld(new THREE.OctahedronGeometry(0.023, 0)), BELLY, M(x * 1.06 + d, 0.022, z + 0.078 - Math.abs(d) * 0.3)));
      }
    }
  }
  return merge(parts);
}

export function dinoTailGeometry() {
  const parts = [
    skinTube(
      [
        [-0.47, 0.36, 0],
        [-0.45, 0.345, 0.026],
        [-0.38, 0.295, 0.06],
        [-0.27, 0.252, 0.11, 0.9],
        [-0.13, 0.242, 0.165, 0.88],
        [0.03, 0.248, 0.205, 0.86],
        ...BRIDGE.map(([z, y, r, h]) => [z, y - 0.012, r * 0.95, h]),
      ],
      12,
    ),
  ];
  for (const [z, h, y] of [
    [0.36, 0.11, 0.43],
    [0.14, 0.11, 0.42],
    [-0.06, 0.09, 0.39],
    [-0.23, 0.065, 0.335],
  ]) {
    parts.push(finAt(h, 0, y - 0.015, z));
  }
  // A leaf-shaped tuft at the tip.
  for (const s of [-1, 1]) {
    const tuft = leaf(0.15, 0.085, { steps: 3, fold: 0.25, arch: 0.02, twoSided: true });
    parts.push(piece(tuft, FIN, M(0, 0.35, -0.43, -0.5, Math.PI + s * 0.5, 0), (p, c) => c.multiplyScalar(0.85 + p.z * 1.6)));
  }
  return merge(parts);
}
