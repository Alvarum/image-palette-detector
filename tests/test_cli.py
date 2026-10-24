"""End-to-end CLI and output-format regression tests."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from image_palette_detector.cli import main


def _save(path: Path, color: tuple[int, int, int, int]) -> Path:
    """Build a small legal test image without external fixtures."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with Image.new("RGBA", (2, 2), color) as image:
        image.save(path)
    return path


def test_cli_exports_all_formats(tmp_path: Path) -> None:
    """A documented invocation exports parseable files and returns zero."""
    image = _save(tmp_path / "tiny.png", (10, 20, 30, 255))
    output = tmp_path / "output"
    result = main([
        "extract", str(image), "--mode", "exact", "-o", str(output),
        "--formats", "json,png,svg,css,gpl",
    ])
    assert result == 0
    assert json.loads((output / "tiny.png.palette.json").read_text())[
        "schema_version"
    ] == 1
    assert (output / "tiny.png.palette.png").is_file()
    assert "<svg" in (output / "tiny.png.palette.svg").read_text()
    assert "--palette-001: #0A141E" in (
        output / "tiny.png.palette.css"
    ).read_text()
    assert "GIMP Palette" in (output / "tiny.png.palette.gpl").read_text()


def test_cli_input_failure_is_nonzero(tmp_path: Path) -> None:
    """Bad path errors are distinct from decoded image errors."""
    assert main(["extract", str(tmp_path / "missing.png")]) == 2
    bad = tmp_path / "broken.png"
    bad.write_bytes(b"broken")
    assert main(["extract", str(bad)]) == 1


def test_two_formats_same_stem_do_not_collide(tmp_path: Path) -> None:
    """Two distinct source extensions must not overwrite each other."""
    with Image.new("RGB", (2, 1), (2, 3, 4)) as png:
        png.save(tmp_path / "same.png")
        png.save(tmp_path / "same.jpg")
    output = tmp_path / "export"
    assert main(["extract", str(tmp_path), "-o", str(output)]) == 0
    assert (output / "same.png.palette.json").is_file()
    assert (output / "same.jpg.palette.json").is_file()


def test_preserve_alpha_gpl_is_clear_error(tmp_path: Path) -> None:
    """Reject unsupported transparency rather than exporting wrong colors."""
    image = _save(tmp_path / "semitransparent.png", (10, 20, 30, 100))
    assert main([
        "extract", str(image), "--mode", "exact", "--alpha",
        "preserve", "--formats", "gpl", "-o", str(tmp_path / "out"),
    ]) == 1


def test_recursive_scan_skips_prior_output(tmp_path: Path) -> None:
    """Prior exported images must not become new source images."""
    _save(tmp_path / "source.png", (15, 15, 15, 255))
    output = tmp_path / "export"
    args = ["extract", str(tmp_path), "--recursive", "-o", str(output)]
    assert main(args) == 0
    assert main(args) == 0
    assert len(list(output.glob("*.palette.json"))) == 1
