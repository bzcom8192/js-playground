// Low-poly farm models built only from three.js primitives.
//
// Every static model (wheat patch, bush, tree, carrots, pumpkin, sunflower,
// cactus, maze hedge, treasure chest, apple, dinosaur segment) is ONE merged, vertex-coloured geometry drawn with a shared
// flat-shaded material, so a model costs one draw call. Geometries are cached
// per variant and shared by every tile that shows that model; the kit owns
// and disposes them. The only textures are small canvas ones (soil rows,
// grass speckles, water ripples, slab strata, the drone's blob shadow).
import * as THREE from "three";
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
  ctx.fillStyle = "rgba(255,235,200,.18)";
  ctx.fillRect(0, 0, s, b);
  ctx.fillRect(0, 0, b, s);
  ctx.fillStyle = "rgba(30,15,0,.28)";
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
    ctx.fillStyle = "#a2652a";
    ctx.fillRect(0, 0, s, s);
    // Plough rows (East–West): a dark furrow and a light ridge, 4 per tile.
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const y = (i + 0.5) * (s / rows);
      ctx.fillStyle = "rgba(70,35,8,.42)";
      ctx.fillRect(0, y - 4, s, 7);
      ctx.fillStyle = "rgba(255,200,130,.16)";
      ctx.fillRect(0, y + 5, s, 4);
    }
    speckle(ctx, s, ["rgba(60,30,5,.35)", "rgba(255,210,150,.18)"], 220, 11);
    bevel(ctx, s);
  });

const grassTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = "#74a23c";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, ["#5f8c2e", "#86b449", "#6a9935", "#93be55"], 900, 23, 3);
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

const slabTexture = () =>
  canvasTexture(
    128,
    (ctx, s) => {
      // Strata: dark topsoil band, warm earth, a darker plank-like line, deep dirt.
      const bands = [
        [0, 0.16, "#5a361a"],
        [0.16, 0.55, "#b8702f"],
        [0.55, 0.6, "#8a5021"],
        [0.6, 1, "#9c5a26"],
      ];
      for (const [a, b, c] of bands) {
        ctx.fillStyle = c;
        ctx.fillRect(0, a * s, s, (b - a) * s + 1);
      }
      ctx.fillStyle = "rgba(60,30,8,.35)";
      for (let x = 0; x < s; x += s / 2) ctx.fillRect(x, 0.16 * s, 2, 0.84 * s); // plank seams
      speckle(ctx, s, ["rgba(60,30,5,.3)", "rgba(255,210,150,.15)"], 260, 31);
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

function bushGeometry(seed, grown) {
  const r = rng(seed);
  const parts = [];
  const blobs = [
    [-0.13, 0.17, 0.06, 0.2, "#4d8a2b"],
    [0.13, 0.19, -0.05, 0.22, "#5a9a32"],
    [0.0, 0.31, 0.04, 0.18, "#68aa3b"],
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
          "#7b3fa0",
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
  parts.push(part(trunk, "#6e4524"));
  const canopy = [
    [0, 0.68, 0, 0.32, "#4f8f2a"],
    [0.18, 0.55, 0.1, 0.22, "#5fa034"],
    [-0.14, 0.88, -0.04, 0.24, "#478225"],
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
      parts.push(part(shoulder, "#e8761e", M(x, 0.03, z)));
    }
    const leaves = 5;
    for (let k = 0; k < leaves; k++) {
      const a = (k / leaves) * Math.PI * 2 + r();
      const leaf = new THREE.ConeGeometry(0.036, 0.3, 4);
      leaf.translate(0, 0.15, 0);
      const tilt = 0.35 + r() * 0.3;
      parts.push(part(leaf, k % 2 ? "#4c9a2a" : "#5cae34", M(x, 0.04, z, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)));
    }
    if (grown && i % 2 === 0) {
      parts.push(part(new THREE.IcosahedronGeometry(0.035, 0), "#9b5bc4", M(x + 0.03, 0.27, z)));
    }
  });
  return merge(parts);
}

function pumpkinGeometry(dead) {
  const parts = [];
  const body = ribbedSphere(0.4, { lobes: 10, w: 30, h: 12, squash: 0.66, dimple: 0.45 });
  body.translate(0, 0.4 * 0.66 * 0.92, 0);
  parts.push(part(body, "#fff", null, dead ? ribShade(10, "#6f695e", "#9a9384") : ribShade(10, "#d97a1c", "#f6b24c")));
  const stem = new THREE.CylinderGeometry(0.025, 0.045, 0.14, 5);
  stem.translate(0, 0.07, 0);
  parts.push(part(stem, dead ? "#5b5546" : "#6b6e24", M(0, 0.36, 0, 0.25, 0, 0.15)));
  return merge(parts);
}

function sunflowerGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.018, 0.026, 0.62, 5);
  stem.translate(0, 0.31, 0);
  parts.push(part(stem, "#4f8a24"));
  for (const [y, a] of [
    [0.22, 0.4],
    [0.36, 0.4 + Math.PI],
  ]) {
    const leaf = new THREE.IcosahedronGeometry(0.1, 0);
    leaf.scale(1.4, 0.22, 0.65);
    leaf.translate(0.13, 0, 0);
    parts.push(part(leaf, "#5f9e2c", M(0, y, 0, 0, a + r() * 0.3, 0.3)));
  }
  // Head: petals + seed disc, built facing +y then tilted toward the camera (+z).
  const head = [];
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const petal = new THREE.BoxGeometry(0.07, 0.018, 0.13);
    petal.translate(0, 0, 0.14);
    head.push(part(petal, i % 2 ? "#f7c51e" : "#f2b318", M(0, 0, 0, 0, a, 0)));
  }
  const disc = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10);
  head.push(part(disc, "#6b3d16", M(0, 0.012, 0)));
  const headGeo = merge(head);
  headGeo.applyMatrix4(M(0, 0.64, 0.02, 0.75, 0, 0));
  parts.push(headGeo);
  return merge(parts);
}

function cactusGeometry(size, grown) {
  const parts = [];
  const h = 0.26 + (size || 0) * 0.035;
  const green = "#4f9b46";
  const rib = "#8fcf7d";
  const segs = 2 + (size >= 5 ? 1 : 0);
  // Main column: stacked capsule segments with lighter vertical ribs.
  for (let s = 0; s < segs; s++) {
    const sh = h / segs;
    const seg = new THREE.CapsuleGeometry(0.1 - s * 0.008, sh * 0.6, 2, 8);
    parts.push(part(seg, s % 2 ? "#57a64d" : green, M(0, sh * (s + 0.5) + 0.04, 0)));
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
    parts.push(part(new THREE.IcosahedronGeometry(0.055, 0), "#ff7eb6", M(0, h + 0.13, 0, 0, 0, 0, 1, 0.6, 1)));
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
  parts.push(part(body, "#2f6a24", null, shadeByHeight));
  // Leafy clumps on the top break up the perfect box a little.
  const greens = ["#2a5f20", "#367a2a", "#3f852f", "#2c6522"];
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

const DINO_GREEN = "#58ab3d";
const DINO_DARK = "#2f6e22";
const DINO_BELLY = "#cfe39a";
const DINO_PLATE = "#eea43a";

/** Darker underneath, a pale belly band low down. */
const dinoShade = (p, c) => {
  if (p.y < 0.17) return c.lerp(new THREE.Color(DINO_BELLY), 0.55);
  return c.multiplyScalar(0.78 + 0.22 * Math.min(1, p.y / 0.45));
};

function dinoHeadGeometry() {
  const parts = [];
  const skull = new THREE.SphereGeometry(0.26, 10, 8);
  parts.push(part(skull, DINO_GREEN, M(0, 0.31, -0.03, 0, 0, 0, 1, 0.86, 1.08), dinoShade));
  // Snout + lower jaw, pushed forward.
  parts.push(part(new THREE.BoxGeometry(0.3, 0.18, 0.28, 1, 1, 1), "#66bb48", M(0, 0.28, 0.22)));
  parts.push(part(new THREE.BoxGeometry(0.26, 0.07, 0.26), DINO_BELLY, M(0, 0.17, 0.21)));
  // A little smile line and nostrils.
  parts.push(part(new THREE.BoxGeometry(0.27, 0.018, 0.02), "#24521a", M(0, 0.205, 0.347)));
  for (const x of [-0.07, 0.07]) {
    parts.push(part(new THREE.BoxGeometry(0.035, 0.02, 0.03), "#24521a", M(x, 0.37, 0.34)));
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
    parts.push(part(new THREE.ConeGeometry(0.055, h, 4), DINO_PLATE, M(0, 0.54 + h / 2 - 0.03 + z * 0.4, z)));
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
    parts.push(part(new THREE.ConeGeometry(0.06, h, 4), DINO_PLATE, M(0, y + h / 2 - 0.02, z)));
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
  parts.push(part(new THREE.ConeGeometry(0.05, 0.1, 4), DINO_PLATE, M(0, 0.43, 0.02)));
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
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, color: "#e3ac3e" }),
  );

  const textures = {
    soil: own(soilTexture()),
    grass: own(grassTexture()),
    water: own(waterTexture()),
    slab: own(slabTexture()),
    blob: own(blobShadowTexture()),
  };

  const tileSide = own(new THREE.MeshStandardMaterial({ color: "#7a4a22", roughness: 0.95 }));
  const tileMats = {
    Soil: own(new THREE.MeshStandardMaterial({ color: textures.soil ? "#ffffff" : "#a2652a", map: textures.soil, roughness: 0.95 })),
    Grassland: own(new THREE.MeshStandardMaterial({ color: textures.grass ? "#ffffff" : "#74a23c", map: textures.grass, roughness: 0.95 })),
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
          color: "#2f86d8",
          emissive: "#0c3a78",
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

  /** The thick earth slab under an n×n board, with rocks along its base. */
  function buildSlab(n) {
    const g = new THREE.Group();
    const thick = Math.min(0.62, 0.3 + 0.045 * n); // thinner under tiny farms
    const side = n + 0.16;
    const slabGeo = new THREE.BoxGeometry(side, thick, side);
    slabGeo.translate(0, -0.1 - thick / 2, 0);
    let sideMat;
    if (textures.slab) {
      const tex = textures.slab.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(side / 1.2)), 1);
      sideMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      sideMat.userData.ownMap = tex;
    } else {
      sideMat = new THREE.MeshStandardMaterial({ color: "#a8622a", roughness: 0.95 });
    }
    const topMat = new THREE.MeshStandardMaterial({ color: "#4a2e14", roughness: 1 });
    const slab = new THREE.Mesh(slabGeo, [sideMat, sideMat, topMat, topMat, sideMat, sideMat]);
    slab.receiveShadow = true;
    slab.castShadow = true;
    g.add(slab);

    // Grey rocks poking out along the bottom edge.
    const rockGeo = new THREE.DodecahedronGeometry(0.07, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: "#8d8a86", flatShading: true, roughness: 0.9 });
    const r = rng(77 + n);
    const count = Math.max(4, Math.round(side * 2.2));
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, count * 2);
    let i = 0;
    for (let k = 0; k < count; k++) {
      const t = ((k + 0.5) / count - 0.5) * side;
      const y = -0.1 - thick + 0.04 + r() * 0.05;
      const sc = (0.6 + r() * 0.8) * Math.min(1, 0.45 + 0.08 * n);
      rocks.setMatrixAt(i++, M(t, y, side / 2 + 0.01, r() * 3, r() * 3, r() * 3, sc, sc * 0.7, sc));
      rocks.setMatrixAt(i++, M(side / 2 + 0.01, y, t, r() * 3, r() * 3, r() * 3, sc, sc * 0.7, sc));
    }
    rocks.castShadow = false;
    rocks.receiveShadow = true;
    g.add(rocks);
    g.userData.disposables = [slabGeo, sideMat, topMat, rockGeo, rockMat, sideMat.userData.ownMap, rocks];
    return g;
  }

  /** The pumpkin drone: ribbed body, straw hat, X arms with four rotors. */
  function buildDrone() {
    const root = new THREE.Group(); // positioned on the board
    const yaw = new THREE.Group(); // faces the movement direction
    const flip = new THREE.Group(); // do_a_flip()
    root.add(yaw);
    yaw.add(flip);

    const parts = [];
    const body = ribbedSphere(0.2, { lobes: 8, w: 20, h: 10, squash: 0.88, dimple: 0.15, rib: 0.08 });
    parts.push(part(body, "#fff", null, ribShade(8, "#d5701a", "#f7a83a")));
    for (const ex of [-0.07, 0.07]) {
      parts.push(part(new THREE.SphereGeometry(0.032, 6, 4), "#2e1c0c", M(ex, 0.06, 0.16)));
      parts.push(part(new THREE.SphereGeometry(0.011, 4, 3), "#ffffff", M(ex + 0.01, 0.075, 0.188)));
    }
    // Straw hat, pushed back on the head so the face shows from above.
    const hat = M(0, 0.15, -0.07, -0.45, 0, 0);
    const brim = new THREE.CylinderGeometry(0.24, 0.25, 0.022, 16);
    parts.push(part(brim, "#dcb35c", hat));
    const band = new THREE.CylinderGeometry(0.12, 0.125, 0.04, 12);
    parts.push(part(band, "#b5462b", hat.clone().multiply(M(0, 0.03, 0))));
    const crown = new THREE.ConeGeometry(0.125, 0.16, 12);
    parts.push(part(crown, "#ecc96f", hat.clone().multiply(M(0, 0.1, 0))));
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.BoxGeometry(0.78, 0.025, 0.035);
      parts.push(part(arm, "#4b4f55", M(0, 0.0, 0, 0, a, 0)));
    }
    const hubs = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const hx = Math.cos(a) * 0.37;
      const hz = Math.sin(a) * 0.37;
      hubs.push([hx, hz]);
      parts.push(part(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 6), "#35383d", M(hx, 0.03, hz)));
    }
    const bodyGeo = geo("droneBody", () => merge(parts.splice(0)));
    const bodyMesh = meshOf(bodyGeo, flat, { cast: false, receive: false });
    flip.add(bodyMesh);

    const bladeGeo = geo("droneBlade", () => {
      const b = part(new THREE.BoxGeometry(0.24, 0.008, 0.03), "#2f3237");
      return merge([b]);
    });
    const rotors = hubs.map(([hx, hz], k) => {
      const blade = meshOf(bladeGeo, flat, { cast: false, receive: false });
      blade.position.set(hx, 0.065, hz);
      blade.rotation.y = k * 0.8;
      flip.add(blade);
      return blade;
    });
    parts.forEach((p) => p.dispose());

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

    return { root, yaw, flip, rotors, shadow };
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
    buildDrone,
    release,
    dispose,
    stats: () => ({ geometries: geos.size }),
    _geometryCache: geos,
  };
}

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
