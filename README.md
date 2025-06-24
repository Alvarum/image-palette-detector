# Image Palette Detector

A fast, lightweight Python tool for extracting color palettes from images. Built for developers, pixel artists, and designers who need precise color data from their assets.

## What it does

This tool analyzes your images and extracts every unique color, then organizes them from darkest to lightest based on perceptual brightness. Perfect for game development, pixel art, and any project where you need to work with specific color sets.

## Features

- **Multiple format support** - Works with PNG, JPG, JPEG, and BMP images
- **Smart color extraction** - Gets only unique colors, no duplicates
- **Perceptual sorting** - Orders colors by how bright they appear to the human eye
- **Multiple export formats** - Outputs hex codes, RGB values, and CSS-ready strings
- **Visual palette preview** - Creates a BMP strip showing all extracted colors
- **Fast processing** - Uses multithreading to handle multiple images quickly
- **Cross-platform** - Runs on Windows, Linux, and macOS

## Installation

Clone the repository and install the single dependency:

```bash
git clone https://github.com/your-username/image-palette-detector
cd image-palette-detector
pip install pillow
```

## Usage

Put your images in the project folder and run:

```bash
python extract_palettes.py
```

The tool will process all supported images and create an `export/` folder with your results.

## Output

For each image (e.g., `sprite.png`), you get two files:

```
export/
├── sprite.json         # Color data in multiple formats
└── sprite_palette.bmp  # Visual palette as a horizontal strip
```

### JSON Structure

```json
{
  "filename": "sprite.png",
  "total_colors": 8,
  "palette": [
    {
      "hex": "#2d2d2d",
      "rgb": [45, 45, 45],
      "css": "rgb(45, 45, 45)"
    },
    {
      "hex": "#5a5a5a",
      "rgb": [90, 90, 90],
      "css": "rgb(90, 90, 90)"
    }
  ]
}
```

### BMP Preview

The BMP file is a 1-pixel tall horizontal strip where each pixel represents one color from your palette, ordered from dark to light. Import it directly into your art software or game engine.

## Requirements

- Python 3.7 or higher
- Pillow library

## Troubleshooting

**"Module not found" error?**
Make sure Pillow is installed: `pip install pillow`

**No output files?**
Check that your images are in PNG, JPG, JPEG, or BMP format and located in the same directory as the script.

**Need help?**
Open an issue on GitHub with details about your setup and the problem.

## License

Open source - use it however you want.

---

*Found this useful? Star the repo and share it with other developers.*
