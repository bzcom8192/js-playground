// The field bot's geometry: a boxy over-the-row robot. Four long legs on
// wheels carry the body high above the tile, so it straddles whatever grows
// there. One round lens, a tilted solar roof, a seed probe underneath and a
// mast for the status light. Wheels stand on y = 0, the front is +z.
//
// Both geometries carry material groups, in the order of BOT_PARTS / WHEEL_PARTS,
// so paint, metal, rubber and glass each get their own roughness/metalness.
import * as THREE from "three";
import { M, merge, piece, rbox, tube } from "./geom.js";

const SHELL = "#f6ead6";
const FRAME = "#3a2c44";
const BRASS = "#f0b03f";
const CELL = "#2b5f9e";
const CELL_LIGHT = "#3674b5";
const BUSBAR = "#9fc4e6";

export const BOT_PARTS = ["paint", "metal", "glass"];
export const WHEEL_PARTS = ["rubber", "metal"];
export const WHEEL_RADIUS = 0.085;
/** Where the status light sits on top of its mast. */
export const LIGHT_POS = [0.21, 1.13, -0.17];

const shadeUp = (y0, y1) => (p, c) => c.multiplyScalar(0.86 + 0.16 * Math.max(0, Math.min(1, (p.y - y0) / (y1 - y0))));

export function botBodyGeometry(band) {
  const paint = [];
  const metal = [];
  const glass = [];
  const add = (list, geo, color, m, fn) => list.push(piece(geo, color, m, fn));
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r0, r1, h, n) => new THREE.CylinderGeometry(r0, r1, h, n);

  // Hull: a bevelled lower tub, the identity stripe, a bevelled lid.
  add(paint, rbox(0.44, 0.13, 0.4, 0.028), SHELL, M(0, 0.63, 0), shadeUp(-0.065, 0.065));
  add(paint, rbox(0.465, 0.07, 0.425, 0.016), band, M(0, 0.73, 0));
  add(paint, rbox(0.4, 0.09, 0.36, 0.028), SHELL, M(0, 0.805, 0));
  // Panel seams above and below the stripe, and bolts at the stripe's corners.
  for (const y of [0.693, 0.767]) add(metal, box(0.43, 0.008, 0.39), FRAME, M(0, y, 0));
  for (const x of [-0.2, 0.2]) {
    const bolt = cyl(0.011, 0.013, 0.012, 8);
    bolt.rotateX(Math.PI / 2);
    add(metal, bolt, BRASS, M(x, 0.73, 0.214));
  }

  // Face: lens in a brass bezel on a dark plate, speaker grille beside it.
  add(metal, box(0.2, 0.15, 0.024), FRAME, M(-0.07, 0.65, 0.206));
  const bezel = new THREE.TorusGeometry(0.062, 0.011, 5, 18);
  add(metal, bezel, BRASS, M(-0.07, 0.65, 0.224));
  const lens = new THREE.SphereGeometry(0.06, 16, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  lens.rotateX(Math.PI / 2);
  add(glass, lens, "#7fe3ea", M(-0.07, 0.65, 0.216, 0, 0, 0, 1, 1, 0.55));
  const pupil = cyl(0.026, 0.026, 0.012, 12);
  pupil.rotateX(Math.PI / 2);
  add(glass, pupil, "#16353d", M(-0.07, 0.65, 0.248));
  add(glass, new THREE.SphereGeometry(0.009, 6, 4), "#ffffff", M(-0.053, 0.668, 0.256));
  for (let i = 0; i < 3; i++) add(metal, box(0.08, 0.012, 0.014), FRAME, M(0.12, 0.62 + i * 0.028, 0.203));
  // Side service hatches and a little grab rail at the back.
  for (const s of [-1, 1]) {
    add(paint, box(0.014, 0.08, 0.2), "#e6d6be", M(s * 0.221, 0.63, -0.02));
    add(metal, box(0.012, 0.014, 0.05), FRAME, M(s * 0.23, 0.645, 0.04));
  }

  // Solar roof: tilted on two struts; tray, raised frame, glass, cells with grid lines.
  const roof = M(0, 0.9, -0.01, 0.3, 0, 0);
  const onRoof = (x, y, z, w, h, d, list, color) => add(list, box(w, h, d), color, roof.clone().multiply(M(x, y, z)));
  for (const x of [-0.15, 0.15]) {
    add(metal, cyl(0.014, 0.018, 0.04, 8), FRAME, M(x, 0.855, 0.06));
    add(metal, cyl(0.014, 0.018, 0.08, 8), FRAME, M(x, 0.88, -0.1));
  }
  onRoof(0, 0, 0, 0.54, 0.022, 0.4, metal, FRAME);
  for (const s of [-1, 1]) {
    onRoof(s * 0.271, 0.008, 0, 0.022, 0.04, 0.424, metal, "#4d3d5a");
    onRoof(0, 0.008, s * 0.201, 0.552, 0.04, 0.022, metal, "#4d3d5a");
  }
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = (i - 1) * 0.174;
      const z = (j - 0.5) * 0.19;
      onRoof(x, 0.015, z, 0.164, 0.012, 0.18, glass, (i + j) % 2 ? CELL : CELL_LIGHT);
      // Grid: two busbars along the cell and one across.
      for (const bx of [-0.033, 0.033]) onRoof(x + bx, 0.0216, z, 0.005, 0.002, 0.168, glass, BUSBAR);
      onRoof(x, 0.0214, z, 0.152, 0.0018, 0.004, glass, BUSBAR);
    }
  }

  // Status mast: a bolted base plate on the roof's back corner, a flared collar,
  // the pole and a dish under the light.
  const [mx, , mz] = LIGHT_POS;
  onRoof(mx, 0.03, -0.165, 0.1, 0.018, 0.1, metal, "#4d3d5a");
  for (const bx of [-0.034, 0.034]) {
    for (const bz of [-0.034, 0.034]) add(metal, cyl(0.009, 0.009, 0.012, 6), BRASS, roof.clone().multiply(M(mx + bx, 0.042, -0.165 + bz)));
  }
  add(
    metal,
    tube([[mx, 0.95, mz], [mx, 0.992, mz], [mx, 1.006, mz], [mx, 1.075, mz]], [0.034, 0.026, 0.015, 0.012], 8),
    FRAME,
  );
  add(metal, tube([[mx, 1.06, mz], [mx, 1.078, mz], [mx, 1.09, mz], [mx, 1.091, mz]], [0.014, 0.034, 0.042, 0], 12), BRASS);

  // Undercarriage: side rails, legs with brass feet and knee sleeves, cross bars.
  for (const x of [-0.27, 0.27]) {
    add(metal, rbox(0.06, 0.05, 0.62, 0.014), FRAME, M(x, 0.575, 0));
    for (const z of [-0.28, 0.28]) {
      add(paint, box(0.045, 0.4, 0.05), SHELL, M(x, 0.36, z), shadeUp(-0.2, 0.2));
      add(metal, box(0.056, 0.03, 0.062), FRAME, M(x, 0.4, z));
      add(metal, box(0.06, 0.07, 0.07), BRASS, M(x, 0.165, z));
      add(metal, box(0.03, 0.1, 0.03), FRAME, M(x - Math.sign(x) * 0.048, 0.12, z)); // fork arm
    }
  }
  for (const z of [-0.17, 0.17]) {
    const bar = cyl(0.015, 0.015, 0.5, 8);
    bar.rotateZ(Math.PI / 2);
    add(metal, bar, FRAME, M(0, 0.565, z));
  }

  // Seed probe: hopper, collar and a tapered tip.
  add(metal, tube([[0, 0.575, 0.04], [0, 0.54, 0.04], [0, 0.52, 0.04], [0, 0.48, 0.04], [0, 0.47, 0.04]].reverse(), [0, 0.02, 0.034, 0.04, 0.052], 14), BRASS);
  add(metal, tube([[0, 0.4, 0.04], [0, 0.44, 0.04], [0, 0.475, 0.04]], [0, 0.018, 0.022], 10), FRAME);

  return merge([merge(paint), merge(metal), merge(glass)], true);
}

/** One wheel, rolling about its x axis: ribbed tyre, dished hub, spokes and an axle cap. */
export function botWheelGeometry() {
  const rubber = [];
  const metal = [];
  const R = WHEEL_RADIUS;
  // Tyre: a rounded, slightly open profile turned about y (laid on its side below).
  const prof = [
    [0.054, -0.03],
    [0.07, -0.035],
    [R - 0.008, -0.024],
    [R - 0.008, 0.024],
    [0.07, 0.035],
    [0.054, 0.03],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  rubber.push(piece(new THREE.LatheGeometry(prof, 18), "#2a2130"));
  // Tread: slanted lugs, alternating left and right of the centre line.
  const lugs = 12;
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    const s = i % 2 ? 1 : -1;
    const lug = new THREE.BoxGeometry(0.014, 0.034, 0.013);
    rubber.push(piece(lug, "#372c3e", M(0, 0, 0, 0, a, 0).multiply(M(R - 0.007, s * 0.013, 0, s * 0.5, 0, 0))));
  }
  // Hub: rim, dish, five spokes and the axle cap on both faces.
  metal.push(piece(new THREE.CylinderGeometry(0.056, 0.056, 0.05, 14), "#4d3d5a"));
  for (const s of [-1, 1]) {
    metal.push(piece(new THREE.CylinderGeometry(0.024, 0.03, 0.02, 8), BRASS, M(0, s * 0.032, 0, s < 0 ? Math.PI : 0, 0, 0)));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      metal.push(piece(new THREE.BoxGeometry(0.04, 0.008, 0.013), BRASS, M(0, s * 0.027, 0, 0, a, 0).multiply(M(0.034, 0, 0))));
    }
  }
  const g = merge([merge(rubber), merge(metal)], true);
  g.rotateZ(Math.PI / 2);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
