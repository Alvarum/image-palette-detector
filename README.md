# image-palette-detector

**image-palette-detector** is a fast, multithreaded Python utility that extracts unique color palettes from images, ordered by perceptual brightness. It supports multiple export formats and generates both `.json` and `.bmp` files for each image.

Designed for developers, pixel artists, game creators, and anyone working with limited color sets (e.g., quantized or stylized assets).


## Features

- Supports `.png`, `.jpg`, `.jpeg`, and `.bmp` images
- Extracts **unique** colors only (no duplicates)
- Sorts palette by **perceptual luminosity** (dark → light)
- Exports a `.json` palette with:
  - Hexadecimal format
  - RGB tuples
  - CSS-compatible `rgb(r, g, b)` strings
- Creates a `.bmp` image with one pixel per palette color
- Runs in **parallel threads** for speed
- Fully compatible with **Windows** and **Linux**

## Output Example

For an input image like `tileset.png`, the output will be:

export/
├── tileset.json
└── tileset_palette.bmp

- The JSON includes all color formats.
- The BMP is a 1-pixel tall strip, each pixel representing a color in the palette.

---

## Requirements

- Python 3.7 or higher
- Pillow

Install it with:

```bash
pip install pillow

# Clone this repository
git clone https://github.com/your-username/image-palette-detector
cd image-palette-detector

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
.venv\Scripts\activate     # Windows

# Install dependencies
pip install pillow

# Place images in the same folder and run
python extract_palettes.py
