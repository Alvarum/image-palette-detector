"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPixels, toHex } = require("./worker.js");

function analyze(colors, options = {}) {
  const buffer = Uint8ClampedArray.from(colors.flat()).buffer;
  return extractPixels({
    buffer, width: colors.length, height: 1, source: "fixture.png",
    options: {
      mode: "dominant", colors: 8, sort: "frequency", alpha: "ignore",
      background: [255, 255, 255], ...options,
    },
  });
}

test("hex exposes transparency without dropping RGB", () => {
  assert.equal(toHex([1, 2, 3, 128]), "#01020380");
  assert.equal(toHex([255, 0, 0, 255]), "#FF0000");
});

test("exact reports RGBA frequencies and stable order", () => {
  const result = analyze([
    [255, 0, 0, 255], [0, 0, 255, 255], [255, 0, 0, 255],
  ], { mode: "exact", alpha: "preserve" });
  assert.equal(result.unique_colors, 2);
  assert.equal(result.colors[0].hex, "#FF0000");
  assert.equal(result.colors[0].count, 2);
  assert.equal(result.colors[0].coverage, 0.666667);
  assert.equal(result.sampled_pixels, 3);
});

test("ignore alpha never converts invisible color into a swatch", () => {
  const result = analyze([
    [0, 0, 0, 0], [20, 10, 10, 255],
  ], { mode: "exact" });
  assert.equal(result.colors.length, 1);
  assert.equal(result.considered_pixels, 1);
});

test("dominant returns requested bound and preserves sampled area", () => {
  const red = [255, 0, 0, 255];
  const blue = [0, 0, 255, 255];
  const result = analyze([
    ...Array.from({ length: 75 }, () => red),
    ...Array.from({ length: 25 }, () => blue),
  ], { colors: 2 });
  assert.equal(result.colors.length, 2);
  assert.equal(result.colors[0].count, 75);
  assert.equal(result.colors.reduce((total, swatch) => total + swatch.count, 0), 100);
});

test("transparent input returns an empty list", () => {
  const result = analyze([[1, 2, 3, 0]]);
  assert.deepEqual(result.colors, []);
  assert.equal(result.sampled_pixels, 0);
});

test("dominant alpha preserve is rejected", () => {
  assert.throws(() => analyze([[1, 2, 3, 255]], {
    alpha: "preserve",
  }), /Exact mode only/);
});

test("sampling does not miss the only visible pixel", () => {
  const transparent = [255, 0, 0, 0];
  const visible = [4, 55, 99, 255];
  const result = analyze([
    ...Array.from({ length: 100001 }, () => transparent), visible,
  ], { colors: 1 });
  assert.equal(result.considered_pixels, 1);
  assert.equal(result.sampled_pixels, 1);
  assert.equal(result.colors[0].hex, "#043763");
});
