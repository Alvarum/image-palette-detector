"""Legacy convenience entry point; prefer ``palette-detector extract``."""

import sys

from image_palette_detector.cli import main

if __name__ == "__main__":
    arguments = sys.argv[1:] or ["extract", "."]
    raise SystemExit(main(arguments))
