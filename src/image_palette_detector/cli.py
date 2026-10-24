"""CLI for reproducible image palette extraction and export."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Sequence, cast

from .engine import extract_palette
from .exporters import SUPPORTED_FORMATS, Format, export_palette
from .models import (
    AlphaMode,
    ExtractOptions,
    Mode,
    PaletteError,
    RGB,
    SortMode,
)

EXTENSIONS = frozenset(
    {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tif", ".tiff"}
)


def _background(raw: str) -> RGB:
    """Parse a six-digit sRGB background into strict RGB channels."""
    code = raw.lstrip("#")
    if len(code) != 6 or any(c not in "0123456789abcdefABCDEF" for c in code):
        raise argparse.ArgumentTypeError("background must be #RRGGBB")
    return (int(code[:2], 16), int(code[2:4], 16), int(code[4:6], 16))


def _formats(raw: str) -> tuple[Format, ...]:
    """Parse comma-separated output formats without duplicate exports."""
    selected = tuple(
        dict.fromkeys(item.strip().lower() for item in raw.split(","))
    )
    if not selected or any(item not in SUPPORTED_FORMATS for item in selected):
        raise argparse.ArgumentTypeError(
            "formats must be comma-separated: " + ",".join(SUPPORTED_FORMATS)
        )
    return cast(tuple[Format, ...], selected)


def build_parser() -> argparse.ArgumentParser:
    """Construct the documented command-line interface."""
    parser = argparse.ArgumentParser(
        prog="palette-detector", description="Extract portable image palettes"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract", help="Analyze image(s)")
    extract.add_argument("inputs", nargs="+", type=Path)
    extract.add_argument("-o", "--output", type=Path, default=Path("export"))
    extract.add_argument("-r", "--recursive", action="store_true")
    extract.add_argument("--mode", choices=("exact", "dominant"),
                         default="dominant")
    extract.add_argument("--colors", type=int, default=8)
    extract.add_argument("--sort", choices=("frequency", "luminance", "hue"),
                         default="frequency")
    extract.add_argument(
        "--alpha", choices=("ignore", "composite", "preserve"),
        default="ignore",
    )
    extract.add_argument(
        "--background", type=_background, default=(255, 255, 255)
    )
    extract.add_argument("--formats", type=_formats, default=("json", "png"))
    extract.add_argument("--max-pixels", type=int, default=25_000_000)
    extract.add_argument("--max-unique", type=int, default=250_000)
    extract.add_argument("--sample-limit", type=int, default=100_000)
    extract.add_argument("-q", "--quiet", action="store_true")
    return parser


def _find_images(
    inputs: Sequence[Path], recursive: bool, output: Path
) -> list[Path]:
    """Expand paths deterministically without scanning unrelated outputs."""
    found: set[Path] = set()
    excluded = output.resolve()
    for entry in inputs:
        if entry.is_file() and entry.suffix.lower() in EXTENSIONS:
            candidate = entry.resolve()
            if not candidate.is_relative_to(excluded):
                found.add(candidate)
        elif entry.is_dir():
            files = entry.rglob("*") if recursive else entry.iterdir()
            for child in files:
                if child.is_file() and child.suffix.lower() in EXTENSIONS:
                    candidate = child.resolve()
                    if not candidate.is_relative_to(excluded):
                        found.add(candidate)
        else:
            raise PaletteError(
                f"Input does not exist or is unsupported: {entry}"
            )
    return sorted(found)


def _destination_name(path: Path, collisions: set[str]) -> str:
    """Disambiguate identical basenames without filesystem write races."""
    base = path.name
    if base not in collisions:
        collisions.add(base)
        return base
    digest = hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:10]
    unique = f"{path.stem}-{digest}{path.suffix}"
    collisions.add(unique)
    return unique


def main(argv: Sequence[str] | None = None) -> int:
    """Run extraction and return an observable shell exit code.

    :param argv: Optional arguments for tests or embedding.
    :returns: 0 on success, 1 for partial/complete processing failures,
        2 for invalid settings or inputs.
    """
    parser = build_parser()
    args = parser.parse_args(argv)
    options = ExtractOptions(
        mode=cast(Mode, args.mode),
        colors=args.colors,
        sort=cast(SortMode, args.sort),
        alpha=cast(AlphaMode, args.alpha),
        background=cast(RGB, args.background),
        max_pixels=args.max_pixels,
        max_unique=args.max_unique,
        sample_limit=args.sample_limit,
    )
    try:
        options.validate()
        paths = _find_images(args.inputs, args.recursive, args.output)
    except PaletteError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if not paths:
        print("error: no supported images found", file=sys.stderr)
        return 2

    # Reserve names before any write so overlapping inputs stay distinct.
    names: dict[Path, str] = {}
    reserved: set[str] = set()
    for path in paths:
        names[path] = _destination_name(path, reserved)
    failed = 0
    for path in paths:
        try:
            result = extract_palette(path, options)
            for file_format in args.formats:
                destination = (
                    args.output / f"{names[path]}.palette.{file_format}"
                )
                export_palette(result, destination, file_format)
            if not args.quiet:
                print(
                    f"{path.name}: {len(result.colors)} colors, "
                    f"{result.sampled_pixels} samples -> {args.output}"
                )
        except (PaletteError, OSError) as error:
            failed += 1
            print(f"error processing {path}: {error}", file=sys.stderr)
    if not args.quiet:
        print(f"Processed {len(paths) - failed}/{len(paths)} images")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
