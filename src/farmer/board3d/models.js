// Low-poly farm models built only from three.js primitives.
//
// Every static model (wheat patch, rice paddy, bush, tree, carrots, pumpkin, sunflower,
// cactus, maze hedge, treasure chest, apple, dinosaur segment) is ONE merged, vertex-coloured geometry drawn with a shared
// flat-shaded material, so a model costs one draw call. Geometries are cached
// per variant and shared by every tile that shows that model; the kit owns
// and disposes them. The only textures are small canvas ones (soil rows,
// meadow speckles, water ripples, plank grain, the bot's blob shadow).
import * as THREE from "three";
import { DRONE_BAND_0, statusLight } from "../droneBands.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const hasDOM = typeof document !== "undefined";

// ---------- small helpers ----------

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
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/**
 * Prepare one primitive for merging: non-indexed, transformed, with a flat
 * colour (or a per-vertex colour function) and only position/normal/color.
 */
function part(geo, color, matrix, colorFn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (matrix) g.applyMatrix4(matrix);
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
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "color") g.deleteAttribute(name);
  }
  return g;
}

function merge(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Sphere with vertical lobes (pumpkin ribs), squashed, with a dimpled top. */
function ribbedSphere(radius, { lobes = 8, w = 24, h = 10, squash = 0.62, dimple = 0.5, rib = 0.1 } = {}) {
  const g = new THREE.SphereGeometry(radius, w, h);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const phi = Math.atan2(v.z, v.x);
    const r = 1 - rib + rib * Math.pow(Math.abs(Math.cos((lobes / 2) * phi)), 0.6);
    v.x *= r;
    v.z *= r;
    const ny = v.y / radius;
    v.y *= squash;
    if (ny > 0.55) v.y -= (ny - 0.55) * radius * dimple;
    if (ny < -0.7) v.y += (-0.7 - ny) * radius * 0.4; // flatter bottom
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Darker in the grooves between pumpkin lobes, lighter on the lobes. */
function ribShade(lobes, dark, light) {
  const d = new THREE.Color(dark);
  const l = new THREE.Color(light);
  return (p, out) => {
    const k = Math.pow(Math.abs(Math.cos((lobes / 2) * Math.atan2(p.z, p.x))), 0.8);
    return out.copy(d).lerp(l, k);
  };
}

// ---------- canvas textures ----------

function canvasTexture(size, draw, { repeat = false } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Bevel feel on a tile top: light top-left rim, dark bottom-right rim. */
function bevel(ctx, s) {
  const b = Math.max(2, Math.round(s * 0.04));
  ctx.fillStyle = "rgba(255,245,235,.16)";
  ctx.fillRect(0, 0, s, b);
  ctx.fillRect(0, 0, b, s);
  ctx.fillStyle = "rgba(40,20,45,.22)";
  ctx.fillRect(0, s - b, s, b);
  ctx.fillRect(s - b, 0, b, s);
}

function speckle(ctx, s, colors, count, seed, size = 2) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.fillRect(Math.floor(r() * s), Math.floor(r() * s), size, size);
  }
}

const soilTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = "#675659";
    ctx.fillRect(0, 0, s, s);
    // Plough rows (East–West): a dark furrow and a light ridge, 4 per tile.
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const y = (i + 0.5) * (s / rows);
      ctx.fillStyle = "rgba(40,20,32,.42)";
      ctx.fillRect(0, y - 4, s, 7);
      ctx.fillStyle = "rgba(255,205,190,.14)";
      ctx.fillRect(0, y + 5, s, 4);
    }
    speckle(ctx, s, ["rgba(38,18,30,.35)", "rgba(255,215,200,.16)"], 220, 11);
    bevel(ctx, s);
  });

const grassTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = "#6fa58a";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, ["#5d9479", "#82b699", "#669c82", "#93c3a4"], 900, 23, 3);
    bevel(ctx, s);
  });

const waterTexture = () =>
  canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = "#b8d4ee";
    ctx.fillRect(0, 0, s, s);
    const r = rng(5);
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const x = r() * s;
      const y = r() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 6, y - 3, x + 12, y);
      ctx.stroke();
    }
  });

/** Side of the planter box: three stained planks with a little grain. */
const plankTexture = () =>
  canvasTexture(
    128,
    (ctx, s) => {
      const planks = ["#7c5468", "#714b60", "#674358"];
      planks.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(0, (i * s) / 3, s, s / 3);
        ctx.fillStyle = "rgba(35,18,40,.5)";
        ctx.fillRect(0, ((i + 1) * s) / 3 - 3, s, 3);
      });
      const r = rng(31);
      for (let i = 0; i < 46; i++) {
        ctx.fillStyle = i % 2 ? "rgba(40,20,45,.16)" : "rgba(255,225,215,.1)";
        ctx.fillRect(Math.floor(r() * s), Math.floor(r() * s), 12 + r() * 34, 1.5);
      }
    },
    { repeat: true },
  );

const blobShadowTexture = () =>
  canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(0,0,0,.55)");
    g.addColorStop(0.55, "rgba(0,0,0,.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

// ---------- model geometries ----------

const WHEAT_STALKS = 100;

function wheatGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  // Stratified jitter → an even, dense patch with no bald spots.
  const grid = 10;
  for (let i = 0; i < WHEAT_STALKS; i++) {
    const gx = (i % grid) + r();
    const gz = Math.floor(i / grid) + r();
    const x = (gx / grid - 0.5) * 0.88;
    const z = (gz / grid - 0.5) * 0.88;
    const h = 0.46 + r() * 0.24;
    const rx = (r() - 0.5) * 0.28;
    const rz = (r() - 0.5) * 0.28;
    const ry = r() * Math.PI;
    const shade = 0.72 + r() * 0.2;
    const m = M(x, 0, z, rx, ry, rz);
    const stalk = new THREE.CylinderGeometry(0.007, 0.012, h, 3, 1, true);
    stalk.translate(0, h / 2, 0);
    parts.push(part(stalk, new THREE.Color(shade, shade, shade), m));
    const ear = new THREE.OctahedronGeometry(0.032);
    ear.scale(0.85, 3, 0.85);
    ear.translate(0, h + 0.08, 0);
    const es = 0.92 + r() * 0.08;
    parts.push(part(ear, new THREE.Color(es, es, es), m));
  }
  return merge(parts);
}

// Rice (v3 phase 5): a paddy plant = 3×3 hills of thin stalks, each with a
// drooping grain panicle. Far fewer stalks than a wheat patch, set in
// clumps, so a paddy reads as rice planted in hills over the tile's water.
// Living rice is tinted green → gold by growth like wheat (per-instance
// material); `dead` is a grey-brown, slumped variant on the flat material.
const RICE_HILLS = 3;
const RICE_STALKS = 6; // per hill
function riceGeometry(seed, dead = false) {
  const r = rng(seed);
  const parts = [];
  for (let hx = 0; hx < RICE_HILLS; hx++) {
    for (let hz = 0; hz < RICE_HILLS; hz++) {
      const cx = ((hx + 0.5) / RICE_HILLS - 0.5) * 0.74 + (r() - 0.5) * 0.06;
      const cz = ((hz + 0.5) / RICE_HILLS - 0.5) * 0.74 + (r() - 0.5) * 0.06;
      for (let i = 0; i < RICE_STALKS; i++) {
        const a = (i / RICE_STALKS) * Math.PI * 2 + r() * 0.6;
        const lean = (dead ? 0.55 : 0.16) + r() * (dead ? 0.35 : 0.14);
        const h = (dead ? 0.26 : 0.4) + r() * 0.14;
        const m = M(cx + Math.cos(a) * 0.025, 0, cz + Math.sin(a) * 0.025, Math.sin(a) * lean, 0, -Math.cos(a) * lean);
        const stalk = new THREE.CylinderGeometry(0.006, 0.01, h, 3, 1, true);
        stalk.translate(0, h / 2, 0);
        const sc = dead ? ["#8a7a62", "#7a6a55"][i % 2] : ["#c7dc8a", "#b4d07a"][i % 2];
        parts.push(part(stalk, sc, m));
        // A drooping panicle: a slim spindle bent out over the stalk's tip.
        const head = new THREE.OctahedronGeometry(0.022);
        head.scale(0.8, 3.2, 0.8);
        head.rotateZ(dead ? 1.2 : 0.75);
        head.translate(-0.03, h + 0.02, 0);
        parts.push(part(head, dead ? "#9a8668" : "#f4e7a8", m));
      }
    }
  }
  return merge(parts);
}

function bushGeometry(seed, grown) {
  const r = rng(seed);
  const parts = [];
  const blobs = [
    [-0.13, 0.17, 0.06, 0.2, "#2f7d63"],
    [0.13, 0.19, -0.05, 0.22, "#3b8f70"],
    [0.0, 0.31, 0.04, 0.18, "#4fa582"],
  ];
  for (const [x, y, z, rad, c] of blobs) {
    parts.push(part(new THREE.IcosahedronGeometry(rad, 0), c, M(x, y, z, r() * 3, r() * 3, r() * 3, 1, 0.85, 1)));
  }
  if (grown) {
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      const [bx, by, bz, br] = blobs[i % 3];
      parts.push(
        part(
          new THREE.IcosahedronGeometry(0.045, 0),
          "#e2574c",
          M(bx + Math.cos(a) * br * 0.95, by + (r() - 0.2) * br * 0.7, bz + Math.sin(a) * br * 0.95),
        ),
      );
    }
  }
  return merge(parts);
}

function treeGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.55, 6);
  trunk.translate(0, 0.275, 0);
  parts.push(part(trunk, "#5a3d4f"));
  const canopy = [
    [0, 0.68, 0, 0.32, "#2d7a6b"],
    [0.18, 0.55, 0.1, 0.22, "#3f9580"],
    [-0.14, 0.88, -0.04, 0.24, "#f0b9a8"],
  ];
  for (const [x, y, z, rad, c] of canopy) {
    parts.push(part(new THREE.IcosahedronGeometry(rad, 0), c, M(x, y, z, r() * 3, r() * 3, r() * 3)));
  }
  return merge(parts);
}

function carrotGeometry(seed, grown) {
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
    if (grown) {
      const shoulder = new THREE.ConeGeometry(0.065, 0.14, 6);
      shoulder.rotateX(Math.PI); // tip down, into the soil
      parts.push(part(shoulder, "#ef7b45", M(x, 0.03, z)));
    }
    const leaves = 5;
    for (let k = 0; k < leaves; k++) {
      const a = (k / leaves) * Math.PI * 2 + r();
      const leaf = new THREE.ConeGeometry(0.036, 0.3, 4);
      leaf.translate(0, 0.15, 0);
      const tilt = 0.35 + r() * 0.3;
      parts.push(part(leaf, k % 2 ? "#3a9a78" : "#57b592", M(x, 0.04, z, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)));
    }
    if (grown && i % 2 === 0) {
      parts.push(part(new THREE.IcosahedronGeometry(0.035, 0), "#fbe3c8", M(x + 0.03, 0.27, z)));
    }
  });
  return merge(parts);
}

function pumpkinGeometry(dead) {
  const parts = [];
  const body = ribbedSphere(0.4, { lobes: 10, w: 30, h: 12, squash: 0.66, dimple: 0.45 });
  body.translate(0, 0.4 * 0.66 * 0.92, 0);
  parts.push(part(body, "#fff", null, dead ? ribShade(10, "#645c6b", "#948a98") : ribShade(10, "#a8505f", "#eeab98")));
  const stem = new THREE.CylinderGeometry(0.025, 0.045, 0.14, 5);
  stem.translate(0, 0.07, 0);
  parts.push(part(stem, dead ? "#4f4854" : "#3f7a5c", M(0, 0.36, 0, 0.25, 0, 0.15)));
  return merge(parts);
}

function sunflowerGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.018, 0.026, 0.62, 5);
  stem.translate(0, 0.31, 0);
  parts.push(part(stem, "#3a8a68"));
  for (const [y, a] of [
    [0.22, 0.4],
    [0.36, 0.4 + Math.PI],
  ]) {
    const leaf = new THREE.IcosahedronGeometry(0.1, 0);
    leaf.scale(1.4, 0.22, 0.65);
    leaf.translate(0.13, 0, 0);
    parts.push(part(leaf, "#4fa07c", M(0, y, 0, 0, a + r() * 0.3, 0.3)));
  }
  // Head: petals + seed disc, built facing +y then tilted toward the camera (+z).
  const head = [];
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const petal = new THREE.BoxGeometry(0.07, 0.018, 0.13);
    petal.translate(0, 0, 0.14);
    head.push(part(petal, i % 2 ? "#ffd25e" : "#f2a93b", M(0, 0, 0, 0, a, 0)));
  }
  const disc = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10);
  head.push(part(disc, "#4a2b45", M(0, 0.012, 0)));
  const headGeo = merge(head);
  headGeo.applyMatrix4(M(0, 0.64, 0.02, 0.75, 0, 0));
  parts.push(headGeo);
  return merge(parts);
}

function cactusGeometry(size, grown) {
  const parts = [];
  const h = 0.26 + (size || 0) * 0.035;
  const green = "#3f8f86";
  const rib = "#a9ddc9";
  const segs = 2 + (size >= 5 ? 1 : 0);
  // Main column: stacked capsule segments with lighter vertical ribs.
  for (let s = 0; s < segs; s++) {
    const sh = h / segs;
    const seg = new THREE.CapsuleGeometry(0.1 - s * 0.008, sh * 0.6, 2, 8);
    parts.push(part(seg, s % 2 ? "#4a9d93" : green, M(0, sh * (s + 0.5) + 0.04, 0)));
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const ribGeo = new THREE.BoxGeometry(0.022, h * 0.9, 0.022);
    parts.push(part(ribGeo, rib, M(Math.cos(a) * 0.092, h / 2 + 0.04, Math.sin(a) * 0.092)));
  }
  // One arm.
  const armUp = new THREE.CapsuleGeometry(0.055, 0.1, 2, 6);
  parts.push(part(armUp, green, M(0.17, h * 0.55 + 0.1, 0)));
  const armOut = new THREE.CapsuleGeometry(0.05, 0.06, 2, 6);
  parts.push(part(armOut, green, M(0.11, h * 0.5, 0, 0, 0, Math.PI / 2)));
  if (grown) {
    parts.push(part(new THREE.IcosahedronGeometry(0.055, 0), "#ff8d6b", M(0, h + 0.13, 0, 0, 0, 0, 1, 0.6, 1)));
    parts.push(part(new THREE.IcosahedronGeometry(0.022, 0), "#ffe066", M(0, h + 0.16, 0)));
  }
  return merge(parts);
}

/** A boxy, dark-green hedge block that fills its tile (maze wall). */
function hedgeGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const H = 0.5;
  // Darker toward the ground, like a clipped hedge in its own shade.
  const shadeByHeight = (p, c) => c.multiplyScalar(0.62 + 0.38 * Math.max(0, Math.min(1, p.y / H)));
  const body = new THREE.BoxGeometry(0.98, H, 0.98, 2, 2, 2);
  body.translate(0, H / 2, 0);
  parts.push(part(body, "#2a5f5a", null, shadeByHeight));
  // Leafy clumps on the top break up the perfect box a little.
  const greens = ["#265650", "#32716a", "#3c8078", "#2a5f58"];
  for (let i = 0; i < 9; i++) {
    const gx = ((i % 3) - 1) * 0.3 + (r() - 0.5) * 0.08;
    const gz = (Math.floor(i / 3) - 1) * 0.3 + (r() - 0.5) * 0.08;
    const w = 0.26 + r() * 0.08;
    const h = 0.06 + r() * 0.05;
    const clump = new THREE.BoxGeometry(w, h, w);
    parts.push(part(clump, greens[i % greens.length], M(gx, H + h / 2 - 0.01, gz, 0, r() * 0.5, 0)));
  }
  return merge(parts);
}

/** A gold treasure chest: box + rounded lid + dark bands + lock, front faces +z (the camera). */
function treasureGeometry() {
  const parts = [];
  const W = 0.68;
  const D = 0.46;
  const BH = 0.3;
  const gold = "#e2a925";
  const goldLight = "#f7d35c";
  const band = "#6b3f12";
  const body = new THREE.BoxGeometry(W, BH, D);
  parts.push(part(body, gold, M(0, BH / 2, 0)));
  // Rounded lid: half cylinder lying along x.
  // (CylinderGeometry's θ ∈ [0, π] is the x ≥ 0 half; rotating about z turns it into the top half.)
  const lid = new THREE.CylinderGeometry(D / 2, D / 2, W, 12, 1, false, 0, Math.PI);
  parts.push(part(lid, goldLight, M(0, BH, 0, 0, 0, Math.PI / 2)));
  // Bands: two straps over body and lid, plus a rim between them.
  for (const x of [-W * 0.32, W * 0.32]) {
    parts.push(part(new THREE.BoxGeometry(0.06, BH + 0.01, D + 0.02), band, M(x, BH / 2, 0)));
    const strap = new THREE.CylinderGeometry(D / 2 + 0.012, D / 2 + 0.012, 0.06, 12, 1, false, 0, Math.PI);
    parts.push(part(strap, band, M(x, BH, 0, 0, 0, Math.PI / 2)));
  }
  parts.push(part(new THREE.BoxGeometry(W + 0.02, 0.04, D + 0.02), band, M(0, BH - 0.01, 0)));
  // Lock plate + keyhole on the front.
  parts.push(part(new THREE.BoxGeometry(0.1, 0.12, 0.03), "#fff0a0", M(0, BH - 0.03, D / 2 + 0.012)));
  parts.push(part(new THREE.BoxGeometry(0.025, 0.05, 0.01), "#3a2208", M(0, BH - 0.04, D / 2 + 0.03)));
  // A few spilled coins.
  for (const [x, z] of [
    [0.4, 0.26],
    [-0.38, 0.3],
    [0.3, 0.36],
  ]) {
    parts.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.018, 10), goldLight, M(x, 0.01, z)));
  }
  return merge(parts);
}

// ---------- dinosaur + apple ----------
// Dinosaur segments face +z: a segment's +z points at the segment ahead of it
// (toward the head), and the head's +z is its snout. Body/tail segments carry
// a "bridge" reaching forward to the next segment so the chain reads as one
// continuous animal at tile size.

const DINO_GREEN = "#8b6fc0"; // skin
const DINO_DARK = "#5a4390";
const DINO_BELLY = "#f3dfc6";
const DINO_PLATE = "#ff9d7a"; // back fins

/** Darker underneath, a pale belly band low down. */
const dinoShade = (p, c) => {
  if (p.y < 0.17) return c.lerp(new THREE.Color(DINO_BELLY), 0.55);
  return c.multiplyScalar(0.78 + 0.22 * Math.min(1, p.y / 0.45));
};

/** A rounded, leaf-like back fin of height h, standing on y = 0 and swept back (−z). */
function finGeometry(h) {
  const g = new THREE.SphereGeometry(0.5, 6, 5);
  g.scale(0.07, h * 1.25, h * 1.15);
  g.rotateX(-0.45);
  g.translate(0, h * 0.5, -h * 0.15);
  return g;
}

function dinoHeadGeometry() {
  const parts = [];
  const skull = new THREE.SphereGeometry(0.26, 10, 8);
  parts.push(part(skull, DINO_GREEN, M(0, 0.31, -0.03, 0, 0, 0, 1, 0.86, 1.08), dinoShade));
  // Snout + lower jaw, pushed forward.
  parts.push(part(new THREE.BoxGeometry(0.3, 0.18, 0.28, 1, 1, 1), "#9c82cf", M(0, 0.28, 0.22)));
  parts.push(part(new THREE.BoxGeometry(0.26, 0.07, 0.26), DINO_BELLY, M(0, 0.17, 0.21)));
  // A little smile line and nostrils.
  parts.push(part(new THREE.BoxGeometry(0.27, 0.018, 0.02), "#3c2a66", M(0, 0.205, 0.347)));
  for (const x of [-0.07, 0.07]) {
    parts.push(part(new THREE.BoxGeometry(0.035, 0.02, 0.03), "#3c2a66", M(x, 0.37, 0.34)));
  }
  // Big eyes on top of the head (they read from the 55° camera whichever way it faces).
  for (const x of [-0.12, 0.12]) {
    parts.push(part(new THREE.SphereGeometry(0.068, 8, 6), "#ffffff", M(x, 0.45, 0.08)));
    parts.push(part(new THREE.SphereGeometry(0.036, 6, 4), "#1b1b1b", M(x * 1.08, 0.47, 0.13)));
    parts.push(part(new THREE.SphereGeometry(0.012, 4, 3), "#ffffff", M(x * 1.08 + 0.012, 0.49, 0.158)));
  }
  // Crest plates down the back of the head.
  for (const [z, h] of [
    [-0.06, 0.12],
    [-0.19, 0.1],
  ]) {
    parts.push(part(finGeometry(h), DINO_PLATE, M(0, 0.54 - 0.03 + z * 0.4, z)));
  }
  return merge(parts);
}

function dinoBodyGeometry(legs) {
  const parts = [];
  const torso = new THREE.SphereGeometry(0.27, 10, 7);
  parts.push(part(torso, DINO_GREEN, M(0, 0.27, 0, 0, 0, 0, 1, 0.82, 1.12), dinoShade));
  // Bridge to the segment ahead (+z).
  const bridge = new THREE.CylinderGeometry(0.2, 0.22, 0.6, 8);
  parts.push(part(bridge, DINO_GREEN, M(0, 0.26, 0.33, Math.PI / 2, 0, 0, 1, 1, 0.85), dinoShade));
  // Back plates.
  for (const [z, h] of [
    [-0.1, 0.14],
    [0.1, 0.16],
    [0.42, 0.11],
  ]) {
    const y = z > 0.3 ? 0.43 : 0.49;
    parts.push(part(finGeometry(h), DINO_PLATE, M(0, y - 0.02, z)));
  }
  if (legs) {
    for (const x of [-0.21, 0.21]) {
      for (const z of [-0.12, 0.14]) {
        parts.push(part(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 6), DINO_DARK, M(x, 0.07, z)));
      }
    }
  }
  return merge(parts);
}

function dinoTailGeometry() {
  const parts = [];
  parts.push(part(new THREE.SphereGeometry(0.21, 9, 6), DINO_GREEN, M(0, 0.23, 0, 0, 0, 0, 1, 0.85, 1), dinoShade));
  const bridge = new THREE.CylinderGeometry(0.19, 0.21, 0.62, 8);
  parts.push(part(bridge, DINO_GREEN, M(0, 0.24, 0.32, Math.PI / 2, 0, 0, 1, 1, 0.85), dinoShade));
  // Tapering tail tip pointing backwards (−z), curling up slightly.
  const tip = new THREE.ConeGeometry(0.19, 0.42, 8);
  parts.push(part(tip, DINO_GREEN, M(0, 0.25, -0.26, -Math.PI / 2 - 0.15, 0, 0, 1, 0.85, 1), dinoShade));
  parts.push(part(finGeometry(0.1), DINO_PLATE, M(0, 0.38, 0.02)));
  return merge(parts);
}

function appleGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.15, 12, 9);
  // Dimpled top, a lighter cheek facing the camera (+z) and the sun.
  const pos = body.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const top = Math.max(0, v.y / 0.15);
    const r = Math.hypot(v.x, v.z) / 0.15;
    v.y -= 0.05 * top ** 6 * (1 - r) * 3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  body.computeVertexNormals();
  parts.push(
    part(body, "#d32f27", M(0, 0.145, 0, 0, 0, 0, 1, 0.92, 1), (p, c) =>
      p.z > 0.04 && p.y > 0.12 ? c.lerp(new THREE.Color("#ff6a4d"), 0.45) : c.multiplyScalar(0.85 + 0.15 * (p.y / 0.28)),
    ),
  );
  parts.push(part(new THREE.CylinderGeometry(0.012, 0.016, 0.09, 5), "#6b4220", M(0.01, 0.3, 0, 0, 0, -0.25)));
  parts.push(part(new THREE.SphereGeometry(0.05, 6, 4), "#4f9d2c", M(0.06, 0.32, 0, 0, 0.3, -0.5, 1.5, 0.3, 0.75)));
  return merge(parts);
}

// ---------- the kit ----------

const VARIANTS = 3;

/**
 * Creates the shared geometry/material cache. `build*` functions return
 * ready-to-add Object3Ds; `release(obj)` frees per-instance resources
 * (wheat materials); `dispose()` frees everything the kit created.
 */
export function createModelKit() {
  const geos = new Map();
  const disposables = [];
  const own = (x) => {
    if (x) disposables.push(x);
    return x;
  };
  const geo = (key, make) => {
    if (!geos.has(key)) geos.set(key, make());
    return geos.get(key);
  };

  const flat = own(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 }));
  const wheatBase = own(
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, color: "#efc985" }),
  );

  const textures = {
    soil: own(soilTexture()),
    grass: own(grassTexture()),
    water: own(waterTexture()),
    slab: own(plankTexture()),
    blob: own(blobShadowTexture()),
  };

  const tileSide = own(new THREE.MeshStandardMaterial({ color: "#54394a", roughness: 0.95 }));
  const tileMats = {
    Soil: own(new THREE.MeshStandardMaterial({ color: textures.soil ? "#ffffff" : "#675659", map: textures.soil, roughness: 0.95 })),
    Grassland: own(new THREE.MeshStandardMaterial({ color: textures.grass ? "#ffffff" : "#6fa58a", map: textures.grass, roughness: 0.95 })),
  };
  // Box face order: +x, −x, +y (top), −y, +z, −z.
  const tileMaterials = {
    Soil: [tileSide, tileSide, tileMats.Soil, tileSide, tileSide, tileSide],
    Grassland: [tileSide, tileSide, tileMats.Grassland, tileSide, tileSide, tileSide],
  };
  const TILE_H = 0.16;
  const tileGeo = own(new THREE.BoxGeometry(0.93, TILE_H, 0.93));
  tileGeo.translate(0, -TILE_H / 2, 0);

  const waterGeo = own(new THREE.PlaneGeometry(0.9, 0.9));
  waterGeo.rotateX(-Math.PI / 2);
  const waterMats = [null];
  for (let i = 1; i <= 10; i++) {
    waterMats.push(
      own(
        new THREE.MeshStandardMaterial({
          color: "#2aa5b5",
          emissive: "#0b4a58",
          map: textures.water,
          transparent: true,
          opacity: 0.2 + 0.045 * i,
          roughness: 0.2,
          metalness: 0,
          depthWrite: false,
        }),
      ),
    );
  }

  const meshOf = (g, mat, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  };

  /** Model for an entity. `variant` picks one of a few seeded shape variants. */
  function buildEntity(e, variant = 0) {
    const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
    const grown = e.progress >= 1;
    let obj;
    switch (e.type) {
      case "Grass": {
        const mat = wheatBase.clone();
        obj = meshOf(
          geo(`wheat${v}`, () => wheatGeometry(101 + v)),
          mat,
        );
        obj.userData.wheatMaterial = mat;
        break;
      }
      case "Rice": {
        const mat = wheatBase.clone();
        obj = meshOf(geo(`rice${v}`, () => riceGeometry(701 + v)), mat);
        obj.userData.wheatMaterial = mat;
        break;
      }
      case "Dead_Rice":
        obj = meshOf(geo(`riceDead${v}`, () => riceGeometry(751 + v, true)), flat);
        break;
      case "Bush":
        obj = meshOf(geo(`bush${v}${grown}`, () => bushGeometry(201 + v, grown)), flat);
        break;
      case "Tree":
        obj = meshOf(geo(`tree${v}`, () => treeGeometry(301 + v)), flat);
        break;
      case "Carrot":
        obj = meshOf(geo(`carrot${v}${grown}`, () => carrotGeometry(401 + v, grown)), flat);
        break;
      case "Pumpkin":
        obj = meshOf(geo("pumpkin", () => pumpkinGeometry(false)), flat);
        obj.rotation.y = v * 0.7;
        break;
      case "Dead_Pumpkin": {
        const g = new THREE.Group();
        const m = meshOf(geo("pumpkinDead", () => pumpkinGeometry(true)), flat);
        m.scale.set(0.72, 0.5, 0.72);
        m.rotation.z = 0.32;
        m.position.y = 0.02;
        g.add(m);
        obj = g;
        break;
      }
      case "Sunflower":
        obj = meshOf(geo(`sunflower${v}`, () => sunflowerGeometry(501 + v)), flat);
        obj.rotation.y = (v - 1) * 0.25; // heads stay facing the camera
        break;
      case "Cactus": {
        const size = e.size ?? 0;
        obj = meshOf(geo(`cactus${size}${grown}`, () => cactusGeometry(size, grown)), flat);
        obj.rotation.y = v * 2.1;
        break;
      }
      case "Hedge":
        obj = meshOf(geo(`hedge${v}`, () => hedgeGeometry(601 + v)), flat);
        break;
      case "Treasure":
        obj = meshOf(geo("treasure", () => treasureGeometry()), flat);
        obj.rotation.y = -0.18; // a slight turn so the lid and lock both read
        break;
      case "Apple":
        obj = meshOf(geo("apple", () => appleGeometry()), flat);
        obj.rotation.y = v * 1.3;
        break;
      case "Dinosaur":
        // The scene draws the dinosaur as one animated chain (buildDinoSegment);
        // a lone segment model is still available for generic callers.
        obj = meshOf(dinoGeo("body"), flat);
        break;
      default:
        return null;
    }
    // Wrap so growth scale and the pop never fight the model's own transform.
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.userData.type = e.type;
    wrap.userData.wheatMaterial = obj.userData.wheatMaterial || null;
    return wrap;
  }

  const DINO_PARTS = ["head", "body", "legs", "tail"];
  const dinoGeo = (p) =>
    geo(`dino-${p}`, () =>
      p === "head" ? dinoHeadGeometry() : p === "tail" ? dinoTailGeometry() : dinoBodyGeometry(p === "legs"),
    );

  /**
   * One dinosaur segment, `part` = "head" | "body" | "legs" (body with feet) | "tail".
   * Front (+z) points at the segment ahead; the scene sets position/yaw/scale.
   */
  function buildDinoSegment(p) {
    const m = meshOf(dinoGeo(DINO_PARTS.includes(p) ? p : "body"), flat);
    const wrap = new THREE.Group();
    wrap.add(m);
    wrap.userData.type = "Dinosaur";
    wrap.userData.part = p;
    return wrap;
  }
  /** Swap a segment's shape in place (e.g. the old tail becomes body after a meal). */
  function setDinoPart(obj, p) {
    if (obj.userData.part === p) return;
    obj.userData.part = p;
    obj.children[0].geometry = dinoGeo(DINO_PARTS.includes(p) ? p : "body");
  }

  /** One pumpkin spanning a k×k group of tiles. */
  function buildGiantPumpkin(k) {
    const wrap = new THREE.Group();
    const m = meshOf(geo("pumpkin", () => pumpkinGeometry(false)), flat);
    const s = k * 1.07;
    m.scale.set(s, s * 0.9, s);
    m.rotation.y = 0.3;
    wrap.add(m);
    return wrap;
  }

  function buildTile(ground) {
    const m = new THREE.Mesh(tileGeo, tileMaterials[ground] || tileMaterials.Grassland);
    m.receiveShadow = true;
    return m;
  }
  const setTileGround = (mesh, ground) => {
    mesh.material = tileMaterials[ground] || tileMaterials.Grassland;
  };

  function buildWater() {
    const m = new THREE.Mesh(waterGeo, waterMats[5]);
    m.position.y = 0.01;
    m.receiveShadow = true;
    m.renderOrder = 1;
    return m;
  }
  const setWater = (mesh, level) => {
    mesh.visible = level > 0;
    if (level > 0) mesh.material = waterMats[Math.min(10, level)];
  };

  /** The raised planter box around an n×n board: plank sides, a pale rim and brass-capped corner posts. */
  function buildSlab(n) {
    const g = new THREE.Group();
    const thick = Math.min(0.62, 0.3 + 0.045 * n); // shallower for tiny farms
    const side = n + 0.16;
    const slabGeo = new THREE.BoxGeometry(side, thick, side);
    slabGeo.translate(0, -0.1 - thick / 2, 0);
    let sideMat;
    if (textures.slab) {
      const tex = textures.slab.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(side / 1.2)), 1);
      sideMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      sideMat.userData.ownMap = tex;
    } else {
      sideMat = new THREE.MeshStandardMaterial({ color: "#714b60", roughness: 0.85 });
    }
    const topMat = new THREE.MeshStandardMaterial({ color: "#33232f", roughness: 1 });
    const slab = new THREE.Mesh(slabGeo, [sideMat, sideMat, topMat, topMat, sideMat, sideMat]);
    slab.receiveShadow = true;
    slab.castShadow = true;
    g.add(slab);

    const parts = [];
    const rim = 0.1;
    const edge = side / 2 + rim / 2 - 0.02;
    for (const s of [-1, 1]) {
      parts.push(part(new THREE.BoxGeometry(side + rim * 2, 0.1, rim), "#e9cfb2", M(0, -0.06, s * edge)));
      parts.push(part(new THREE.BoxGeometry(rim, 0.1, side + rim * 2), "#e9cfb2", M(s * edge, -0.06, 0)));
    }
    const post = Math.min(0.24, 0.1 + 0.018 * n); // slimmer on tiny farms
    const postH = thick + 0.16;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(part(new THREE.BoxGeometry(post, postH, post), "#54394a", M(sx * edge, 0.06 - postH / 2, sz * edge)));
        parts.push(part(new THREE.BoxGeometry(post * 1.15, 0.05, post * 1.15), "#f0b03f", M(sx * edge, 0.08, sz * edge)));
      }
    }
    const frameGeo = merge(parts);
    const frame = meshOf(frameGeo, flat);
    g.add(frame);
    g.userData.disposables = [slabGeo, sideMat, topMat, frameGeo, sideMat.userData.ownMap];
    return g;
  }

  /**
   * The field bot: a boxy over-the-row robot. Four long legs on wheels carry
   * the body high above the tile, so it straddles whatever grows there. One
   * round lens, a tilted solar roof, a seed probe underneath, and a mast with
   * the status light. Wheels stand on y = 0, the front is +z.
   * band: the identity stripe around the body (see droneBands.js).
   */
  function buildBot(band = DRONE_BAND_0) {
    const root = new THREE.Group(); // positioned on the board
    const yaw = new THREE.Group(); // faces the direction of travel
    const spin = new THREE.Group(); // spin_in_place()
    root.add(yaw);
    yaw.add(spin);

    const SHELL = "#f6ead6";
    const FRAME = "#3a2c44";
    const BRASS = "#f0b03f";
    const makeBody = () => {
      const parts = [];
      const box = (w, h, d, color, m) => parts.push(part(new THREE.BoxGeometry(w, h, d), color, m));
      // Body: two stacked boxes with the identity stripe between them.
      box(0.44, 0.13, 0.4, SHELL, M(0, 0.63, 0));
      box(0.465, 0.07, 0.425, band, M(0, 0.73, 0));
      box(0.4, 0.09, 0.36, SHELL, M(0, 0.805, 0));
      // One big lens on a dark plate, plus a small speaker grille.
      box(0.2, 0.15, 0.02, FRAME, M(-0.07, 0.65, 0.206));
      const lens = new THREE.CylinderGeometry(0.055, 0.062, 0.05, 14);
      lens.rotateX(Math.PI / 2);
      parts.push(part(lens, "#7fe3ea", M(-0.07, 0.65, 0.225)));
      const pupil = new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10);
      pupil.rotateX(Math.PI / 2);
      parts.push(part(pupil, "#16353d", M(-0.07, 0.65, 0.25)));
      for (let i = 0; i < 3; i++) box(0.08, 0.012, 0.012, FRAME, M(0.12, 0.62 + i * 0.028, 0.204));
      // Solar roof: a tilted panel, frame + 3×2 cells.
      const roof = M(0, 0.9, -0.01, 0.3, 0, 0);
      box(0.56, 0.03, 0.42, FRAME, roof);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          box(0.16, 0.012, 0.18, (i + j) % 2 ? "#2b5f9e" : "#3674b5", roof.clone().multiply(M((i - 1) * 0.176, 0.018, (j - 0.5) * 0.196)));
        }
      }
      // Status mast at the back corner (the light itself is a separate mesh).
      const mast = new THREE.CylinderGeometry(0.012, 0.016, 0.3, 6);
      parts.push(part(mast, FRAME, M(0.21, 0.95, -0.17)));
      // Legs, axle bars and the seed probe under the belly.
      for (const x of [-0.27, 0.27]) {
        box(0.06, 0.05, 0.62, FRAME, M(x, 0.575, 0));
        for (const z of [-0.28, 0.28]) {
          box(0.045, 0.46, 0.05, SHELL, M(x, 0.34, z));
          box(0.06, 0.06, 0.07, BRASS, M(x, 0.13, z));
        }
      }
      const probe = new THREE.CylinderGeometry(0.035, 0.02, 0.1, 8);
      parts.push(part(probe, BRASS, M(0, 0.52, 0.04)));
      const tip = new THREE.ConeGeometry(0.022, 0.07, 8);
      tip.rotateX(Math.PI);
      parts.push(part(tip, FRAME, M(0, 0.44, 0.04)));
      return merge(parts);
    };
    const body = meshOf(geo(band === DRONE_BAND_0 ? "botBody" : `botBody:${band}`, makeBody), flat, { cast: false, receive: false });
    spin.add(body);

    const wheelGeo = geo("botWheel", () => {
      const tyre = new THREE.CylinderGeometry(0.085, 0.085, 0.07, 10);
      const hub = new THREE.BoxGeometry(0.06, 0.078, 0.06);
      const g = merge([part(tyre, "#2a2130"), part(hub, BRASS)]);
      g.rotateZ(Math.PI / 2);
      return g;
    });
    const wheels = [];
    for (const x of [-0.27, 0.27]) {
      for (const z of [-0.28, 0.28]) {
        const w = meshOf(wheelGeo, flat, { cast: false, receive: false });
        w.position.set(x, 0.085, z);
        spin.add(w);
        wheels.push(w);
      }
    }

    const lightMat = new THREE.MeshBasicMaterial({ color: statusLight("idle"), toneMapped: false });
    const light = new THREE.Mesh(
      geo("botLight", () => new THREE.SphereGeometry(0.055, 12, 8)),
      lightMat,
    );
    light.position.set(0.21, 1.13, -0.17);
    light.userData.disposables = [lightMat];
    spin.add(light);
    const setStatus = (status) => lightMat.color.set(statusLight(status));

    const shadowMat = new THREE.MeshBasicMaterial({
      map: textures.blob,
      color: textures.blob ? "#ffffff" : "#000000",
      transparent: true,
      opacity: textures.blob ? 0.9 : 0.25,
      depthWrite: false,
    });
    const shadowGeo = geo("blobPlane", () => {
      const p = new THREE.PlaneGeometry(0.7, 0.7);
      p.rotateX(-Math.PI / 2);
      return p;
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 2;
    shadow.userData.disposables = [shadowMat];

    return { root, yaw, spin, wheels, light, setStatus, shadow };
  }

  /** Free per-instance resources of an object built by this kit. */
  function release(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.userData.wheatMaterial) o.userData.wheatMaterial.dispose();
      if (o.userData.disposables) o.userData.disposables.forEach((d) => d && d.dispose());
    });
  }

  function dispose() {
    for (const g of geos.values()) g.dispose();
    geos.clear();
    disposables.forEach((d) => d.dispose());
    disposables.length = 0;
  }

  return {
    buildEntity,
    buildGiantPumpkin,
    buildDinoSegment,
    setDinoPart,
    buildTile,
    setTileGround,
    buildWater,
    setWater,
    buildSlab,
    buildBot,
    release,
    dispose,
    stats: () => ({ geometries: geos.size }),
    _geometryCache: geos,
  };
}

export { DRONE_BAND_0, DRONE_BANDS, droneBand, statusLight } from "../droneBands.js";

/** Triangle count of an object tree (for the perf budget test). */
export function countTriangles(obj) {
  let tris = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const n = g.index ? g.index.count : g.attributes.position.count;
    tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return tris;
}
