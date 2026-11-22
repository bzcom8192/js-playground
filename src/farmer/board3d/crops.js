// Crop models: each function returns ONE merged, vertex-coloured, smooth
// geometry. The kit caches it per variant, so every tile that shows a crop
// shares it. The budget (board3d.test.mjs) is 300k triangles for a 12×12 farm
// of any single crop, about 2,000 per tile. Thin leaves and stalks are single
// sheets: wheat, rice, carrots and sunflowers use a double-sided material.
import * as THREE from "three";
import { leaf, leafScatter, lobe, M, merge, piece, ribbedSphere, ribbon, rng, tube, weld } from "./geom.js";

// Plants start a little below y = 0 so they never float over a soil furrow.
const ROOT = -0.035;

// ---------- wheat ----------

const WHEAT_GRID = 8; // 8×8 stalks
const WHEAT_HEAD = [0, 0.028, 0.02, 0.026, 0]; // kernel rows: thick, thin, thick

/** Greyscale: the tile's own material tints it green → gold with growth. */
export function wheatGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < WHEAT_GRID * WHEAT_GRID; i++) {
    // Stratified jitter → an even, dense patch with no bald spots.
    const x = (((i % WHEAT_GRID) + r()) / WHEAT_GRID - 0.5) * 0.88;
    const z = ((Math.floor(i / WHEAT_GRID) + r()) / WHEAT_GRID - 0.5) * 0.88;
    const h = 0.46 + r() * 0.22;
    const lx = (r() - 0.5) * 0.17; // lean
    const lz = (r() - 0.5) * 0.17;
    const tip = [x + lx * h, h, z + lz * h];
    const shade = 0.6 + r() * 0.2;
    const grey = (k) => new THREE.Color(k, k, k);
    const stalk = ribbon([[x, ROOT, z], tip], [0.013, 0.009]);
    parts.push(piece(stalk, grey(shade), null, (p, col) => col.multiplyScalar(p.y > 0 ? 1.1 : 0.8)));
    const m = M(tip[0], tip[1], tip[2], lz, r() * Math.PI * 2, -lx);
    // The grain head nods over the stalk; kernel rows alternate light and dark.
    const len = 0.16 + r() * 0.05;
    const nod = 0.02 + r() * 0.04;
    const es = 0.92 + r() * 0.08;
    const pts = WHEAT_HEAD.map((_, k) => {
      const t = k / (WHEAT_HEAD.length - 1);
      return [nod * t * t, len * t - 0.012, 0];
    });
    const head = tube(pts, WHEAT_HEAD, 3, {
      tint: (u, a, c) => c.setScalar(es * (Math.round(u * 4) % 2 ? 1 : 0.76)),
    });
    parts.push(piece(head, null, m));
    if (i % 4 === 1) {
      const blade = leaf(0.2, 0.04, { steps: 2, arch: 0.07, droop: 0.05 });
      parts.push(piece(blade, grey(shade * 0.95), M(x + lx * h * 0.4, h * 0.4, z + lz * h * 0.4, 0, r() * 6, 0).multiply(M(0, 0, 0, -0.7, 0, 0))));
    }
  }
  return merge(parts);
}

// ---------- rice ----------

// A paddy plant = 3×3 hills of thin stalks with drooping grain panicles and
// arching leaf blades, set in clumps so a paddy reads as rice planted in hills
// over the tile's water. Living rice is tinted green → gold by growth like
// wheat; `dead` is a grey-brown, slumped variant on the shared material.
const RICE_HILLS = 3;
const RICE_STALKS = 5; // per hill
const RICE_BLADES = 3;
export function riceGeometry(seed, dead = false) {
  const r = rng(seed);
  const parts = [];
  for (let hx = 0; hx < RICE_HILLS; hx++) {
    for (let hz = 0; hz < RICE_HILLS; hz++) {
      const cx = ((hx + 0.5) / RICE_HILLS - 0.5) * 0.74 + (r() - 0.5) * 0.06;
      const cz = ((hz + 0.5) / RICE_HILLS - 0.5) * 0.74 + (r() - 0.5) * 0.06;
      for (let i = 0; i < RICE_STALKS; i++) {
        const a = (i / RICE_STALKS) * Math.PI * 2 + r() * 0.6;
        const lean = (dead ? 0.45 : 0.14) + r() * (dead ? 0.3 : 0.14);
        const h = (dead ? 0.26 : 0.4) + r() * 0.14;
        const m = M(cx + Math.cos(a) * 0.025, 0, cz + Math.sin(a) * 0.025, 0, -a, 0).multiply(M(0, 0, 0, 0, 0, -lean));
        const at = (px, py) => new THREE.Vector3(px, py, 0).applyMatrix4(m).toArray();
        const stalk = ribbon([at(0, ROOT), at(0.004, h * 0.6), at(0.022, h)], [0.012, 0.01, 0.007]);
        parts.push(piece(stalk, dead ? ["#8a7a62", "#7a6a55"][i % 2] : ["#c7dc8a", "#b4d07a"][i % 2]));
        // The panicle arches outward from the tip and hangs under its own grain.
        const drop = dead ? 0.17 : 0.085;
        const pts = [
          [0.02, h - 0.015, 0],
          [0.045, h + 0.025, 0],
          [0.085, h + 0.02, 0],
          [0.115, h - drop * 0.45, 0],
          [0.13, h - drop, 0],
        ];
        const light = new THREE.Color(dead ? "#9a8668" : "#f4e7a8");
        const head = tube(pts, [0, 0.018, 0.013, 0.019, 0], 3, {
          tint: (u, _, c) => c.copy(light).multiplyScalar(Math.round(u * 4) % 2 ? 1 : 0.8),
        });
        parts.push(piece(head, null, m));
      }
      for (let i = 0; i < RICE_BLADES; i++) {
        const a = (i / RICE_BLADES) * Math.PI * 2 + r();
        const len = (dead ? 0.17 : 0.26) + r() * 0.08;
        const blade = leaf(len, 0.026, { steps: 2, arch: 0.05, droop: dead ? 0.22 : 0.12, widest: 0.35 });
        const m = M(cx, dead ? 0.06 : 0.08, cz, 0, a, 0).multiply(M(0, 0, 0, dead ? -0.5 : -1.05, 0, 0));
        parts.push(piece(blade, dead ? "#7a6a55" : ["#9cc06a", "#b4d07a"][i % 2], m));
      }
    }
  }
  return merge(parts);
}

// ---------- bush, tree ----------

/** Darker underneath and between lobes, lighter on top. */
const canopyShade = (y0, y1) => (p, c) => c.multiplyScalar(0.7 + 0.36 * Math.max(0, Math.min(1, (p.y - y0) / (y1 - y0))));

function foliage(lobes, seed, { leaves, size, y0, y1 }) {
  const shade = canopyShade(y0, y1);
  const parts = lobes.map(([x, y, z, rad, color, squash = 1, detail = 1], i) => {
    const g = lobe(rad, seed + i * 17, { squash, detail });
    g.translate(x, y, z);
    return piece(g, color, null, shade);
  });
  const scatter = piece(leafScatter(lobes, leaves, size, seed + 5), null);
  const pos = scatter.attributes.position;
  const col = scatter.attributes.color;
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    shade(p.fromBufferAttribute(pos, i), c.fromBufferAttribute(col, i));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  parts.push(scatter);
  return parts;
}

export function bushGeometry(seed, grown) {
  const r = rng(seed);
  const s = 0.9; // squash
  const lobes = [
    [-0.15, 0.17, 0.07, 0.18, "#2f7d63", s],
    [0.16, 0.18, -0.06, 0.19, "#3b8f70", s],
    [0.0, 0.3, 0.02, 0.18, "#4fa582", s, 2],
    [0.1, 0.16, 0.15, 0.15, "#37886a", s],
    [-0.08, 0.2, -0.16, 0.16, "#337f66", s],
  ];
  const parts = foliage(lobes, seed, { leaves: 170, size: 0.09, y0: 0, y1: 0.46 });
  for (const [x, z, tilt] of [
    [0.05, 0.05, 0.3],
    [-0.06, 0.02, -0.4],
    [0.0, -0.07, 0.1],
  ]) {
    parts.push(piece(tube([[x, ROOT, z], [x * 1.6, 0.14, z * 1.6 + tilt * 0.05]], [0.022, 0.014], 4), "#5a3d4f"));
  }
  if (grown) {
    // Ripe: glossy red berries in little pairs, on the sides the camera sees.
    for (let i = 0; i < 8; i++) {
      const [bx, by, bz, br] = lobes[i % 4];
      const a = 0.35 + r() * (Math.PI - 0.7) + (i % 4 === 1 ? -0.5 : 0);
      const up = 0.25 + r() * 0.55;
      const k = Math.sqrt(1 - up * up);
      const x = bx + Math.cos(a) * k * br * 1.03;
      const y = by + up * br * s * 1.03;
      const z = bz + Math.sin(a) * k * br * 1.03;
      const berry = weld(new THREE.OctahedronGeometry(0.042, 1));
      parts.push(piece(berry, "#e2574c", M(x, y, z), (p, c) => c.multiplyScalar(p.y > 0.028 ? 1.2 : 0.86 + p.y * 4)));
    }
  }
  return merge(parts);
}

export function treeGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const bark = "#5a3d4f";
  const bend = (r() - 0.5) * 0.06;
  const barkShade = (u, a, c) => c.set(bark).multiplyScalar((1 + 0.12 * Math.sin(a * 4 + 0.8)) * (0.9 + 0.3 * u));
  // Trunk with a root flare, then two limbs reaching into the canopy.
  parts.push(
    piece(
      tube(
        [[0, ROOT, 0], [0, 0.05, 0], [bend * 0.4, 0.2, 0], [bend, 0.4, 0], [bend * 1.2, 0.62, 0]],
        [0.098, 0.074, 0.058, 0.05, 0.04],
        8,
        { tint: barkShade },
      ),
      null,
    ),
  );
  for (const [dx, dz] of [
    [0.17, 0.08],
    [-0.15, 0.05],
  ]) {
    parts.push(
      piece(tube([[bend * 0.8, 0.34, 0], [dx * 0.6, 0.46, dz * 0.6], [dx, 0.57, dz]], [0.034, 0.028, 0.02], 4, { tint: barkShade }), null),
    );
  }
  // Canopy in layers: a wide dark skirt, a mid ring, a light crown and the
  // peach blossom tuft that marks our trees.
  const j = () => (r() - 0.5) * 0.05;
  const lobes = [
    [0.18 + j(), 0.59, 0.07 + j(), 0.17, "#34857a", 0.8],
    [-0.19 + j(), 0.61, 0.05 + j(), 0.17, "#2d7a6b", 0.8],
    [0.02 + j(), 0.6, -0.18 + j(), 0.19, "#2d7a6b", 0.8],
    [0.02 + j(), 0.66, 0.15 + j(), 0.15, "#3f9580", 0.8],
    [0.0, 0.73, 0.0, 0.25, "#378a79", 0.9, 2],
    [0.16 + j(), 0.8, 0.04, 0.15, "#3f9580", 0.9],
    [0.02, 0.92, -0.04, 0.16, "#4aa58e", 0.9],
    [-0.14, 0.89, 0.02, 0.2, "#f0b9a8", 0.9, 2],
  ];
  parts.push(...foliage(lobes, seed, { leaves: 300, size: 0.11, y0: 0.42, y1: 1.02 }));
  // Loose blossoms where the tuft runs into the green.
  for (let i = 0; i < 7; i++) {
    const a = -0.4 + r() * 2.6;
    const up = 0.1 + r() * 0.8;
    const k = Math.sqrt(1 - up * up) * 0.265;
    const b = weld(new THREE.OctahedronGeometry(0.034, 0));
    parts.push(piece(b, i % 2 ? "#f0b9a8" : "#f7d3c4", M(Math.cos(a) * k, 0.73 + up * 0.24, Math.sin(a) * k, 0, 0, 0, 1, 0.75, 1)));
  }
  return merge(parts);
}

// ---------- carrot ----------

export function carrotGeometry(seed, grown) {
  const r = rng(seed);
  const parts = [];
  const spots = [
    [-0.2, -0.2],
    [0.2, -0.18],
    [-0.18, 0.2],
    [0.21, 0.2],
  ];
  spots.forEach(([sx, sz], i) => {
    const x = sx + (r() - 0.5) * 0.08;
    const z = sz + (r() - 0.5) * 0.08;
    const top = grown ? 0.085 : 0.02;
    if (grown) {
      // Ripe: the orange shoulder stands proud of the soil, with growth rings.
      const root = tube(
        [[0, -0.06, 0], [0, 0, 0], [0, 0.036, 0], [0, 0.068, 0], [0, 0.084, 0]],
        [0.04, 0.068, 0.078, 0.062, 0],
        12,
        { tint: (u, a, c) => c.set("#ef7b45").multiplyScalar(Math.round(u * 4) % 2 ? 0.88 : 1.04) },
      );
      parts.push(piece(root, null, M(x, 0, z, (r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25)));
    }
    // Feathery top: an upright heart plus a ring of fronds with leaflets.
    const fronds = grown ? 7 : 4;
    for (let k = 0; k < fronds; k++) {
      const a = (k / fronds) * Math.PI * 2 + r() * 0.6;
      const tilt = k === 0 ? 0.12 : 0.4 + r() * 0.35;
      const len = (k === 0 ? 0.3 : 0.25) + r() * 0.05;
      const green = k % 2 ? "#3a9a78" : "#57b592";
      const m = M(x, top - 0.01, z, 0, a, 0).multiply(M(0, 0, 0, tilt - Math.PI / 2, 0, 0));
      parts.push(piece(leaf(len, 0.055, { steps: 2, arch: 0.02, droop: 0.05, widest: 0.55 }), green, m));
      const pairs = grown ? 2 : 1;
      for (let q = 0; q < pairs; q++) {
        for (const s of [-1, 1]) {
          const at = len * (0.38 + q * 0.26);
          const lm = m.clone().multiply(M(0, 0.008, at, 0, s * 0.95, 0));
          parts.push(piece(leaf(0.095 - q * 0.02, 0.042, { steps: 2, droop: 0.015 }), q ? "#57b592" : green, lm));
        }
      }
    }
    if (grown && i % 2 === 0) {
      // Every other ripe carrot carries its cream flower: a small domed umbel.
      parts.push(piece(tube([[x, top, z], [x + 0.03, 0.27, z]], [0.008, 0.006], 4), "#3a9a78"));
      const umbel = weld(new THREE.IcosahedronGeometry(0.037, 1));
      parts.push(piece(umbel, "#fbe3c8", M(x + 0.03, 0.27, z, 0, 0, 0, 1, 0.8, 1), (p, c) => c.multiplyScalar(0.9 + 2.6 * p.y)));
    }
  });
  return merge(parts);
}

// ---------- pumpkin ----------

/** Darker in the grooves between pumpkin lobes, lighter on the lobes and toward the top. */
function ribShade(lobes, dark, light, radius) {
  const d = new THREE.Color(dark);
  const l = new THREE.Color(light);
  return (p, out) => {
    const k = Math.pow(Math.abs(Math.cos((lobes / 2) * Math.atan2(p.z, p.x))), 0.8);
    const up = Math.max(0, Math.min(1, p.y / radius + 0.6));
    return out.copy(d).lerp(l, k * (0.72 + 0.28 * up));
  };
}

/** `fine` is the giant (merged) pumpkin: the same shape at about 4× the triangles, plus a vine. */
export function pumpkinGeometry(dead, fine = false) {
  const parts = [];
  const R = 0.4;
  const body = ribbedSphere(R, { lobes: 10, w: fine ? 80 : 40, h: fine ? 20 : 11, squash: 0.66, dimple: 0.72, rib: 0.13 });
  const shade = dead ? ribShade(10, "#645c6b", "#948a98", R) : ribShade(10, "#a8505f", "#eeab98", R);
  const lift = R * 0.66 * 0.92;
  parts.push(piece(body, "#fff", M(0, lift, 0), shade));
  // A ridged, twisting stem that flares where it meets the rind.
  const stemDark = dead ? "#4f4854" : "#3f7a5c";
  const stem = tube(
    [[0, -0.02, 0], [0, 0.02, 0], [0.008, 0.06, 0.004], [0.03, 0.105, 0.012], [0.062, 0.135, 0.02], [0.066, 0.138, 0.021]],
    [0.085, 0.05, 0.034, 0.028, 0.03, 0],
    10,
    {
      rib: (a, u) => 1 + 0.16 * Math.cos(a * 5 + u * 1.2),
      tint: (u, a, c) => c.set(stemDark).multiplyScalar((Math.cos(a * 5 + u * 1.2) > 0 ? 1.18 : 0.8) * (u > 0.95 ? 1.5 : 1)),
    },
  );
  parts.push(piece(stem, null, M(0, dead ? 0.335 : 0.35, 0)));
  if (!dead) {
    for (const [a, len] of [
      [2.3, 0.15],
      [4.4, 0.12],
    ]) {
      const m = M(0, 0.425, 0, 0, a, 0).multiply(M(0, 0, 0.03, -0.12, 0, 0));
      parts.push(piece(leaf(len, 0.11, { steps: fine ? 5 : 3, arch: 0.02, droop: 0.025, widest: 0.4, twoSided: true }), "#4a8f6c", m));
    }
  }
  if (fine) {
    // A curling tendril beside the stem.
    const pts = [];
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = t * Math.PI * 4.5;
      const k = 0.032 * (1 - t * 0.6);
      pts.push([-0.04 - t * 0.12 + Math.cos(a) * k, 0.445 + 0.02 * Math.sin(t * Math.PI) + Math.sin(a) * k * 0.6, 0.05 + t * 0.07]);
    }
    parts.push(piece(tube(pts, pts.map((_, i) => (i === 0 || i === n ? 0 : 0.008 * (1 - (i / n) * 0.5))), 4), "#4a8f6c"));
  }
  const g = merge(parts);
  g.translate(0, -0.04, 0); // settled a little into the soil
  return g;
}

// ---------- sunflower ----------

export function sunflowerGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const stem = tube(
    [[0, ROOT, 0], [0.012, 0.2, 0], [0.004, 0.42, -0.012], [0, 0.6, -0.01], [0, 0.645, 0.012]],
    [0.03, 0.024, 0.021, 0.02, 0.018],
    7,
  );
  parts.push(piece(stem, "#3a8a68"));
  for (const [y, a, len] of [
    [0.2, 1.4, 0.26],
    [0.34, 1.4 + Math.PI, 0.23],
    [0.46, 0.2, 0.17],
  ]) {
    const m = M(0, y, 0, 0, a + r() * 0.4, 0).multiply(M(0, 0, 0, -0.45, 0, 0));
    parts.push(piece(leaf(len, len * 0.62, { steps: 4, fold: 0.25, arch: 0.04, droop: 0.12, widest: 0.38 }), y > 0.3 ? "#57ab86" : "#4fa07c", m));
  }
  // Head: two rows of petals and a domed seed disc, built facing +y then
  // tilted toward the camera (+z).
  const head = [];
  const petals = 16;
  for (let i = 0; i < petals * 2; i++) {
    const inner = i >= petals;
    const a = ((i + (inner ? 0.5 : 0)) / petals) * Math.PI * 2;
    const len = (inner ? 0.105 : 0.135) * (0.94 + r() * 0.12);
    const petal = leaf(len, inner ? 0.05 : 0.06, { steps: 2, fold: 0.3, arch: 0.012, droop: inner ? -0.025 : 0.02, widest: 0.5 });
    const warm = i % 2 ? "#ffd25e" : "#f2a93b";
    head.push(
      piece(petal, inner ? "#ffd25e" : warm, M(0, inner ? 0.012 : 0, 0, 0, a, 0).multiply(M(0, 0, 0.08)), (p, c) =>
        c.multiplyScalar(0.82 + 0.24 * Math.min(1, p.z / len)),
      ),
    );
  }
  const disc = tube(
    [[0, -0.03, 0], [0, -0.012, 0], [0, 0.012, 0], [0, 0.03, 0], [0, 0.036, 0], [0, 0.034, 0]],
    [0, 0.085, 0.096, 0.07, 0.036, 0],
    18,
    { tint: (u, a, c) => c.set(u < 0.3 ? "#3a8a68" : u > 0.9 ? "#7a5064" : "#4a2b45").multiplyScalar(u > 0.5 && u < 0.7 ? 1.25 : 1) },
  );
  head.push(piece(disc, null));
  // Seeds in a sunflower spiral (4-sided pips).
  for (let i = 2; i < 34; i++) {
    const a = i * 2.39996;
    const k = 0.0148 * Math.sqrt(i);
    const y = 0.036 - 0.028 * (k / 0.09) ** 2;
    const pip = tube([[0, -0.004, 0], [0, 0.009, 0]], [0.0085, 0], 4);
    head.push(piece(pip, i % 3 ? "#5c3a55" : "#8a5f63", M(Math.cos(a) * k, y, Math.sin(a) * k, 0, -a, 0)));
  }
  const headGeo = merge(head);
  headGeo.applyMatrix4(M(0, 0.655, 0.025, 0.75, 0, 0));
  parts.push(headGeo);
  return merge(parts);
}

// ---------- cactus ----------

/** Column height per size step is unchanged: size 0–9 must stay comparable by eye. */
export function cactusGeometry(size, grown) {
  const parts = [];
  const k = size || 0;
  const h = 0.26 + k * 0.035;
  const ribs = 8;
  const dark = new THREE.Color("#33796f");
  const green = new THREE.Color("#3f8f86");
  const light = new THREE.Color("#a9ddc9");
  const ribK = (a) => Math.abs(Math.cos((ribs / 2) * a));
  const tint = (u, a, c) => {
    const t = ribK(a);
    if (t > 0.97) c.copy(green).lerp(light, 0.75);
    else c.copy(dark).lerp(green, t);
    return c.multiplyScalar(0.82 + 0.24 * u);
  };
  const rib = (a) => 0.82 + 0.18 * Math.pow(ribK(a), 0.8);

  // Ribbed column with a soft waist every few steps and a domed crown.
  const top = h + 0.08;
  const rings = 7;
  const pts = [];
  const radii = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = ROOT + (top - ROOT) * Math.sin((t * Math.PI) / 2);
    pts.push([0, y, 0]);
    const dome = y > top - 0.11 ? Math.sqrt(Math.max(0, 1 - ((y - (top - 0.11)) / 0.11) ** 2)) : 1;
    const foot = 0.86 + 0.14 * Math.min(1, (y - ROOT) / 0.12);
    radii.push(i === rings ? 0 : 0.118 * dome * foot * (1 - 0.1 * (y / top)));
  }
  parts.push(piece(tube(pts, radii, 32, { rib, tint }), null));

  // Arms: an elbow out of the column, then up. Tall cacti grow a second one.
  const arm = (side, y, up, r0) => {
    const x = side * 0.085;
    const p = [
      [x * 0.6, y, 0],
      [x + side * 0.045, y - 0.004, 0],
      [x + side * 0.082, y + 0.018, 0],
      [x + side * 0.095, y + up * 0.7, 0],
      [x + side * 0.093, y + up, 0],
      [x + side * 0.092, y + up + 0.04, 0],
    ];
    const rr = [0.8, 0.92, 1, 1, 0.74, 0].map((v) => v * r0);
    parts.push(piece(tube(p, rr, 16, { rib: (a) => 0.88 + 0.12 * ribK(a), tint }), null));
  };
  arm(1, h * 0.46, 0.13, 0.054);
  if (k >= 4) arm(-1, h * 0.6, 0.1, 0.046);

  // Spine tufts along the ribs: tiny cream darts.
  const r = rng(900 + k);
  const rows = 3 + Math.floor(k / 4);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    for (let j = 0; j < rows; j++) {
      const y = 0.06 + ((j + 0.5 + (i % 2) * 0.35) / rows) * (h - 0.05);
      const dart = tube([[0, 0, 0], [0, 0.034, 0]], [0.007, 0], 3);
      parts.push(piece(dart, "#fbe3c8", M(Math.cos(a) * 0.108, y, -Math.sin(a) * 0.108, 0, a, 0).multiply(M(0, 0, 0, 0, 0, -1.2 + r() * 0.3))));
    }
  }
  if (grown) {
    // Ripe: an open coral flower with a yellow heart.
    const fy = top - 0.012;
    for (let i = 0; i < 14; i++) {
      const inner = i >= 8;
      const a = inner ? ((i - 8) / 6) * Math.PI * 2 + 0.3 : (i / 8) * Math.PI * 2;
      const petal = leaf(inner ? 0.062 : 0.085, 0.045, { steps: 2, fold: 0.35, droop: -0.02, twoSided: true });
      parts.push(piece(petal, inner ? "#ffa98c" : "#ff8d6b", M(0, fy, 0, 0, a, 0).multiply(M(0, 0, 0.012, inner ? -1.0 : -0.45, 0, 0))));
    }
    parts.push(piece(new THREE.SphereGeometry(0.022, 8, 5), "#ffe066", M(0, fy + 0.03, 0)));
  }
  return merge(parts);
}
