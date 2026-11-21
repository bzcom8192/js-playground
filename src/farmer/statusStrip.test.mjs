// Info-strip snapshot tests. Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./world.js";
import { ENTITY_INFO } from "./constants.js";
import { STRIP_REFRESH_MS, sameFields, stripFields } from "./statusStrip.js";

const stats = (o = {}) => ({ running: true, ticks: 95835, actions: 0, elapsed: 11.94, lastMeasure: null, ...o });

test("strip refreshes at most every 250 ms", () => {
  assert.equal(STRIP_REFRESH_MS, 250);
});

test("stripFields formats the same fields the strip always showed", () => {
  const g = W.createGame();
  g.tiles[0].entity.progress = 0.2;
  g.tiles[0].water = 0;
  const f = stripFields(g, stats(), "running", false);
  assert.deepEqual(f, {
    x: 0,
    y: 0,
    what: `${ENTITY_INFO.Grass?.icon ?? ""} Grass 20% / Grassland`,
    water: null,
    elapsed: "11.9",
    ticks: "95,835",
    measure: null,
    status: "running",
  });
});

test("stripFields: grown entity, water, measure, paused, empty tile", () => {
  const g = W.createGame();
  g.tiles[0].water = 0.456;
  const f = stripFields(g, stats({ lastMeasure: 7 }), "running", true);
  assert.equal(f.what, `${ENTITY_INFO.Grass?.icon ?? ""} Grass / Grassland`);
  assert.equal(f.water, 46);
  assert.equal(f.measure, 7);
  assert.equal(f.status, "paused");
  g.tiles[0].entity = null;
  assert.equal(stripFields(g, stats({ lastMeasure: undefined }), "idle", false).what, "Grassland");
  assert.equal(stripFields(g, stats({ lastMeasure: undefined }), "idle", false).measure, null);
});

test("snapshots are plain values: later engine mutation doesn't change them", () => {
  const g = W.createGame();
  const s = stats();
  const f = stripFields(g, s, "running", false);
  g.drone.x = 3;
  s.ticks += 1000;
  assert.equal(f.x, 0);
  assert.equal(f.ticks, "95,835");
});

test("sameFields is a shallow compare (avoids re-rendering identical samples)", () => {
  const g = W.createGame();
  const a = stripFields(g, stats(), "running", false);
  const b = stripFields(g, stats(), "running", false);
  assert.notEqual(a, b);
  assert.equal(sameFields(a, b), true);
  assert.equal(sameFields(a, stripFields(g, stats({ ticks: 95836 }), "running", false)), false);
  assert.equal(sameFields(a, stripFields(g, stats(), "error", false)), false);
  assert.equal(sameFields(a, null), false);
});
