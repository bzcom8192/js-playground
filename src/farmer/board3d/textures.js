// Small canvas textures for the 3D board (null outside a browser).
import * as THREE from "three";
import { rng } from "./geom.js";

const hasDOM = typeof document !== "undefined";

/** Plough furrows per soil tile: shared by the texture and the tile's relief. */
export const SOIL_FURROWS = 4;

function canvasTexture(size, draw, { repeat = false } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1; // the fixed 55° camera foreshortens the ground by only 1.2×
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

/** Soil: four plough furrows per tile (East–West), then clods, grain and a few pebbles. */
export const soilTexture = (variant = 0) =>
  canvasTexture(256, (ctx, s) => {
    const r = rng(11 + variant * 40);
    ctx.fillStyle = "#675659";
    ctx.fillRect(0, 0, s, s);
    // Painted furrow shading; it lines up with the real relief of the tile top.
    const rows = SOIL_FURROWS;
    for (let y = 0; y < s; y++) {
      const c = Math.cos((y / s) * rows * Math.PI * 2); // 1 on a ridge, −1 in a furrow
      const lit = Math.cos((y / s) * rows * Math.PI * 2 + 0.9);
      ctx.fillStyle = c < 0 ? `rgba(40,20,32,${(-c * 0.34).toFixed(3)})` : `rgba(255,205,190,${(Math.max(0, lit) * 0.12).toFixed(3)})`;
      ctx.fillRect(0, y, s, 1);
    }
    // Tooth marks of the plough: short streaks along the rows.
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = i % 3 ? "rgba(40,20,32,.16)" : "rgba(255,215,200,.1)";
      ctx.fillRect(r() * s, r() * s, 8 + r() * 26, 1 + r() * 1.5);
    }
    // Clods: a dark foot and a lit cap.
    for (let i = 0; i < 70; i++) {
      const x = r() * s;
      const y = r() * s;
      const k = 1.5 + r() * 3;
      ctx.fillStyle = "rgba(38,18,30,.38)";
      ctx.beginPath();
      ctx.ellipse(x + 1, y + 1.4, k * 1.25, k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(150,122,118,.5)";
      ctx.beginPath();
      ctx.ellipse(x, y, k, k * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = "rgba(214,190,180,.6)";
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 2 + r() * 1.5, 1.5 + r(), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, s, ["rgba(38,18,30,.3)", "rgba(255,215,200,.14)"], 900, 12 + variant, 2);
    bevel(ctx, s);
  });

/** Meadow: soft patches, then many short blade strokes over the sage base. */
export const grassTexture = (variant = 0) =>
  canvasTexture(256, (ctx, s) => {
    const r = rng(23 + variant * 40);
    ctx.fillStyle = "#6fa58a";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) {
      const x = r() * s;
      const y = r() * s;
      const k = 18 + r() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, k);
      const tone = i % 2 ? "93,148,121" : "130,182,153";
      g.addColorStop(0, `rgba(${tone},.4)`);
      g.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - k, y - k, k * 2, k * 2);
    }
    const blades = ["#5d9479", "#82b699", "#669c82", "#93c3a4", "#588d73"];
    ctx.lineCap = "round";
    for (let i = 0; i < 1500; i++) {
      const x = r() * s;
      const y = r() * s;
      ctx.strokeStyle = blades[Math.floor(r() * blades.length)];
      ctx.lineWidth = 1 + r() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 7);
      ctx.stroke();
    }
    bevel(ctx, s);
  });

export const waterTexture = () =>
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

/** Sides of the planter box behind the planks, in the plank stain. */
export const plankTexture = () =>
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

/** Neutral wood grain, multiplied over the planks' own vertex colours. */
export const grainTexture = () =>
  canvasTexture(
    256,
    (ctx, s) => {
      const r = rng(37);
      ctx.fillStyle = "#f4f1f0";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        const y = r() * s;
        ctx.strokeStyle = i % 3 ? `rgba(60,35,55,${(0.08 + r() * 0.16).toFixed(3)})` : "rgba(255,250,245,.5)";
        ctx.lineWidth = 0.8 + r() * 1.8;
        ctx.beginPath();
        ctx.moveTo(-4, y);
        ctx.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 9, s * 0.7, y + (r() - 0.5) * 9, s + 4, y);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const x = r() * s;
        const y = r() * s;
        for (let k = 5; k > 0; k--) {
          ctx.strokeStyle = "rgba(50,28,46,.22)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(x, y, k * 3.4, k * 1.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },
    { repeat: true },
  );

export const blobShadowTexture = () =>
  canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(0,0,0,.55)");
    g.addColorStop(0.55, "rgba(0,0,0,.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
