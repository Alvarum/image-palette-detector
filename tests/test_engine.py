"""Contract tests for accurate, deterministic palette extraction."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from image_palette_detector import (
    ExtractOptions,
    PaletteError,
    extract_palette,
)


def _image(path: Path, pixels: list[tuple[int, int, int, int]]) -> Path:
    """Write a synthetic one-row RGBA image for independent assertions."""
    with Image.new("RGBA", (len(pixels), 1)) as img:
        img.putdata(pixels)
        img.save(path)
    return path


def test_exact_preserves_counts_and_sort(tmp_path: Path) -> None:
    """A repeat must contribute more coverage than a singleton."""
    red = (255, 0, 0, 255)
    blue = (0, 0, 255, 255)
    path = _image(tmp_path / "sprite.png", [red, blue, red, red])
    result = extract_palette(path, ExtractOptions(mode="exact"))
    assert result.unique_colors == 2
    assert result.considered_pixels == 4
    assert result.sampled_pixels == 4
    assert [(color.rgba, color.count) for color in result.colors] == [
        (red, 3), (blue, 1)
    ]
    assert [color.coverage for color in result.colors] == [0.75, 0.25]
    assert result.to_dict()["schema_version"] == 1


def test_alpha_policies(tmp_path: Path) -> None:
    """Hidden colors are ignored unless alpha preservation is requested."""
    path = _image(
        tmp_path / "alpha.png",
        [(255, 0, 0, 0), (0, 0, 255, 128), (0, 0, 0, 255)],
    )
    ignored = extract_palette(path, ExtractOptions(mode="exact"))
    assert ignored.considered_pixels == 2
    assert ignored.colors[0].rgba == (0, 0, 0, 255)
    preserved = extract_palette(
        path, ExtractOptions(mode="exact", alpha="preserve")
    )
    assert preserved.considered_pixels == 3
    assert any(c.rgba == (255, 0, 0, 0) for c in preserved.colors)
    assert any(c.rgba == (0, 0, 255, 128) for c in preserved.colors)
    composite = extract_palette(
        path, ExtractOptions(mode="exact", alpha="composite")
    )
    assert composite.considered_pixels == 3
    assert any(c.rgba == (255, 255, 255, 255) for c in composite.colors)


def test_transparent_image_is_empty_in_ignore_mode(tmp_path: Path) -> None:
    """Fully transparent images report no invented palette colors."""
    path = _image(tmp_path / "empty.png", [(1, 2, 3, 0)] * 4)
    assert extract_palette(path).colors == ()
    assert extract_palette(path).considered_pixels == 0


def test_dominant_bounds_and_coverage(tmp_path: Path) -> None:
    """Median-cut quantization produces at most the requested N colors."""
    pixels = [(0, 0, 0, 255)] * 75 + [(255, 255, 255, 255)] * 25
    path = _image(tmp_path / "mostly-black.png", pixels)
    result = extract_palette(path, ExtractOptions(colors=2))
    assert len(result.colors) == 2
    assert result.sampled_pixels == 100
    assert sum(color.count for color in result.colors) == 100
    assert abs(sum(color.coverage for color in result.colors) - 1) < 1e-8
    assert result.colors[0].count == 75


def test_options_and_invalid_image_errors(tmp_path: Path) -> None:
    """Misconfiguration and nonimages fail with user-facing exceptions."""
    with pytest.raises(PaletteError, match="requires --mode exact"):
        ExtractOptions(alpha="preserve").validate()
    with pytest.raises(PaletteError, match="between 1 and 256"):
        ExtractOptions(colors=0).validate()
    bad = tmp_path / "broken.png"
    bad.write_bytes(b"not really a png")
    with pytest.raises(PaletteError, match="Cannot decode"):
        extract_palette(bad)


def test_limits_and_determinism(tmp_path: Path) -> None:
    """Resource limits reject unsafe workloads and JSON remains stable."""
    pixels = [(r, 0, 0, 255) for r in range(10)]
    path = _image(tmp_path / "colors.png", pixels)
    with pytest.raises(PaletteError, match="pixel limit"):
        extract_palette(path, ExtractOptions(max_pixels=5))
    with pytest.raises(PaletteError, match="Too many unique"):
        extract_palette(path, ExtractOptions(mode="exact", max_unique=3))
    left = extract_palette(path, ExtractOptions(mode="exact"))
    right = extract_palette(path, ExtractOptions(mode="exact"))
    assert json.dumps(left.to_dict()) == json.dumps(right.to_dict())


def test_indexed_and_grayscale(tmp_path: Path) -> None:
    """Non-RGB modes are normalized without dropping their pixel colors."""
    for mode in ("P", "L"):
        path = tmp_path / f"test-{mode}.png"
        with Image.new(mode, (2, 1)) as image:
            image.putdata([0, 255] if mode == "L" else [0, 1])
            if mode == "P":
                image.putpalette([0, 0, 0, 255, 0, 0])
            image.save(path)
        result = extract_palette(path, ExtractOptions(mode="exact"))
        assert result.unique_colors == 2


def test_sampling_is_bounded(tmp_path: Path) -> None:
    """Dominant mode uses a sample rather than a full-resolution copy."""
    path = _image(tmp_path / "long.png", [(255, 0, 0, 255)] * 1000)
    result = extract_palette(path, ExtractOptions(sample_limit=20))
    assert result.considered_pixels == 1000
    assert result.sampled_pixels <= 20


def test_alpha_sampling_does_not_discard_rare_visible_pixels(
    tmp_path: Path,
) -> None:
    """Sampling may not select only discarded transparent pixels."""
    hidden = (250, 10, 10, 0)
    visible = (0, 200, 80, 255)
    path = _image(tmp_path / "mostly-hidden.png", [hidden] * 99 + [visible])
    result = extract_palette(path, ExtractOptions(sample_limit=1))
    assert result.considered_pixels == 1
    assert result.sampled_pixels == 1
    assert result.colors[0].rgba == visible
