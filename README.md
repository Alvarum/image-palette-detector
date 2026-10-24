# Image Palette Detector

A local-first color tool for artists, pixel artists and developers. Extract
useful dominant colors from a photograph, inspect **exact RGBA colors** in a
sprite, and export reproducible palettes for code or visual work.

**Version:** 0.2.0, first implementation of the 2.0 roadmap. Not all roadmap
features are ready yet. [Issues and future work](https://github.com/Alvarum/image-palette-detector/issues/1).

## Try it in your browser (no image uploads)

```bash
python -m http.server 8000 --directory studio
```

Then open <http://localhost:8000>. The Studio processes selected images in
your browser. It does **not** send them to a server; it uses the browser's
Canvas and a Web Worker. The Python web server serves only static files.

- Click, drag-and-drop or paste an image into the Studio.
- Switch **Dominant** (representative palette) or **Exact** (unique colors).
- Pick your swatch count (Dominant), sorting and transparency policy.
- Click a swatch to copy its HEX. Export JSON, CSS, SVG, GPL or PNG.
- The Studio and Python CLI share core JSON fields (their option objects
  differ). Dominant quantizers
  differ (weighted median-cut vs Pillow median-cut), so their colors may
  differ slightly. Exact Studio mode operates on browser-decoded Canvas
  pixels and may not preserve invisible RGB data or exact semi-transparent
  channels (Canvas can premultiply alpha). For lossless RGBA inspection,
  use the Python CLI with `--alpha preserve`.

No accounts, uploads, tracking scripts, external fonts or build tools.
Currently the Studio isn't installable offline: serve the files locally or
host it as a static website. The preview is capped at 6 million pixels and
Exact mode at 200,000 distinct colors to prevent browser lockups.

## Install the CLI

Requires Python **3.11+** and Pillow **10+**.

```bash
git clone https://github.com/Alvarum/image-palette-detector.git
cd image-palette-detector
python -m pip install -e .
palette-detector --help
```

Process one image:

```bash
palette-detector extract picture.png --colors 8 --formats json,png,css
```

Analyze sprites without altering their alpha channel:

```bash
palette-detector extract ./sprites --recursive --mode exact \
  --alpha preserve --sort frequency --formats json,png
```

Analyze images on a light background and export for GIMP:

```bash
palette-detector extract illustration.webp --mode dominant \
  --colors 12 --background '#FAFAFA' --formats json,svg,gpl
```

Windows PowerShell uses backticks instead of backslashes for multiline
commands. All commands can be entered on one line.

The output directory is `export/` by default. Names include the original
extension, e.g. `picture.png.palette.json`, avoiding PNG/JPG collisions. You
can configure it using `--output ./palettes`.

Run the module with `python -m image_palette_detector extract ...`. The
legacy `python main.py` command also works after installation and analyzes
the current directory if called without arguments.

## Extraction modes and transparency

| Mode | Behavior | Recommended use |
|---|---|---|
| `dominant` (default) | Representative, weighted median-cut colors from up to 100,000 evenly spaced samples | Photos, illustrations, UI mood boards |
| `exact` | Exact histogram of all *considered* RGBA pixels | Sprites, tilesets, indexed images |

Transparency policies:

- `ignore` (default): skip fully transparent pixels, composite partially
  transparent pixels over the specified background.
- `preserve`: retain original RGBA, including hidden RGB of fully transparent
  pixels; only available with `exact`.
- `composite`: include every pixel, composited over the background.

The default is white (`#FFFFFF`). EXIF rotation is honored. Embedded ICC
profiles are not color-managed in this release; images are interpreted as
sRGB after Pillow conversion. To preserve fidelity in pixel art, use
`--mode exact --alpha preserve`.

The `count` and `coverage` fields represent source pixels in exact mode and
**samples** in dominant mode. Consequently dominant coverage is an estimate,
not a precise segmentation map. Extraction is deterministic for a given
Pillow version, settings, file and sampling method.

Safety defaults: 25 million source pixels, 250,000 unique exact colors and
100,000 dominant samples. The limits can be adjusted via `--max-pixels`,
`--max-unique`, and `--sample-limit` if you understand the memory cost.

## Exports

| Format | Purpose |
|---|---|
| `json` | Versioned results, counts, coverage, dimensions and settings |
| `png` | Swatch grid, preserving RGB alpha |
| `svg` | Vector swatch grid |
| `css` | CSS custom properties `--palette-001` etc. |
| `gpl` | Standard GIMP/Aseprite-compatible RGB palette (no alpha) |

Schema version 1, abbreviated:

```json
{
  "schema_version": 1,
  "source": "sprite.png",
  "width": 2,
  "height": 2,
  "total_pixels": 4,
  "considered_pixels": 4,
  "sampled_pixels": 4,
  "unique_colors": 2,
  "mode": "exact",
  "options": {"mode": "exact", "alpha": "preserve"},
  "colors": [
    {
      "hex": "#FF0000",
      "rgb": [255, 0, 0],
      "rgba": [255, 0, 0, 255],
      "css": "rgb(255 0 0 / 1.0000)",
      "count": 3,
      "coverage": 0.75
    }
  ]
}
```

The object above is illustrative; the full `options` object contains other
settings and the complete `colors` array contains all returned swatches.

## Python API

```python
from image_palette_detector import ExtractOptions, extract_palette

palette = extract_palette("picture.png", ExtractOptions(colors=8))
for swatch in palette.colors:
    print(swatch.hex, swatch.coverage)
```

## Quality checks

```bash
python -m pip install -e '.[dev]'
pytest -q
ruff check .
mypy src
node --test studio/worker.test.js
```

No GitHub Actions quota is required for local validation. Bugs or feature
suggestions belong in [GitHub Issues](https://github.com/Alvarum/image-palette-detector/issues).

## License

A distribution license has **not** been selected. The repository is public,
but public visibility does not grant permission to redistribute or reuse its
source code. The owner must select and add a license before broader reuse.
