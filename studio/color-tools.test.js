"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const tools = () => import("./color-tools.mjs");

test("parses valid opaque and alpha colors, rejects invalid hex", async () => {
  const { parseHex, swatchFromHex } = await tools();
  assert.deepEqual(parseHex("#ff0080"), [255, 0, 128, 255]);
  assert.deepEqual(parseHex("00000000"), [0, 0, 0, 0]);
  assert.equal(parseHex("#BAD"), null);
  assert.equal(parseHex("#112233ZZ"), null);
  assert.equal(swatchFromHex("#123456").coverage, null);
});

test("editing, pinning, moving, undo and redo are reversible", async () => {
  const { newEditor, editPalette, swatchFromHex } = await tools();
  let state = newEditor([swatchFromHex("#FF0000"), swatchFromHex("#0000FF")]);
  state = editPalette(state, { type: "lock", index: 0 });
  state = editPalette(state, { type: "move", index: 0, offset: 1 });
  assert.equal(state.colors[1].locked, true);
  state = editPalette(state, { type: "update", index: 1, hex: "#00FF00" });
  assert.equal(state.colors[1].count, null);
  state = editPalette(state, { type: "undo" });
  assert.equal(state.colors[1].hex, "#FF0000");
  state = editPalette(state, { type: "redo" });
  assert.equal(state.colors[1].hex, "#00FF00");
});

test("locked colors survive reanalysis without stale coverage", async () => {
  const { newEditor, editPalette, mergeExtracted, swatchFromHex } = await tools();
  const old = swatchFromHex("#FF0000");
  old.count = 90; old.coverage = 0.9;
  let state = editPalette(newEditor([old]), { type: "lock" });
  state = mergeExtracted(state, [swatchFromHex("#0000FF")]);
  assert.equal(state.colors[0].hex, "#FF0000");
  assert.equal(state.colors[0].coverage, null);
  assert.equal(state.colors[0].manual, true);
  assert.equal(state.colors[0].locked, true);
});

test("WCAG contrast ratio is correct for well known pairs", async () => {
  const { contrastRatio, compositeOn } = await tools();
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRatio([127, 127, 127], [127, 127, 127]), 1);
  assert.deepEqual(compositeOn([255, 0, 0, 128], [0, 0, 0]), [128, 0, 0]);
});

test("point sample maps contain letterboxing to correct source pixel", async () => {
  const { sampleCoordinate } = await tools();
  const rect = { left: 100, top: 100, width: 200, height: 200 };
  assert.deepEqual(sampleCoordinate(150, 200, rect, 200, 100), { x: 50, y: 50 });
  assert.equal(sampleCoordinate(150, 125, rect, 200, 100), null);
  assert.equal(sampleCoordinate(300, 200, rect, 200, 100), null);
});


test("duplicate swatches are selected without re-adding or changing history", async () => {
  const { newEditor, editPalette, swatchFromHex } = await tools();
  const editor = newEditor([swatchFromHex("#FF0000")]);
  const next = editPalette(editor, { type: "add", hex: "#FF0000" });
  assert.equal(next.colors.length, 1);
  assert.equal(next.undo.length, 0);
});

test("reset is undoable, including previously locked colors", async () => {
  const { newEditor, editPalette, swatchFromHex } = await tools();
  let editor = newEditor([swatchFromHex("#FF0000")]);
  editor = editPalette(editor, { type: "lock" });
  editor = editPalette(editor, { type: "reset", colors: [swatchFromHex("#0000FF")] });
  assert.equal(editor.colors[0].hex, "#0000FF");
  editor = editPalette(editor, { type: "undo" });
  assert.equal(editor.colors[0].locked, true);
  assert.equal(editor.colors[0].hex, "#FF0000");
});


test("exact reanalysis keeps all detected colors plus additional pinned swatches", async () => {
  const { newEditor, editPalette, mergeExtracted, swatchFromHex } = await tools();
  let state = newEditor([swatchFromHex("#C9A6D8")]);
  state = editPalette(state, { type: "lock" });
  state = mergeExtracted(state,
    [swatchFromHex("#FF0000"), swatchFromHex("#0000FF")], "exact");
  assert.equal(state.colors.length, 3);
  assert.equal(state.colors[0].locked, true);
});
