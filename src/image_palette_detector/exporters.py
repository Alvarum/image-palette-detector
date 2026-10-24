"""Portable palette exporters; image previews have explicit size limits."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, TypeAlias
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw

from .models import PaletteError, PaletteResult

Format: TypeAlias = Literal["json", "css", "svg", "png", "gpl"]
SUPPORTED_FORMATS: tuple[Format, ...] = (
    "json", "css", "svg", "png", "gpl"
)
MAX_PREVIEW_COLORS = 4096


def _preview_dimensions(count: int) -> tuple[int, int, int]:
    """Return bounded columns, width and height of the swatch grid."""
    if count > MAX_PREVIEW_COLORS:
        raise PaletteError(
            f"Preview exceeds {MAX_PREVIEW_COLORS} colors; "
            "use JSON or CSS instead"
        )
    columns = min(12, max(1, count))
    rows = max(1, (count + columns - 1) // columns)
    return (columns, columns * 72, rows * 72)


def _css(result: PaletteResult) -> str:
    """Render zero-padded custom properties that retain palette order."""
    lines = [":root {"]
    for index, color in enumerate(result.colors, 1):
        lines.append(f"  --palette-{index:03d}: {color.hex};")
    return "\n".join([*lines, "}", ""])


def _svg(result: PaletteResult) -> str:
    """Render a standalone swatch grid using escaped SVG attributes."""
    count = len(result.colors)
    columns, width, height = _preview_dimensions(count)
    cells = []
    for index, color in enumerate(result.colors):
        x_position = (index % columns) * 72
        y_position = (index // columns) * 72
        cells.append(
            f'<rect x="{x_position}" y="{y_position}" '
            f'width="72" height="72" fill="{escape(color.hex)}"/>'
        )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        + "\n".join(cells)
        + "\n</svg>\n"
    )


def _png(result: PaletteResult, destination: Path) -> None:
    """Write swatches onto a transparent grid without external fonts."""
    columns, width, height = _preview_dimensions(len(result.colors))
    with Image.new("RGBA", (width, height), (0, 0, 0, 0)) as image:
        draw = ImageDraw.Draw(image)
        for index, color in enumerate(result.colors):
            x_position = (index % columns) * 72
            y_position = (index // columns) * 72
            draw.rectangle(
                (
                    x_position,
                    y_position,
                    x_position + 71,
                    y_position + 71,
                ),
                fill=color.rgba,
            )
        image.save(destination, format="PNG")


def _gpl(result: PaletteResult) -> str:
    """Render standard opaque GIMP palette, rejecting lossy RGBA."""
    if any(color.rgba[3] != 255 for color in result.colors):
        raise PaletteError(
            "GPL cannot retain transparency; use JSON, CSS or PNG"
        )
    lines = ["GIMP Palette", f"Name: {result.source}", "Columns: 8", "#"]
    for color in result.colors:
        red, green, blue = color.rgba[:3]
        lines.append(f"{red:3d} {green:3d} {blue:3d}\t{color.hex}")
    return "\n".join([*lines, ""])


def export_palette(
    result: PaletteResult, destination: Path, file_format: Format
) -> Path:
    """Export a finished extraction without changing its underlying order.

    :param result: Versioned extraction result.
    :param destination: Exact output path (parent may not yet exist).
    :param file_format: One of JSON, CSS, SVG, PNG or GIMP Palette.
    :returns: The output path.
    :raises PaletteError: If requested format loses unsupported data.
    """
    if file_format not in SUPPORTED_FORMATS:
        raise PaletteError(f"Unsupported output format: {file_format}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if file_format == "png":
        _png(result, destination)
    else:
        content = {
            "json": lambda: json.dumps(
                result.to_dict(), indent=2, ensure_ascii=False
            ) + "\n",
            "css": lambda: _css(result),
            "svg": lambda: _svg(result),
            "gpl": lambda: _gpl(result),
        }[file_format]()
        # Write a sibling temp file first to avoid replacing valid data
        # with a partial result when an export is interrupted.
        temporary = destination.with_name(destination.name + ".tmp")
        try:
            temporary.write_text(content, encoding="utf-8")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    return destination
