"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
const app = readFileSync(join(__dirname, "app.js"), "utf8");

// Headings and empty states must explain the tool, not sell a metaphor.
test("the hero describes the extraction capability", () => {
  assert.match(
    html,
    /<h1 id="page-title">Extrae <em>paletas de color<\/em><\/h1>/,
  );
  assert.match(html, /Obtén colores dominantes o exactos/);
});

test("image upload instructions identify a concrete action", () => {
  assert.match(html, /<h3>Selecciona una imagen<\/h3>/);
  assert.match(html, /<button[^>]*id="browse">Seleccionar archivo/);
  assert.match(html, /Selecciona una imagen para extraer su paleta/);
});

test("privacy information describes local image processing", () => {
  assert.match(html, /Procesamiento local/);
  assert.match(html, /no se envían a ningún servidor/);
});

test("obsolete promotional phrases do not reappear", () => {
  const copy = `${html}\n${app}`;
  const slogans = [
    "Cada imagen tiene",
    "su propia voz",
    "Un mundo de colores",
    "Las mejores combinaciones aún están por descubrir",
    "Tu imagen se queda contigo",
    "Tu lienzo",
    "MADE TO MAKE COLORS MATTER",
    "Tu análisis",
  ];
  for (const slogan of slogans) {
    assert.equal(copy.includes(slogan), false, slogan);
  }
});
