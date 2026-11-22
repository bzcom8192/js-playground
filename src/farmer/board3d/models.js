// Farm models built only from three.js primitives and code-made meshes.
//
// Every static model (wheat patch, rice paddy, bush, tree, carrots, pumpkin, sunflower,
// cactus, maze hedge, treasure chest, apple, dinosaur segment) is ONE merged,
// vertex-coloured geometry, so a model costs one draw call. Geometries are cached
// per variant and shared by every tile that shows that model; the kit owns
// and disposes them. Crops live in crops.js, the bot in bot.js, tiles and the
// planter box in planter.js, the canvas textures in textures.js.
import * as THREE from "three";
import { DRONE_BAND_0, statusLight } from "../droneBands.js";
import { botBodyGeometry, botWheelGeometry, BOT_PARTS, LIGHT_POS, WHEEL_PARTS } from "./bot.js";
import {
  bushGeometry,
  cactusGeometry,
  carrotGeometry,
  pumpkinGeometry,
  riceGeometry,
  sunflowerGeometry,
  treeGeometry,
  wheatGeometry,
} from "./crops.js";
import { M, merge, part, rng } from "./geom.js";
import { frameGeometry, planksGeometry, planterSize, slabGeometry, tileGeometry } from "./planter.js";
import { blobShadowTexture, grainTexture, grassTexture, plankTexture, soilTexture, waterTexture } from "./textures.js";

export { rng };

// ---------- set pieces (flat-shaded) ----------

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
// Crops first, then the tiles under them, then the box under those: the depth
// test then skips shading ground that a plant or a tile already covers.
const GROUND_ORDER = 1;
const SLAB_ORDER = 2;

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

  // Set pieces (hedge, chest, apple, dinosaur) stay flat-shaded.
  const flat = own(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 }));
  // Matte surfaces (leaves, stalks, soil, wood) are Lambert: they have no highlight
  // to lose, and the cheaper shader pays for the extra geometry.
  const leafy = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  // Crops made mostly of single-sheet leaves and stalks.
  const blades = own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  // Pumpkins and cacti get a soft waxy highlight.
  const rind = own(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 22, specular: "#33261f" }));
  const wheatBase = own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, color: "#efc985" }));
  const trim = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  // The bot: painted metal, bare metal, rubber, glass.
  const botMats = {
    paint: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 })),
    metal: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.4 })),
    rubber: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })),
    glass: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.2 })),
  };
  const bodyMats = BOT_PARTS.map((k) => botMats[k]);
  const wheelMats = WHEEL_PARTS.map((k) => botMats[k]);

  const textures = {
    soil: [0, 1].map((v) => own(soilTexture(v))),
    grass: [0, 1].map((v) => own(grassTexture(v))),
    water: own(waterTexture()),
    slab: own(plankTexture()),
    grain: own(grainTexture()),
    blob: own(blobShadowTexture()),
  };

  const tileSide = own(new THREE.MeshLambertMaterial({ color: "#54394a" }));
  const topMat = (map, color) => own(new THREE.MeshLambertMaterial({ color: map ? "#ffffff" : color, map }));
  // Per ground, two variants of { geometry, [side, top] materials }.
  const tiles = {
    Soil: textures.soil.map((map) => ({ geo: () => geo("tileSoil", () => tileGeometry("Soil")), mats: [tileSide, topMat(map, "#675659")] })),
    Grassland: textures.grass.map((map, v) => ({
      geo: () => geo(`tileGrass${v}`, () => tileGeometry("Grassland", v)),
      mats: [tileSide, topMat(map, "#6fa58a")],
    })),
  };
  const tileLook = (ground, variant) => (tiles[ground] || tiles.Grassland)[Math.abs(variant) % 2];

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
        obj = meshOf(geo(`riceDead${v}`, () => riceGeometry(751 + v, true)), blades);
        break;
      case "Bush":
        obj = meshOf(geo(`bush${v}${grown}`, () => bushGeometry(201 + v, grown)), leafy);
        break;
      case "Tree":
        obj = meshOf(geo(`tree${v}`, () => treeGeometry(301 + v)), leafy);
        break;
      case "Carrot":
        obj = meshOf(geo(`carrot${v}${grown}`, () => carrotGeometry(401 + v, grown)), blades);
        break;
      case "Pumpkin":
        obj = meshOf(geo("pumpkin", () => pumpkinGeometry(false)), rind);
        obj.rotation.y = v * 0.7;
        break;
      case "Dead_Pumpkin": {
        const g = new THREE.Group();
        const m = meshOf(geo("pumpkinDead", () => pumpkinGeometry(true)), rind);
        m.scale.set(0.72, 0.5, 0.72);
        m.rotation.z = 0.32;
        m.position.y = 0.02;
        g.add(m);
        obj = g;
        break;
      }
      case "Sunflower":
        obj = meshOf(geo(`sunflower${v}`, () => sunflowerGeometry(501 + v)), blades);
        obj.rotation.y = (v - 1) * 0.25; // heads stay facing the camera
        break;
      case "Cactus": {
        const size = e.size ?? 0;
        obj = meshOf(geo(`cactus${size}${grown}`, () => cactusGeometry(size, grown)), rind);
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

  /** One pumpkin spanning a k×k group of tiles (a finer mesh, shared by all giants). */
  function buildGiantPumpkin(k) {
    const wrap = new THREE.Group();
    const m = meshOf(geo("pumpkinGiant", () => pumpkinGeometry(false, true)), rind);
    const s = k * 1.07;
    m.scale.set(s, s * 0.9, s);
    m.rotation.y = 0.3;
    wrap.add(m);
    return wrap;
  }

  function buildTile(ground, variant = 0) {
    const look = tileLook(ground, variant);
    const m = new THREE.Mesh(look.geo(), look.mats);
    m.receiveShadow = true;
    m.renderOrder = GROUND_ORDER;
    return m;
  }
  const setTileGround = (mesh, ground, variant = 0) => {
    const look = tileLook(ground, variant);
    mesh.geometry = look.geo();
    mesh.material = look.mats;
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

  /** The raised planter box around an n×n board: planked front, stepped pale rim, brass-capped corner posts. */
  function buildSlab(n) {
    const g = new THREE.Group();
    const { side } = planterSize(n);
    const slabGeo = slabGeometry(n);
    let sideMat;
    if (textures.slab) {
      const tex = textures.slab.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(side / 1.2)), 1);
      sideMat = new THREE.MeshLambertMaterial({ map: tex });
      sideMat.userData.ownMap = tex;
    } else {
      sideMat = new THREE.MeshLambertMaterial({ color: "#714b60" });
    }
    const topMat = new THREE.MeshLambertMaterial({ color: "#33232f" });
    const slab = new THREE.Mesh(slabGeo, [sideMat, topMat]);
    slab.receiveShadow = true;
    slab.castShadow = true;
    slab.renderOrder = SLAB_ORDER;
    g.add(slab);

    const plankGeo = planksGeometry(n);
    const plankMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: textures.grain });
    g.add(meshOf(plankGeo, plankMat, { cast: false }));

    const frameGeo = frameGeometry(n);
    g.add(meshOf(frameGeo, trim));
    g.userData.disposables = [slabGeo, sideMat, topMat, plankGeo, plankMat, frameGeo, sideMat.userData.ownMap];
    return g;
  }

  /**
   * The field bot (geometry and design notes in bot.js).
   * band: the identity stripe around the body (see droneBands.js).
   */
  function buildBot(band = DRONE_BAND_0) {
    const root = new THREE.Group(); // positioned on the board
    const yaw = new THREE.Group(); // faces the direction of travel
    const spin = new THREE.Group(); // spin_in_place()
    root.add(yaw);
    yaw.add(spin);

    const bodyGeo = geo(band === DRONE_BAND_0 ? "botBody" : `botBody:${band}`, () => botBodyGeometry(band));
    spin.add(meshOf(bodyGeo, bodyMats, { cast: false, receive: false }));

    const wheelGeo = geo("botWheel", botWheelGeometry);
    const wheels = [];
    for (const x of [-0.27, 0.27]) {
      for (const z of [-0.28, 0.28]) {
        const w = meshOf(wheelGeo, wheelMats, { cast: false, receive: false });
        w.position.set(x, 0.085, z);
        spin.add(w);
        wheels.push(w);
      }
    }

    const lightMat = new THREE.MeshBasicMaterial({ color: statusLight("idle"), toneMapped: false });
    const light = new THREE.Mesh(
      geo("botLight", () => new THREE.SphereGeometry(0.055, 20, 14)),
      lightMat,
    );
    light.position.set(...LIGHT_POS);
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
