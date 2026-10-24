# Image Palette Detector: convenciones de desarrollo

## Microcopy y diseño de contenido

La interfaz de `studio/` usa español directo, técnico y natural.

- **Titulares:** describir la función real de la herramienta. Por ejemplo,
  «Extrae paletas de color», no metáforas sobre las imágenes.
- **Subtítulos:** explicar qué hace el producto y qué recibe el usuario.
  Mantenerlos breves, precisos y comprobables en el código.
- **Controles:** utilizar verbos y objetos concretos («Seleccionar archivo»,
  «Exportar»), sin lemas publicitarios ni adornos innecesarios.
- **Estados vacíos:** indicar qué falta y la siguiente acción disponible.
- **Estados de progreso y error:** describir la operación y cómo recuperarse
  cuando corresponda. No esconder limitaciones técnicas.
- **Privacidad:** describir literalmente el procesamiento en el navegador.
  Evitar promesas absolutas, vagas o imposibles de verificar.
- **Tono:** evitar frases inspiracionales, lugares comunes, personificación,
  adjetivos grandilocuentes, slogans en inglés y posesivos decorativos
  («tu lienzo», «tu análisis») donde una etiqueta funcional sea más útil.
- **Composición:** evitar titulares enormes que quiebren arbitrariamente
  en escritorio o que releguen la herramienta bajo la primera pantalla.

No agregar frases nuevas al Studio sin revisar primero estas normas.
Conservar accesibilidad, textos alternativos y etiquetas de controles.

## Validación local

- `node --test studio/*.test.js`
- `node --check studio/app.js && node --check studio/worker.js`
- `python -m pytest -q`
- Si hay cambios visuales, comprobar 320px, 390px, 1440px y 2560px.

Registrar regresiones como issues, implementar sobre una rama y revisar el
PR antes de fusionar. No asumir que las pruebas remotas están disponibles.
