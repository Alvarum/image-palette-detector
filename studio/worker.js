/* Palette computation runs outside the browser's rendering thread.
 * No external requests, randomness or third-party packages are required.
 */
"use strict";

const MAX_EXACT_COLORS = 200000;
const MAX_SAMPLES = 100000;

function toHex(rgba) {
  const hex = rgba.map((part) => part.toString(16).padStart(2, "0"));
  return `#${hex.slice(0, rgba[3] === 255 ? 3 : 4).join("").toUpperCase()}`;
}

function linear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(rgba) {
  return 0.2126 * linear(rgba[0]) + 0.7152 * linear(rgba[1]) + 0.0722 * linear(rgba[2]);
}

function hue(rgba) {
  const rgb = rgba.slice(0, 3).map((part) => part / 255);
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const delta = max - min;
  if (delta === 0) return 0;
  const index = rgb.indexOf(max);
  const offset = index === 0 ? (rgb[1] - rgb[2]) / delta :
    index === 1 ? (rgb[2] - rgb[0]) / delta + 2 :
      (rgb[0] - rgb[1]) / delta + 4;
  return ((offset / 6) + 1) % 1;
}

function compareColors(left, right, sort) {
  const first = sort === "luminance" ? luminance(left.rgba) :
    sort === "hue" ? hue(left.rgba) : -left.count;
  const second = sort === "luminance" ? luminance(right.rgba) :
    sort === "hue" ? hue(right.rgba) : -right.count;
  if (first !== second) return first - second;
  if (left.count !== right.count) return right.count - left.count;
  return left.rgba.join(",").localeCompare(right.rgba.join(","));
}

function normalize(r, g, b, a, alpha, background) {
  if (alpha === "preserve") return [r, g, b, a];
  if (alpha === "ignore" && a === 0) return null;
  const fraction = a / 255;
  return [
    Math.round(r * fraction + background[0] * (1 - fraction)),
    Math.round(g * fraction + background[1] * (1 - fraction)),
    Math.round(b * fraction + background[2] * (1 - fraction)),
    255,
  ];
}

function medianCut(points, count) {
  if (points.length === 0) return [];
  // Each point stores RGB sums and weight in a five-bit RGB bucket.
  const boxes = [points];
  while (boxes.length < count) {
    let chosen = -1;
    let chosenAxis = 0;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.length < 2) continue;
      const ranges = [0, 1, 2].map((axis) => {
        const values = box.map((point) => point[axis]);
        return Math.max(...values) - Math.min(...values);
      });
      const maxRange = Math.max(...ranges);
      const weight = box.reduce((sum, point) => sum + point[3], 0);
      const score = maxRange * Math.sqrt(weight);
      if (score > bestScore) {
        chosen = i;
        chosenAxis = ranges.indexOf(maxRange);
        bestScore = score;
      }
    }
    if (chosen < 0 || bestScore === 0) break;
    const box = boxes[chosen].slice().sort((a, b) =>
      a[chosenAxis] - b[chosenAxis] || a[0] - b[0] ||
      a[1] - b[1] || a[2] - b[2]);
    const total = box.reduce((sum, point) => sum + point[3], 0);
    let running = 0;
    let split = 1;
    for (let i = 0; i < box.length - 1; i += 1) {
      running += box[i][3];
      split = i + 1;
      if (running >= total / 2) break;
    }
    boxes.splice(chosen, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.map((box) => {
    const countPixels = box.reduce((sum, point) => sum + point[3], 0);
    const rgba = [0, 1, 2].map((axis) => Math.round(
      box.reduce((sum, point) => sum + point[axis + 4], 0) / countPixels
    ));
    return { rgba: [...rgba, 255], count: countPixels };
  });
}

function extractPixels({ buffer, width, height, source, options }) {
  const pixels = new Uint8ClampedArray(buffer);
  const total = width * height;
  if (pixels.length !== total * 4 || total === 0) {
    throw new Error("Invalid RGBA pixel buffer");
  }
  if (options.mode === "dominant" && options.alpha === "preserve") {
    throw new Error("Preserve alpha is available in Exact mode only");
  }
  const stride = options.mode === "exact" ? 1 : Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const histogram = new Map();
  let considered = 0;
  let sampled = 0;
  for (let i = 0; i < total; i += 1) {
    const offset = i * 4;
    const pixel = normalize(
      pixels[offset], pixels[offset + 1], pixels[offset + 2],
      pixels[offset + 3], options.alpha, options.background
    );
    if (pixel === null) continue;
    considered += 1;
    if ((considered - 1) % stride !== 0) continue;
    sampled += 1;
    if (options.mode === "exact") {
      const key = pixel.join(",");
      const record = histogram.get(key);
      if (record) record.count += 1;
      else histogram.set(key, { rgba: pixel, count: 1 });
      if (histogram.size > MAX_EXACT_COLORS) {
        throw new Error("Too many exact colors (limit: 200,000). Try Dominant mode.");
      }
    } else {
      const key = (pixel[0] >> 3) << 10 |
        (pixel[1] >> 3) << 5 | (pixel[2] >> 3);
      const record = histogram.get(key);
      if (record) {
        record[3] += 1;
        record[4] += pixel[0];
        record[5] += pixel[1];
        record[6] += pixel[2];
      } else {
        histogram.set(key, [pixel[0] >> 3, pixel[1] >> 3,
          pixel[2] >> 3, 1, pixel[0], pixel[1], pixel[2]]);
      }
    }
  }
  const raw = options.mode === "exact" ? [...histogram.values()] :
    medianCut([...histogram.values()], options.colors);
  const colors = raw.map((item) => {
    const rgba = item.rgba;
    return {
      hex: toHex(rgba),
      rgb: rgba.slice(0, 3),
      rgba,
      css: `rgb(${rgba[0]} ${rgba[1]} ${rgba[2]} / ${(rgba[3] / 255).toFixed(4)})`,
      count: item.count,
      coverage: Number((item.count / sampled).toFixed(6)),
    };
  }).sort((a, b) => compareColors(a, b, options.sort));
  return {
    schema_version: 1,
    source,
    width,
    height,
    total_pixels: total,
    considered_pixels: considered,
    sampled_pixels: sampled,
    unique_colors: options.mode === "exact" ? colors.length : null,
    mode: options.mode,
    options,
    colors,
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event) => {
    const { id, ...payload } = event.data;
    try {
      self.postMessage({ id, result: extractPixels(payload) });
    } catch (error) {
      self.postMessage({ id, error: error.message || "Could not analyze image" });
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractPixels, toHex, medianCut };
}
