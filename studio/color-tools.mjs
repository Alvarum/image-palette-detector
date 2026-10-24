/** Color math and pure palette editing operations. No browser APIs. */

const HISTORY_LIMIT = 40;

export function parseHex(input) {
  const value = input.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return null;
  const parts = value.match(/.{2}/g).map((part) => parseInt(part, 16));
  return parts.length === 3 ? [...parts, 255] : parts;
}

export function rgbaToHex(rgba) {
  const parts = rgba.map((n) => n.toString(16).padStart(2, "0"));
  return `#${parts.slice(0, rgba[3] === 255 ? 3 : 4).join("")}`.toUpperCase();
}

export function swatchFromHex(hex) {
  const rgba = parseHex(hex);
  if (!rgba) return null;
  const [r, g, b, a] = rgba;
  return {
    hex: rgbaToHex(rgba), rgb: [r, g, b], rgba,
    css: `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(4)})`,
    count: null, coverage: null, manual: true, locked: false,
  };
}

export function newEditor(colors = []) {
  return {
    colors: colors.map((color) => ({ ...color, locked: !!color.locked })),
    selected: colors.length ? 0 : -1, undo: [], redo: [],
  };
}

function snapshot(editor) {
  return {
    colors: editor.colors.map((color) => ({
      ...color, rgba: [...color.rgba], rgb: [...color.rgb],
    })),
    selected: editor.selected,
  };
}

function commit(editor, next) {
  const previous = snapshot(editor);
  const undo = [...editor.undo, previous].slice(-HISTORY_LIMIT);
  return { ...next, undo, redo: [] };
}

export function editPalette(editor, action) {
  const colors = [...editor.colors];
  const index = action.index ?? editor.selected;
  if (action.type === "undo") {
    if (!editor.undo.length) return editor;
    return {
      ...editor.undo.at(-1), undo: editor.undo.slice(0, -1),
      redo: [...editor.redo, snapshot(editor)].slice(-HISTORY_LIMIT),
    };
  }
  if (action.type === "redo") {
    if (!editor.redo.length) return editor;
    return {
      ...editor.redo.at(-1), redo: editor.redo.slice(0, -1),
      undo: [...editor.undo, snapshot(editor)].slice(-HISTORY_LIMIT),
    };
  }
  if (action.type === "reset") {
    const reset = action.colors.map((color) => ({ ...color, locked: false }));
    return commit(editor, {
      ...editor, colors: reset, selected: reset.length ? 0 : -1,
    });
  }
  if (action.type === "select") {
    return { ...editor, selected: Math.max(-1, Math.min(index, colors.length - 1)) };
  }
  if (action.type === "add") {
    const color = swatchFromHex(action.hex);
    if (!color || colors.length >= 200000) return editor;
    const existing = colors.findIndex((item) => item.hex === color.hex);
    if (existing >= 0) return { ...editor, selected: existing };
    colors.push(color);
    return commit(editor, { ...editor, colors, selected: colors.length - 1 });
  }
  if (index < 0 || index >= colors.length) return editor;
  if (action.type === "update") {
    const color = swatchFromHex(action.hex);
    if (!color || color.hex === colors[index].hex) return editor;
    colors[index] = { ...color, locked: colors[index].locked };
  } else if (action.type === "lock") {
    colors[index] = { ...colors[index], locked: !colors[index].locked };
  } else if (action.type === "remove") {
    colors.splice(index, 1);
  } else if (action.type === "move") {
    const other = index + action.offset;
    if (other < 0 || other >= colors.length) return editor;
    [colors[index], colors[other]] = [colors[other], colors[index]];
    return commit(editor, { ...editor, colors, selected: other });
  } else {
    return editor;
  }
  return commit(editor, {
    ...editor, colors,
    selected: colors.length ? Math.min(index, colors.length - 1) : -1,
  });
}

export function mergeExtracted(editor, extracted, mode = "dominant") {
  // Saved/locked colors are intentionally retained on parameter changes.
  // Their historical pixel coverage must not be carried to the new analysis.
  const locked = editor.colors.filter((color) => color.locked).map((color) => ({
    ...color, count: null, coverage: null, manual: true,
  }));
  const rest = extracted.filter((color) =>
    !locked.some((item) => item.hex === color.hex));
  const merged = [...locked, ...rest];
  // Exact must never drop source colors. Dominant respects the N limit.
  const max = mode === "exact" ? merged.length :
    Math.max(extracted.length, locked.length);
  return newEditor(merged.slice(0, max));
}

function linear(channel) {
  const x = channel / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb) {
  return 0.2126 * linear(rgb[0]) +
    0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

export function contrastRatio(foreground, background) {
  const top = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const bottom = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (top + 0.05) / (bottom + 0.05);
}

export function compositeOn(foreground, background) {
  const alpha = foreground[3] / 255;
  return [0, 1, 2].map((axis) => Math.round(
    foreground[axis] * alpha + background[axis] * (1 - alpha)
  ));
}

export function sampleCoordinate(clientX, clientY, rect, imageWidth, imageHeight) {
  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const x = clientX - rect.left - (rect.width - width) / 2;
  const y = clientY - rect.top - (rect.height - height) / 2;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return {
    x: Math.min(imageWidth - 1, Math.floor(x / scale)),
    y: Math.min(imageHeight - 1, Math.floor(y / scale)),
  };
}
