// Farm models built only from three.js primitives and code-made meshes.
//
// Every static model (wheat patch, rice paddy, bush, tree, carrots, pumpkin, sunflower,
// cactus) is ONE merged, vertex-coloured geometry, so a model costs one draw call.
// Geometries are cached per variant and shared by every tile that shows that model;
// the kit owns and disposes them. Crops live in crops.js, the bot in bot.js, tiles
// and the planter box in planter.js, the canvas textures in textures.js.
// (BRIEF22 removed the maze hedge, treasure chest, apple and dinosaur set pieces.)
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
import { rng } from "./geom.js";
import { frameGeometry, planksGeometry, planterSize, slabGeometry, tileGeometry } from "./planter.js";
import { blobShadowTexture, grainTexture, grassTexture, plankTexture, soilTexture, waterTexture } from "./textures.js";

export { rng };

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
