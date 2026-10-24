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
};
const MAX_PIXELS = 6_000_000;
const MAX_DECODE_PIXELS = 25_000_000;
const MAX_VISIBLE_SWATCHES = 256;
const worker = new Worker("./worker.js");
const state = {
  file: null, pixels: null, width: 0, height: 0,
  previewUrl: null, result: null, request: 0, sampledPreview: false,
  loadRequest: 0,
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
    "Todos los colores exactos que aparecen en la imagen, con su frecuencia." :
    "Una selección compacta de los tonos más representativos.";
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

function renderPalette(result) {
  state.result = result;
  elements.swatches.replaceChildren();
  elements.countChip.textContent = String(result.colors.length);
  elements.export.disabled = false;
  if (result.colors.length === 0) {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "No hay píxeles visibles con estos ajustes.";
    elements.swatches.append(text);
  }
  for (const color of result.colors.slice(0, MAX_VISIBLE_SWATCHES)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.title = `Copiar ${color.hex}`;
    button.setAttribute("aria-label", `Copiar color ${color.hex}, ${
      (color.coverage * 100).toFixed(1)}%`);
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
    coverage.textContent = `${(color.coverage * 100).toFixed(1)}% presencia`;
    details.append(hex, coverage);
    button.append(fill, details);
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(color.hex);
        showStatus(`${color.hex} copiado`);
      } catch {
        showStatus("No se pudo copiar. Usa la exportación de CSS.", true);
      }
    });
    elements.swatches.append(button);
  }
  if (result.colors.length > MAX_VISIBLE_SWATCHES) {
    const notice = document.createElement("p");
    notice.className = "swatch-notice";
    notice.textContent = `Mostrando ${MAX_VISIBLE_SWATCHES} de ${
      result.colors.length.toLocaleString("es-CL")} colores. ` +
      "Exporta JSON o CSS para obtenerlos todos.";
    elements.swatches.append(notice);
  }
  elements.summary.textContent = `${result.sampled_pixels.toLocaleString("es-CL")} píxeles ${
    result.mode === "exact" ? "contados" : "muestreados"} · ${
    result.mode === "exact" ? "Colores exactos" : "Cuantización RGB aproximada"}`;
  showStatus("Listo para exportar");
}

function analyze() {
  if (!state.pixels) return;
  const id = ++state.request;
  if (mode() === "exact" && state.sampledPreview) {
    state.result = null;
    elements.export.disabled = true;
    elements.swatches.replaceChildren();
    elements.countChip.textContent = "0";
    showStatus(
      "El modo Exacto requiere una imagen de 6 MP o menos.", true
    );
    return;
  }
  state.result = null;
  elements.swatches.replaceChildren();
  const progress = document.createElement("p");
  progress.className = "hint";
  progress.textContent = "Analizando la distribución cromática…";
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
    elements.export.disabled = true;
    showStatus(data.error, true);
  } else {
    renderPalette(data.result);
  }
};
worker.onerror = () => {
  state.result = null;
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
elements.drop.addEventListener("click", () => elements.input.click());
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
