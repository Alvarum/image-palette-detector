"""Public Python API for Image Palette Detector."""

from .engine import extract_palette
from .models import ExtractOptions, PaletteColor, PaletteError, PaletteResult

__all__ = [
    "ExtractOptions",
    "PaletteColor",
    "PaletteError",
    "PaletteResult",
    "extract_palette",
]
