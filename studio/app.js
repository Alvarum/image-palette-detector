import {
  compositeOn, contrastRatio, editPalette, mergeExtracted, newEditor,
  parseHex, relativeLuminance, rgbaToHex, sampleCoordinate,
} from "./color-tools.mjs";
import { initializeAnimations } from "./animations.mjs";

/* Minimal client-only Studio: one image, one worker, predictable state. */
"use strict";

const $ = (id) => document.getElementById(id);
const elements = {
  input: $("file-input"), browse: $("browse"), drop: $("dropzone"),
  placeholder: $("placeholder"), preview: $("preview"),
  meta: $("image-meta"), detail: $("image-detail"),
  modeInfo: $("mode-description"), countGroup: $("count-group"),
  count: $("color-count"), countValue: $("count-value"),
  sort: $("sort"), alpha: $("alpha"), background: $("background"),
  swatches: $("swatches"), countChip: $("swatch-count"),
  summary: $("summary"), status: $("status"),
  export: $("export"), format: $("export-format"),
  sampleToggle: $("sample-toggle"), sampleAdd: $("sample-add"),
  creative: $("creative-panel"),
  undo: $("undo"), redo: $("redo"), reset: $("reset"),
  editHex: $("edit-hex"), editPicker: $("edit-picker"),
  editApply: $("edit-apply"), editLock: $("edit-lock"),
  editLeft: $("edit-left"), editRight: $("edit-right"),
  editCopy: $("edit-copy"), editRemove: $("edit-remove"),
  selectedPreview: $("selected-preview"), newColor: $("new-color"),
  addColor: $("add-color"), contrastFg: $("contrast-fg"),
  contrastBg: $("contrast-bg"), contrastSwap: $("contrast-swap"),
  contrastStats: $("contrast-stats"), contrastPreview: $("contrast-preview"),
  gradientPreview: $("gradient-preview"), copyGradient: $("copy-gradient"),
};
const MAX_PIXELS = 6_000_000;
const MAX_DECODE_PIXELS = 25_000_000;
const MAX_VISIBLE_SWATCHES = 256;
const worker = new Worker(new URL("./worker.js", import.meta.url));
const state = {
  file: null, pixels: null, width: 0, height: 0,
  previewUrl: null, result: null, request: 0, sampledPreview: false,
  loadRequest: 0, baseResult: null, editor: null, sampling: false,
  sampleHex: null,
};

function showStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", error);
}

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function options() {
  const background = elements.background.value.slice(1);
  return {
    mode: mode(), colors: Number(elements.count.value),
    sort: elements.sort.value, alpha: elements.alpha.value,
    background: [0, 2, 4].map((start) =>
      Number.parseInt(background.slice(start, start + 2), 16)),
  };
}

function refreshControls() {
  const exact = mode() === "exact";
  elements.countGroup.hidden = exact;
  elements.countValue.textContent = elements.count.value;
  elements.modeInfo.textContent = exact ?
    "Lista los colores de la imagen y su frecuencia." :
    "Reduce los colores de la imagen a una paleta representativa.";
  const preserve = [...elements.alpha.options].find((option) =>
    option.value === "preserve");
  preserve.disabled = !exact;
  if (!exact && elements.alpha.value === "preserve") {
    elements.alpha.value = "ignore";
  }
  if (state.file) analyze();
}

function toggleBusy(isBusy) {
  elements.export.disabled = isBusy || !state.result;
  elements.drop.setAttribute("aria-busy", String(isBusy));
}

function updateEditorControls() {
  const editor = state.editor;
  const chosen = editor?.colors[editor.selected];
  elements.creative.hidden = !state.baseResult;
  elements.undo.disabled = !editor?.undo.length;
  elements.redo.disabled = !editor?.redo.length;
  elements.reset.disabled = !state.baseResult;
  for (const id of ["editHex", "editPicker", "editApply", "editLock", "editLeft",
    "editRight", "editCopy", "editRemove"]) {
    elements[id].disabled = !chosen;
  }
  if (!chosen) {
    elements.editHex.value = "";
    elements.selectedPreview.style.backgroundColor = "transparent";
    elements.editLock.setAttribute("aria-pressed", "false");
    elements.editLeft.disabled = true;
    elements.editRight.disabled = true;
    return;
  }
  elements.editHex.value = chosen.hex;
  elements.editPicker.value = `#${chosen.rgb.map((n) =>
    n.toString(16).padStart(2, "0")).join("")}`;
  elements.selectedPreview.style.backgroundColor = chosen.css;
  elements.editLock.textContent = chosen.locked ? "Desfijar" : "Fijar";
  elements.editLock.setAttribute("aria-pressed", String(!!chosen.locked));
  elements.editLeft.disabled = editor.selected === 0;
  elements.editRight.disabled = editor.selected === editor.colors.length - 1;
}

function updateContrastChoices() {
  const colors = state.editor?.colors || [];
  const fgPrevious = elements.contrastFg.value;
  const bgPrevious = elements.contrastBg.value;
  const darkest = [...colors].sort((a, b) =>
    relativeLuminance(a.rgb) - relativeLuminance(b.rgb));
  const defaultFg = colors.indexOf(darkest[0]);
  const defaultBg = colors.indexOf(darkest.at(-1));
  for (const select of [elements.contrastFg, elements.contrastBg]) {
    select.replaceChildren(...colors.map((color, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${String(index + 1).padStart(2, "0")} · ${color.hex}`;
      return option;
    }));
  }
  const valid = (value) => value !== "" && Number(value) < colors.length;
  elements.contrastFg.value = valid(fgPrevious) ? fgPrevious : String(defaultFg);
  elements.contrastBg.value = valid(bgPrevious) ? bgPrevious : String(defaultBg);
  updateContrast();
}

function gradientValue() {
  const fg = state.editor?.colors[Number(elements.contrastFg.value)];
  const bg = state.editor?.colors[Number(elements.contrastBg.value)];
  return fg && bg ? `linear-gradient(90deg, ${fg.hex}, ${bg.hex})` : null;
}

function updateContrast() {
  const fg = state.editor?.colors[Number(elements.contrastFg.value)];
  const bg = state.editor?.colors[Number(elements.contrastBg.value)];
  if (!fg || !bg) {
    elements.contrastStats.textContent = "Selecciona dos colores.";
    elements.contrastPreview.style.background = "";
    elements.contrastPreview.style.color = "";
    elements.gradientPreview.style.background = "";
    elements.copyGradient.disabled = true;
    return;
  }
  // WCAG ratio is calculated for displayed, fully opaque sRGB colors.
  // Semi-transparent foreground overlays the flattened background.
  const bgOpaque = compositeOn(bg.rgba, [255, 255, 255]);
  const fgOpaque = compositeOn(fg.rgba, bgOpaque);
  const ratio = contrastRatio(fgOpaque, bgOpaque);
  elements.contrastPreview.style.backgroundColor = `rgb(${bgOpaque.join(",")})`;
  elements.contrastPreview.style.color = `rgb(${fgOpaque.join(",")})`;
  elements.contrastStats.replaceChildren();
  const ratioValue = document.createElement("strong");
  ratioValue.textContent = `${ratio.toFixed(2)}:1`;
  const details = document.createElement("span");
  details.textContent = `${ratio >= 4.5 ? "AA texto: cumple" : "AA texto: no cumple"} · ` +
    `${ratio >= 3 ? "AA texto grande: cumple" : "AA texto grande: no cumple"} · ` +
    `${ratio >= 7 ? "AAA: cumple" : "AAA: no cumple"}`;
  elements.contrastStats.append(ratioValue, details);
  elements.gradientPreview.style.background = gradientValue();
  elements.copyGradient.disabled = false;
}

function refreshPaletteUI(animateSwatches = false) {
  if (!state.baseResult || !state.editor) return;
  state.result = {
    ...state.baseResult,
    edited: state.editor.undo.length > 0,
    colors: state.editor.colors.map((color) => ({ ...color })),
  };
  const colors = state.editor.colors;
  elements.swatches.replaceChildren();
  elements.countChip.textContent = String(colors.length);
  elements.export.disabled = false;
  if (!colors.length) {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "Paleta vacía. Añade un color o restablece el análisis.";
    elements.swatches.append(text);
  }
  colors.slice(0, MAX_VISIBLE_SWATCHES).forEach((color, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.classList.toggle("is-selected", index === state.editor.selected);
    button.setAttribute("aria-pressed", String(index === state.editor.selected));
    button.setAttribute("aria-label", `Editar color ${color.hex}, posición ${index + 1}`);
    const fill = document.createElement("span");
    fill.className = "swatch-fill";
    const inner = document.createElement("span");
    inner.style.backgroundColor = color.css;
    fill.append(inner);
    const details = document.createElement("span");
    details.className = "swatch-meta";
    const hex = document.createElement("strong");
    hex.textContent = color.hex;
    const coverage = document.createElement("small");
    coverage.textContent = color.manual || color.coverage == null ?
      "Editado / añadido" : `${(color.coverage * 100).toFixed(1)}% presencia`;
    details.append(hex, coverage);
    if (color.locked) {
      const pin = document.createElement("span");
      pin.className = "pinned-label";
      pin.textContent = "Fijado";
      details.append(pin);
    }
    button.append(fill, details);
    button.addEventListener("click", () => {
      state.editor = editPalette(state.editor, { type: "select", index });
      elements.swatches.querySelectorAll(".swatch").forEach((swatch, i) => {
        swatch.classList.toggle("is-selected", i === index);
        swatch.setAttribute("aria-pressed", String(i === index));
      });
      updateEditorControls();
      document.dispatchEvent(new CustomEvent("palette:selection", {
        detail: { target: button },
      }));
    });
    elements.swatches.append(button);
  });
  if (colors.length > MAX_VISIBLE_SWATCHES) {
    const notice = document.createElement("p");
    notice.className = "swatch-notice";
    notice.textContent = `Mostrando ${MAX_VISIBLE_SWATCHES} de ${
      colors.length.toLocaleString("es-CL")} colores. ` +
      "Las exportaciones incluyen la paleta completa.";
    elements.swatches.append(notice);
  }
  elements.summary.textContent = `${state.baseResult.sampled_pixels.toLocaleString("es-CL")} píxeles ${
    state.baseResult.mode === "exact" ? "contados" : "muestreados"} · ${
    state.baseResult.mode === "exact" ? "Colores exactos" : "Cuantización RGB aproximada"}`;
  updateEditorControls();
  updateContrastChoices();
  if (animateSwatches) {
    document.dispatchEvent(new CustomEvent("palette:rendered"));
  }
}

function renderPalette(result) {
  state.baseResult = result;
  state.editor = state.editor ? mergeExtracted(state.editor, result.colors, result.mode) :
    newEditor(result.colors);
  // Recompute default contrast colors after each new extraction.
  elements.contrastFg.value = "";
  elements.contrastBg.value = "";
  refreshPaletteUI(true);
  showStatus("Análisis completo");
}

function applyEditorAction(action, message) {
  if (!state.editor) return;
  const next = editPalette(state.editor, action);
  if (next === state.editor) {
    if (action.type === "update" || action.type === "add") {
      showStatus("Introduce un valor HEX de 6 u 8 dígitos.", true);
    }
    return;
  }
  const selectedDuplicate = action.type === "add" &&
    next.undo.length === state.editor.undo.length;
  state.editor = next;
  refreshPaletteUI(action.type !== "select");
  showStatus(selectedDuplicate ? "Color existente seleccionado" : message);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showStatus("Copiado al portapapeles");
  } catch {
    showStatus("No se pudo copiar. Comprueba los permisos del navegador.", true);
  }
}

function sampleImage(event) {
  if (!state.sampling || !state.pixels) return;
  const coord = sampleCoordinate(
    event.clientX, event.clientY, elements.preview.getBoundingClientRect(),
    state.width, state.height
  );
  if (!coord) {
    showStatus("Selecciona un punto dentro de la imagen.", true);
    return;
  }
  const at = (coord.y * state.width + coord.x) * 4;
  const pixel = [...state.pixels.slice(at, at + 4)];
  // An added swatch is an opaque color as seen over the chosen canvas background.
  const bg = parseHex(elements.background.value);
  const rgb = compositeOn(pixel, bg);
  state.sampleHex = rgbaToHex([...rgb, 255]);
  elements.sampleAdd.hidden = false;
  elements.sampleAdd.textContent = `Agregar ${state.sampleHex}`;
  elements.sampleAdd.style.borderColor = state.sampleHex;
  showStatus(`Píxel ${coord.x}, ${coord.y}: ${state.sampleHex}`);
  state.sampling = false;
  elements.drop.classList.remove("sampling");
  elements.sampleToggle.setAttribute("aria-pressed", "false");
}

function analyze() {
  if (!state.pixels) return;
  const id = ++state.request;
  if (mode() === "exact" && state.sampledPreview) {
    state.result = null;
    state.baseResult = null;
    elements.creative.hidden = true;
    elements.export.disabled = true;
    elements.swatches.replaceChildren();
    elements.countChip.textContent = "0";
    showStatus(
      "El modo Exacto requiere una imagen de 6 MP o menos.", true
    );
    return;
  }
  state.result = null;
  elements.creative.hidden = true;
  elements.swatches.replaceChildren();
  const progress = document.createElement("p");
  progress.className = "hint";
  progress.textContent = "Calculando paleta…";
  elements.swatches.append(progress);
  elements.countChip.textContent = "…";
  toggleBusy(true);
  showStatus("Analizando colores…");
  // A cloned buffer lets users change settings while a prior job finishes.
  const buffer = state.pixels.slice().buffer;
  worker.postMessage({
    id, buffer, width: state.width, height: state.height,
    source: state.file.name, options: options(),
  }, [buffer]);
}

worker.onmessage = ({ data }) => {
  if (data.id !== state.request) return;
  toggleBusy(false);
  if (data.error) {
    state.result = null;
    state.baseResult = null;
    elements.creative.hidden = true;
    elements.export.disabled = true;
    showStatus(data.error, true);
  } else {
    renderPalette(data.result);
  }
};
worker.onerror = () => {
  state.result = null;
  state.baseResult = null;
  elements.creative.hidden = true;
  toggleBusy(false);
  showStatus("El analizador falló. Recarga la página para reintentarlo.", true);
};

async function openFile(file) {
  if (!file) return;
  const loadRequest = ++state.loadRequest;
  const allowed = new Set([
    "image/png", "image/jpeg", "image/webp", "image/gif",
    "image/bmp", "image/tiff",
  ]);
  const extension = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
  if ((!allowed.has(file.type) && !(file.type === "" && extension)) ||
      file.size === 0 || file.size > 75_000_000) {
    showStatus("Usa una imagen raster válida (máximo 75 MB).", true);
    return;
  }
  // Prevent an old Worker result from appearing under a newly selected file.
  state.request += 1;
  state.result = null;
  state.baseResult = null;
  state.editor = null;
  state.sampleHex = null;
  elements.sampleAdd.hidden = true;
  elements.creative.hidden = true;
  elements.export.disabled = true;
  try {
    showStatus("Leyendo imagen…");
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (loadRequest !== state.loadRequest) {
      bitmap.close();
      return;
    }
    const pixelCount = bitmap.width * bitmap.height;
    if (pixelCount > MAX_DECODE_PIXELS) {
      bitmap.close();
      throw new Error("Imagen demasiado grande (límite: 25 MP). Reduce su tamaño.");
    }
    if (pixelCount > MAX_PIXELS && mode() === "exact") {
      bitmap.close();
      throw new Error("Para el modo Exacto, la imagen debe tener 6 MP o menos.");
    }
    const factor = Math.min(1, Math.sqrt(MAX_PIXELS / pixelCount));
    const width = Math.max(1, Math.floor(bitmap.width * factor));
    const height = Math.max(1, Math.floor(bitmap.height * factor));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Tu navegador no permite analizar el lienzo.");
    context.imageSmoothingEnabled = factor < 1;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    if (loadRequest !== state.loadRequest) return;
    const url = URL.createObjectURL(file);
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = url;
    state.file = file;
    state.pixels = pixels;
    elements.sampleToggle.disabled = false;
    elements.sampleToggle.setAttribute("aria-pressed", "false");
    elements.drop.classList.remove("sampling");
    state.sampling = false;
    state.width = width;
    state.height = height;
    state.sampledPreview = factor < 1;
    elements.preview.src = url;
    elements.preview.alt = `Vista previa: ${file.name}`;
    elements.preview.hidden = false;
    elements.placeholder.hidden = true;
    elements.drop.classList.add("has-image");
    elements.meta.textContent = file.name;
    elements.detail.textContent = `${width} × ${height} px ${
      factor < 1 ? "· Reducida para analizar" : "· Resolución original"}`;
    analyze();
  } catch (error) {
    if (loadRequest === state.loadRequest) {
      showStatus(error.message || "No se pudo abrir esta imagen.", true);
    }
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the download has been dispatched to the browser.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportResult() {
  const result = state.result;
  if (!result) return;
  const format = elements.format.value;
  const name = `${state.file.name}.palette.${format}`;
  const colors = result.colors;
  if (format === "gpl" && colors.some((color) => color.rgba[3] !== 255)) {
    showStatus("GIMP GPL no admite alfa. Exporta PNG o JSON.", true);
    return;
  }
  if ((format === "png" || format === "svg") && colors.length > 4096) {
    showStatus("Demasiados colores para una vista gráfica (máximo 4096).", true);
    return;
  }
  const columns = Math.min(12, Math.max(1, colors.length));
  const rows = Math.max(1, Math.ceil(colors.length / columns));
  if (format === "png") {
    const canvas = document.createElement("canvas");
    canvas.width = columns * 72;
    canvas.height = rows * 72;
    const ctx = canvas.getContext("2d");
    colors.forEach((color, index) => {
      ctx.fillStyle = color.css;
      ctx.fillRect((index % columns) * 72, Math.floor(index / columns) * 72, 72, 72);
    });
    canvas.toBlob((blob) => {
      if (blob) download(blob, name);
      else showStatus("No se pudo exportar el PNG.", true);
    }, "image/png");
    return;
  }
  let text = "";
  if (format === "json") {
    text = `${JSON.stringify(result, null, 2)}\n`;
  } else if (format === "css") {
    text = `:root {\n${colors.map((color, index) =>
      `  --palette-${String(index + 1).padStart(3, "0")}: ${color.hex};`
    ).join("\n")}\n}\n`;
  } else if (format === "svg") {
    const blocks = colors.map((color, index) =>
      `<rect x="${index % columns * 72}" y="${Math.floor(index / columns) * 72}" width="72" height="72" fill="${color.hex}"/>`
    ).join("\n");
    text = `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 72}" height="${rows * 72}" viewBox="0 0 ${columns * 72} ${rows * 72}">\n${blocks}\n</svg>\n`;
  } else if (format === "gpl") {
    const safeName = state.file.name.replace(/[\r\n]/g, " ");
    text = `GIMP Palette\nName: ${safeName}\nColumns: 8\n#\n${colors.map((color) =>
      color.rgb.map((channel) => String(channel).padStart(3, " ")).join(" ") + `\t${color.hex}`
    ).join("\n")}\n`;
  }
  download(new Blob([text], { type: "text/plain;charset=utf-8" }), name);
  showStatus(`${format.toUpperCase()} exportado`);
}

elements.browse.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.input.click();
});
elements.drop.addEventListener("click", () => {
  if (!state.sampling) elements.input.click();
});
elements.preview.addEventListener("click", (event) => {
  if (!state.sampling) return;
  event.stopPropagation();
  sampleImage(event);
});
elements.drop.addEventListener("keydown", (event) => {
  if (event.target !== elements.drop) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.input.click();
  }
});
elements.input.addEventListener("change", () => {
  openFile(elements.input.files[0]);
  elements.input.value = "";
});
for (const event of ["dragenter", "dragover"]) {
  elements.drop.addEventListener(event, (action) => {
    action.preventDefault();
    elements.drop.classList.add("dragover");
  });
}
for (const event of ["dragleave", "drop"]) {
  elements.drop.addEventListener(event, (action) => {
    action.preventDefault();
    elements.drop.classList.remove("dragover");
  });
}
elements.drop.addEventListener("drop", (event) => openFile(event.dataTransfer.files[0]));
document.addEventListener("paste", (event) => {
  const file = [...(event.clipboardData?.files || [])].find((entry) =>
    entry.type.startsWith("image/"));
  if (file) openFile(file);
});
for (const input of document.querySelectorAll('input[name="mode"]')) {
  input.addEventListener("change", refreshControls);
}
for (const input of [elements.alpha, elements.sort, elements.background]) {
  input.addEventListener("change", refreshControls);
}
elements.count.addEventListener("input", () => {
  elements.countValue.textContent = elements.count.value;
});
elements.count.addEventListener("change", refreshControls);
elements.export.addEventListener("click", exportResult);
refreshControls();

// Editing actions are independent of the extraction Worker.
elements.sampleToggle.addEventListener("click", () => {
  if (!state.file) return;
  state.sampling = !state.sampling;
  elements.drop.classList.toggle("sampling", state.sampling);
  elements.sampleToggle.setAttribute("aria-pressed", String(state.sampling));
  showStatus(state.sampling ? "Haz clic en un píxel de la imagen." : "Cuentagotas desactivado");
});
elements.sampleAdd.addEventListener("click", () => {
  if (state.sampleHex) applyEditorAction({ type: "add", hex: state.sampleHex }, "Color agregado");
});
elements.editApply.addEventListener("click", () => applyEditorAction({
  type: "update", hex: elements.editHex.value,
}, "Color actualizado"));
elements.editHex.addEventListener("keydown", (event) => {
  if (event.key === "Enter") elements.editApply.click();
});
elements.editPicker.addEventListener("change", () => {
  elements.editHex.value = elements.editPicker.value.toUpperCase();
  elements.editApply.click();
});
elements.addColor.addEventListener("click", () => applyEditorAction({
  type: "add", hex: elements.newColor.value,
}, "Color agregado"));
elements.editLock.addEventListener("click", () => applyEditorAction({
  type: "lock",
}, "Fijación modificada"));
elements.editRemove.addEventListener("click", () => applyEditorAction({
  type: "remove",
}, "Color eliminado"));
elements.editLeft.addEventListener("click", () => applyEditorAction({
  type: "move", offset: -1,
}, "Color movido"));
elements.editRight.addEventListener("click", () => applyEditorAction({
  type: "move", offset: 1,
}, "Color movido"));
elements.editCopy.addEventListener("click", () => {
  const chosen = state.editor?.colors[state.editor.selected];
  if (chosen) copyText(chosen.hex);
});
elements.undo.addEventListener("click", () => applyEditorAction({
  type: "undo",
}, "Cambio deshecho"));
elements.redo.addEventListener("click", () => applyEditorAction({
  type: "redo",
}, "Cambio rehecho"));
elements.reset.addEventListener("click", () => {
  if (!state.baseResult) return;
  applyEditorAction({
    type: "reset", colors: state.baseResult.colors,
  }, "Paleta restablecida");
});
for (const select of [elements.contrastFg, elements.contrastBg]) {
  select.addEventListener("change", updateContrast);
}
elements.contrastSwap.addEventListener("click", () => {
  const previous = elements.contrastFg.value;
  elements.contrastFg.value = elements.contrastBg.value;
  elements.contrastBg.value = previous;
  updateContrast();
});
elements.copyGradient.addEventListener("click", () => {
  const value = gradientValue();
  if (value) copyText(`background: ${value};`);
});
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") {
    return;
  }
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement || !state.editor) return;
  event.preventDefault();
  applyEditorAction({
    type: event.shiftKey ? "redo" : "undo",
  }, event.shiftKey ? "Cambio rehecho" : "Cambio deshecho");
});
initializeAnimations();
