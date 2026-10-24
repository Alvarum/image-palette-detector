"""Deterministic image extraction with explicit alpha and memory limits."""

from __future__ import annotations

import colorsys
import math
import warnings
from collections import Counter
from pathlib import Path
from typing import Iterable, Iterator, cast

from PIL import Image, ImageOps, UnidentifiedImageError

from .models import (
    Color,
    ExtractOptions,
    PaletteColor,
    PaletteError,
    PaletteResult,
    RGB,
)


def _linear(channel: int) -> float:
    """Decode one sRGB channel to linear light (IEC 61966-2-1)."""
    scaled = channel / 255.0
    if scaled <= 0.04045:
        return scaled / 12.92
    return ((scaled + 0.055) / 1.055) ** 2.4


def _luminance(color: Color) -> float:
    """Compute linear-light relative luminance, ignoring alpha."""
    red, green, blue, _ = color
    return (
        0.2126 * _linear(red)
        + 0.7152 * _linear(green)
        + 0.0722 * _linear(blue)
    )


def _sort_key(
    swatch: PaletteColor, sort: str
) -> tuple[float, float, tuple[int, int, int, int]]:
    """Supply a stable tie-breaker independent of hash-table order."""
    rgba = swatch.rgba
    if sort == "luminance":
        return (_luminance(rgba), -swatch.count, rgba)
    if sort == "hue":
        hue, _, _ = colorsys.rgb_to_hsv(*(x / 255 for x in rgba[:3]))
        return (hue, -swatch.count, rgba)
    return (-float(swatch.count), _luminance(rgba), rgba)


def _composite(pixel: Color, background: RGB) -> Color:
    """Composite straight-alpha sRGB channels over an opaque background.

    This is an explicit visual preview policy, not linear-light compositing.
    """
    red, green, blue, alpha = pixel
    if alpha == 255:
        return (red, green, blue, 255)
    blend = alpha / 255.0
    return (
        round(red * blend + background[0] * (1.0 - blend)),
        round(green * blend + background[1] * (1.0 - blend)),
        round(blue * blend + background[2] * (1.0 - blend)),
        255,
    )


def _rgba_data(image: Image.Image) -> Iterable[Color]:
    """Use the current Pillow pixel iterator with a legacy fallback."""
    reader = getattr(image, "get_flattened_data", image.getdata)
    return cast(Iterable[Color], reader())


def _palette_indices(image: Image.Image) -> Iterable[int]:
    """Read indexed-image positions without Pillow deprecation warnings."""
    reader = getattr(image, "get_flattened_data", image.getdata)
    return cast(Iterable[int], reader())


def _pixels(
    image: Image.Image, options: ExtractOptions
) -> Iterator[Color]:
    """Yield considered pixels in scan order using constant extra memory."""
    # Image.convert ensures every sample follows the same RGBA layout.
    for original in _rgba_data(image):
        rgba = (original[0], original[1], original[2], original[3])
        if options.alpha == "preserve":
            yield rgba
        elif options.alpha == "composite":
            yield _composite(rgba, options.background)
        elif rgba[3] > 0:
            yield _composite(rgba, options.background)


def _exact(
    image: Image.Image, options: ExtractOptions
) -> tuple[tuple[PaletteColor, ...], int, int, int]:
    """Count exact pixels without copying an entire pixel list."""
    histogram: Counter[Color] = Counter()
    total = 0
    for color in _pixels(image, options):
        histogram[color] += 1
        total += 1
        if len(histogram) > options.max_unique:
            raise PaletteError(
                "Too many unique colors for exact mode "
                f"(limit: {options.max_unique}); try dominant"
            )
    swatches = tuple(
        PaletteColor(color, count, count / total)
        for color, count in histogram.items()
    ) if total else ()
    sorted_colors = tuple(
        sorted(swatches, key=lambda item: _sort_key(item, options.sort))
    )
    return (sorted_colors, total, total, len(histogram))


def _dominant(
    image: Image.Image, options: ExtractOptions
) -> tuple[tuple[PaletteColor, ...], int, int, None]:
    """Quantize evenly sampled source pixels via Pillow's median cut.

    Source-wide coverage is estimated by the deterministic sample, not by
    rescanning every source pixel against quantized centroids.
    """
    # Sampling by flattened index bounds the size of the quantizer input.
    source_pixels = image.width * image.height
    stride = max(1, math.ceil(source_pixels / options.sample_limit))
    samples: list[RGB] = []
    considered = 0
    for index, pixel in enumerate(_pixels_with_positions(image, options)):
        if pixel is None:
            continue
        considered += 1
        if index % stride == 0:
            samples.append(pixel[:3])
    if not samples:
        return ((), considered, 0, None)
    # A one-row RGB bitmap avoids a new full-resolution RGBA copy.
    small = Image.new("RGB", (len(samples), 1))
    small.putdata(samples)
    quantized = small.quantize(
        colors=options.colors,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    palette = quantized.getpalette()
    if palette is None:
        raise PaletteError("Quantization returned no color table")
    weights: Counter[int] = Counter(_palette_indices(quantized))
    by_rgba: Counter[Color] = Counter()
    for position, count in weights.items():
        offset = 3 * position
        rgba = (
            palette[offset],
            palette[offset + 1],
            palette[offset + 2],
            255,
        )
        by_rgba[rgba] += count
    total_sampled = len(samples)
    swatches = tuple(
        PaletteColor(color, count, count / total_sampled)
        for color, count in by_rgba.items()
    )
    return (
        tuple(sorted(swatches, key=lambda s: _sort_key(s, options.sort))),
        considered,
        total_sampled,
        None,
    )


def _pixels_with_positions(
    image: Image.Image, options: ExtractOptions
) -> Iterator[Color | None]:
    """Keep skipped alpha samples in the original sampling grid."""
    for original in _rgba_data(image):
        rgba = (original[0], original[1], original[2], original[3])
        if options.alpha == "ignore" and rgba[3] == 0:
            yield None
        else:
            yield _composite(rgba, options.background)


def extract_palette(
    path: str | Path, options: ExtractOptions | None = None
) -> PaletteResult:
    """Extract one image into a reusable, JSON-serializable palette.

    :param path: Image path readable by Pillow.
    :param options: Extraction settings. Defaults to 8 dominant colors.
    :returns: PaletteResult with sampled/exact provenance.
    :raises PaletteError: On unsafe input, invalid settings or decode errors.
    """
    recipe = options if options is not None else ExtractOptions()
    recipe.validate()
    source = Path(path)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as opened:
                width, height = opened.size
                if width * height > recipe.max_pixels:
                    raise PaletteError(
                        f"Image exceeds {recipe.max_pixels} pixel limit"
                    )
                # Correct EXIF orientation before reporting dimensions.
                with ImageOps.exif_transpose(opened) as oriented:
                    with oriented.convert("RGBA") as image:
                        if recipe.mode == "exact":
                            colors, considered, sampled, unique = _exact(
                                image, recipe
                            )
                        else:
                            colors, considered, sampled, unique = _dominant(
                                image, recipe
                            )
                        return PaletteResult(
                            source=source.name,
                            width=image.width,
                            height=image.height,
                            considered_pixels=considered,
                            sampled_pixels=sampled,
                            unique_colors=unique,
                            colors=colors,
                            options=recipe,
                        )
    except (
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as error:
        raise PaletteError(f"Cannot decode {source.name}: {error}") from error
