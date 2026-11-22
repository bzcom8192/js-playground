import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount } from "./format.js";

test("formatCount abbreviates inventory counts", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(155), "155");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1k");
  assert.equal(formatCount(9000), "9k");
  assert.equal(formatCount(10100), "10.1k");
  assert.equal(formatCount(3260), "3.26k");
  assert.equal(formatCount(3269), "3.26k");
  assert.equal(formatCount(999999), "999.99k");
  assert.equal(formatCount(1500000), "1.5M");
});
