import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, parseImport, sanitizeFilesData, EXPORT_FORMAT } from "./saveData.js";

const save = { v: 1, size: 6, drone: { x: 0, y: 0 }, items: { Hay: 5 }, unlocks: {}, waterTimer: 0, tiles: [] };
const files = { v: 1, nextId: 3, files: [{ id: 1, name: "crops", code: "harvest();" }, { id: 2, name: "f0", code: "" }] };

test("export → import round-trips save and files", () => {
  const out = buildExport({ save, files }, new Date("2026-11-20T00:00:00.000Z"));
  assert.equal(out.format, EXPORT_FORMAT);
  assert.equal(out.exportedAt, "2026-11-20T00:00:00.000Z");
  const back = parseImport(JSON.stringify(out));
  assert.equal(back.ok, true);
  assert.deepEqual(back.save, save);
  assert.deepEqual(back.files, files);
  assert.equal(back.exportedAt, "2026-11-20T00:00:00.000Z");
});

test("parseImport rejects non-JSON and foreign files", () => {
  assert.equal(parseImport("not json {").ok, false);
  assert.equal(parseImport(JSON.stringify({ hello: 1 })).ok, false);
  assert.equal(parseImport(JSON.stringify({ format: EXPORT_FORMAT, v: 99, save, files })).ok, false);
  assert.equal(parseImport(JSON.stringify({ format: EXPORT_FORMAT, v: 1 })).ok, false);
});

test("parseImport rejects a damaged files section but accepts save-only", () => {
  const bad = buildExport({ save, files: { v: 1, files: [{ id: "x", code: 3 }] } });
  assert.equal(parseImport(JSON.stringify(bad)).ok, false);
  const saveOnly = parseImport(JSON.stringify(buildExport({ save })));
  assert.equal(saveOnly.ok, true);
  assert.equal(saveOnly.files, null);
});

test("sanitizeFilesData drops bad entries and fixes nextId", () => {
  const out = sanitizeFilesData({
    v: 1,
    nextId: 1,
    files: [
      { id: 5, name: "a".repeat(40), code: "x" },
      { id: "no", code: "y" },
      { id: 7, code: null },
    ],
  });
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].name.length, 32);
  assert.equal(out.nextId, 6);
  assert.equal(sanitizeFilesData({ v: 2, files: [{ id: 1, code: "" }] }), null);
  assert.equal(sanitizeFilesData(null), null);
});
