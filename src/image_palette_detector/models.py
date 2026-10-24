"""Public, versioned data models for image palette extraction."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal, TypeAlias

Color: TypeAlias = tuple[int, int, int, int]
RGB: TypeAlias = tuple[int, int, int]
Mode: TypeAlias = Literal["exact", "dominant"]
AlphaMode: TypeAlias = Literal["ignore", "preserve", "composite"]
SortMode: TypeAlias = Literal["frequency", "luminance", "hue"]


class PaletteError(ValueError):
    """Describe a safe, user-facing image processing failure."""


@dataclass(frozen=True, slots=True)
class ExtractOptions:
    """Configure deterministic extraction behavior.

    :param mode: Preserve exact RGBA colors or quantize RGB samples.
    :param colors: Maximum representative colors in dominant mode.
    :param alpha: Preserve RGBA, ignore invisible pixels, or composite.
    :param background: Background RGB used for alpha composition.
    :param sort: Stable ordering of output swatches.
    :param max_pixels: Safety limit on decoded image dimensions.
    :param max_unique: Safety limit on exact distinct RGBA values.
    :param sample_limit: Maximum processed sample count in dominant mode.
    """

    mode: Mode = "dominant"
    colors: int = 8
    alpha: AlphaMode = "ignore"
    background: RGB = (255, 255, 255)
    sort: SortMode = "frequency"
    max_pixels: int = 25_000_000
    max_unique: int = 250_000
    sample_limit: int = 100_000

    def validate(self) -> None:
        """Reject invalid options before decoding an image.

        :raises PaletteError: If a setting is unsafe or inconsistent.
        """
        if self.mode not in ("exact", "dominant"):
            raise PaletteError(f"Unknown extraction mode: {self.mode}")
        if self.alpha not in ("ignore", "preserve", "composite"):
            raise PaletteError(f"Unknown alpha policy: {self.alpha}")
        if self.sort not in ("frequency", "luminance", "hue"):
            raise PaletteError(f"Unknown sort order: {self.sort}")
        if self.mode == "dominant" and self.alpha == "preserve":
            raise PaletteError("Alpha preserve requires --mode exact")
        if not 1 <= self.colors <= 256:
            raise PaletteError("--colors must be between 1 and 256")
        if any(not 0 <= value <= 255 for value in self.background):
            raise PaletteError("Background channels must be in [0, 255]")
        if min(self.max_pixels, self.max_unique, self.sample_limit) <= 0:
            raise PaletteError("Processing limits must be positive")


@dataclass(frozen=True, slots=True)
class PaletteColor:
    """A swatch and its importance in the analyzed pixels.

    :param rgba: Eight-bit, straight-alpha RGBA color.
    :param count: Source pixels (exact) or representative samples.
    :param coverage: Fraction of considered pixels or samples, 0 to 1.
    """

    rgba: Color
    count: int
    coverage: float

    @property
    def hex(self) -> str:
        """Return CSS-compatible RGB or RGBA hexadecimal notation."""
        red, green, blue, alpha = self.rgba
        text = f"#{red:02X}{green:02X}{blue:02X}"
        return text if alpha == 255 else f"{text}{alpha:02X}"

    @property
    def css(self) -> str:
        """Return an explicit CSS color without rounding alpha."""
        red, green, blue, alpha = self.rgba
        return f"rgb({red} {green} {blue} / {alpha / 255:.4f})"

    def to_dict(self) -> dict[str, object]:
        """Serialize one swatch to portable JSON primitives."""
        return {
            "hex": self.hex,
            "rgb": list(self.rgba[:3]),
            "rgba": list(self.rgba),
            "css": self.css,
            "count": self.count,
            "coverage": round(self.coverage, 6),
        }


@dataclass(frozen=True, slots=True)
class PaletteResult:
    """Deterministic, versioned output of one image analysis.

    :param source: Display name of the input image, not its absolute path.
    :param width: Decoded width after EXIF orientation.
    :param height: Decoded height after EXIF orientation.
    :param considered_pixels: Pixels retained after alpha handling.
    :param sampled_pixels: Pixels contributing to color frequencies.
    :param unique_colors: Exact count in exact mode; null in dominant.
    :param colors: Swatches sorted according to extraction options.
    :param options: The complete extraction recipe.
    """

    source: str
    width: int
    height: int
    considered_pixels: int
    sampled_pixels: int
    unique_colors: int | None
    colors: tuple[PaletteColor, ...]
    options: ExtractOptions

    def to_dict(self) -> dict[str, object]:
        """Return JSON-compatible data under schema version 1."""
        return {
            "schema_version": 1,
            "source": self.source,
            "width": self.width,
            "height": self.height,
            "total_pixels": self.width * self.height,
            "considered_pixels": self.considered_pixels,
            "sampled_pixels": self.sampled_pixels,
            "unique_colors": self.unique_colors,
            "mode": self.options.mode,
            "options": asdict(self.options),
            "colors": [color.to_dict() for color in self.colors],
        }
