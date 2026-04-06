"""
Analyze slab images and suggest primary/accent colors.

Why this exists:
- Some suppliers do not provide structured primary/accent colors.
- We still want a fast, repeatable way to enrich slab records.

What it does:
- Accepts a single image URL/path or a JSON/CSV file with image URLs
- Uses Pillow's adaptive palette to estimate dominant colors
- Maps sampled RGB values to human-friendly color labels
- Suggests:
  - primary colors
  - accent colors
  - color tone

This is meant to accelerate review, not replace human judgment.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

import requests
import colorgram
from colorthief import ColorThief
from PIL import Image
from PIL import ImageEnhance
from PIL import ImageOps


DEFAULT_IMAGE_FIELD = "image_url"
DEFAULT_NAME_FIELD = "name"
DEFAULT_OUTPUT_DIR = Path("scripts/output")
MAX_PALETTE_COLORS = 8
MIN_COLOR_SHARE = 0.045
MIN_ACCENT_SHARE = 0.025
REQUEST_TIMEOUT_SEC = 30


@dataclass(frozen=True)
class NamedColor:
    name: str
    rgb: tuple[int, int, int]


PALETTE = [
    NamedColor("White", (245, 245, 245)),
    NamedColor("Cream", (235, 226, 204)),
    NamedColor("Beige", (214, 192, 158)),
    NamedColor("Taupe", (145, 126, 107)),
    NamedColor("Blonde", (214, 183, 110)),
    NamedColor("Gold", (193, 149, 37)),
    NamedColor("Yellow", (220, 189, 59)),
    NamedColor("Orange", (200, 118, 47)),
    NamedColor("Pink", (200, 140, 150)),
    NamedColor("Red", (165, 53, 46)),
    NamedColor("Brown", (110, 73, 49)),
    NamedColor("Gray-Light", (198, 198, 198)),
    NamedColor("Gray-Dark", (97, 97, 97)),
    NamedColor("Black", (34, 34, 34)),
    NamedColor("Green", (87, 133, 86)),
    NamedColor("Teal", (59, 126, 126)),
    NamedColor("Blue", (74, 116, 187)),
    NamedColor("Navy", (41, 68, 120)),
    NamedColor("Purple", (110, 82, 142)),
]

NEUTRAL_NAMES = {"White", "Gray-Light", "Gray-Dark", "Black"}
LIGHT_NEUTRAL_NAMES = {"White", "Gray-Light"}
DARK_NEUTRAL_NAMES = {"Gray-Dark", "Black"}
WARM_NAMES = {"Cream", "Beige", "Taupe", "Blonde", "Gold", "Yellow", "Orange", "Brown", "Red", "Pink"}
CHROMATIC_NAMES = {"Blue", "Navy", "Green", "Purple", "Gold", "Yellow", "Orange", "Red", "Pink", "Brown", "Beige", "Cream", "Taupe", "Blonde"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Suggest slab primary and accent colors from slab images.")
    parser.add_argument("--image-url", help="Analyze a single remote image URL.")
    parser.add_argument("--image-path", help="Analyze a single local image path.")
    parser.add_argument("--input-json", help="Analyze every row in a JSON file.")
    parser.add_argument("--input-csv", help="Analyze every row in a CSV file.")
    parser.add_argument(
        "--engine",
        choices=["adaptive", "colorgram", "colorthief", "combined"],
        default="combined",
        help="Color extraction engine to use.",
    )
    parser.add_argument("--image-field", default=DEFAULT_IMAGE_FIELD, help="Field containing the image URL/path.")
    parser.add_argument("--name-field", default=DEFAULT_NAME_FIELD, help="Field used as the display name in batch mode.")
    parser.add_argument(
        "--output",
        help="Optional explicit output file. If omitted in batch mode, a sibling *_color_analysis file is written.",
    )
    parser.add_argument(
        "--review-output",
        help="Optional explicit review CSV path. If omitted in batch mode, a sibling *_color_review.csv file is written.",
    )
    return parser.parse_args()


def is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def load_image_from_source(source: str) -> Image.Image:
    if is_url(source):
        response = requests.get(source, timeout=REQUEST_TIMEOUT_SEC)
        response.raise_for_status()
        return Image.open(io.BytesIO(response.content)).convert("RGB")
    return Image.open(source).convert("RGB")


def resize_for_analysis(image: Image.Image) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= 512:
        return image
    scale = 512 / longest
    return image.resize((max(1, int(width * scale)), max(1, int(height * scale))))


def normalize_for_analysis(image: Image.Image) -> Image.Image:
    working = resize_for_analysis(image)
    # Lift contrast and color a bit so dark blue stones do not collapse into
    # flat black during palette quantization.
    working = ImageOps.autocontrast(working, cutoff=1)
    working = ImageEnhance.Color(working).enhance(1.2)
    working = ImageEnhance.Contrast(working).enhance(1.1)
    return working


def sample_palette(image: Image.Image, palette_size: int = MAX_PALETTE_COLORS) -> list[tuple[tuple[int, int, int], float]]:
    working = normalize_for_analysis(image)
    quantized = working.convert("P", palette=Image.Palette.ADAPTIVE, colors=palette_size)
    histogram = quantized.histogram()
    raw_palette = quantized.getpalette()
    total = sum(histogram)
    samples: list[tuple[tuple[int, int, int], float]] = []
    if not total or raw_palette is None:
        return samples

    for index, count in sorted(enumerate(histogram), key=lambda item: item[1], reverse=True):
        if count <= 0:
            continue
        base = index * 3
        rgb = tuple(raw_palette[base:base + 3])
        if len(rgb) != 3:
            continue
        samples.append(((int(rgb[0]), int(rgb[1]), int(rgb[2])), count / total))
    return samples


def sample_palette_colorgram(image: Image.Image, palette_size: int = MAX_PALETTE_COLORS) -> list[tuple[tuple[int, int, int], float]]:
    working = normalize_for_analysis(image)
    extracted = colorgram.extract(working, palette_size)
    total = sum(item.proportion for item in extracted)
    if not total:
        return []
    return [
        ((item.rgb.r, item.rgb.g, item.rgb.b), float(item.proportion) / float(total))
        for item in extracted
    ]


def sample_palette_colorthief(image: Image.Image, palette_size: int = MAX_PALETTE_COLORS) -> list[tuple[tuple[int, int, int], float]]:
    working = normalize_for_analysis(image)
    buffer = io.BytesIO()
    working.save(buffer, format="PNG")
    buffer.seek(0)
    thief = ColorThief(buffer)
    palette = thief.get_palette(color_count=palette_size, quality=1)
    if not palette:
        return []
    share = 1 / len(palette)
    return [(tuple(map(int, rgb)), share) for rgb in palette]


def rgb_to_hsv(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = [channel / 255 for channel in rgb]
    maximum = max(r, g, b)
    minimum = min(r, g, b)
    delta = maximum - minimum

    if delta == 0:
        hue = 0.0
    elif maximum == r:
        hue = ((g - b) / delta) % 6
    elif maximum == g:
        hue = (b - r) / delta + 2
    else:
        hue = (r - g) / delta + 4
    hue *= 60

    saturation = 0.0 if maximum == 0 else delta / maximum
    value = maximum
    return hue, saturation, value


def distance(rgb_a: tuple[int, int, int], rgb_b: tuple[int, int, int]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb_a, rgb_b)))


def classify_neutral(rgb: tuple[int, int, int], saturation: float, value: float) -> str | None:
    if value <= 0.24 and saturation >= 0.12:
        return None
    if value >= 0.9 and saturation <= 0.16:
        return "White"
    if value >= 0.74 and saturation <= 0.18:
        return "Gray-Light"
    if value <= 0.2:
        return "Black"
    if saturation <= 0.16:
        return "Gray-Dark"
    return None


def nearest_named_color(rgb: tuple[int, int, int]) -> str:
    hue, saturation, value = rgb_to_hsv(rgb)
    neutral = classify_neutral(rgb, saturation, value)
    if neutral:
        return neutral

    # Prefer more intuitive slab-family colors before generic nearest-color matching.
    if 205 <= hue <= 255 and saturation >= 0.08:
        return "Navy" if value <= 0.5 else "Blue"
    if 185 <= hue <= 255 and saturation >= 0.12:
        return "Navy" if value <= 0.42 else "Blue"
    if 70 <= hue < 175 and saturation >= 0.16:
        return "Green"

    # Warm off-whites and beige veins often look "pink" numerically but read as
    # white/cream/taupe in stone slabs. Keep pink for clearly saturated material.
    if (hue <= 20 or hue >= 330) and saturation < 0.28:
        if value >= 0.82:
            return "White"
        if value >= 0.68:
            return "Cream"
        return "Taupe"
    if 20 < hue < 50 and saturation < 0.3:
        return "Cream" if value >= 0.72 else "Taupe"

    best = min(PALETTE, key=lambda item: distance(rgb, item.rgb))
    return best.name


def merge_named_shares(samples: Iterable[tuple[tuple[int, int, int], float]]) -> list[tuple[str, float]]:
    shares: dict[str, float] = {}
    for rgb, share in samples:
        name = nearest_named_color(rgb)
        shares[name] = shares.get(name, 0.0) + share
    return sorted(shares.items(), key=lambda item: item[1], reverse=True)


def infer_color_tone(named_shares: list[tuple[str, float]]) -> str | None:
    cool_names = {"White", "Gray-Light", "Gray-Dark", "Black", "Blue", "Navy", "Green", "Purple"}
    warm = sum(share for name, share in named_shares if name in WARM_NAMES)
    cool = sum(share for name, share in named_shares if name in cool_names)

    if warm >= 0.22 and cool >= 0.22 and abs(warm - cool) <= 0.18:
        return "Mixed - Cool & Warm"
    if warm > cool:
        return "Warm"
    if cool > warm:
        return "Cool"
    return None


def normalize_catalog_color(name: str) -> str:
    if name == "Navy":
        return "Blue"
    return name


def select_primary_and_accent(named_shares: list[tuple[str, float]]) -> tuple[list[str], list[str]]:
    filtered = [(name, share) for name, share in named_shares if share >= MIN_ACCENT_SHARE]
    if not filtered:
        return [], []

    normalized_shares: dict[str, float] = {}
    for name, share in filtered:
        normalized_name = normalize_catalog_color(name)
        normalized_shares[normalized_name] = normalized_shares.get(normalized_name, 0.0) + share

    ordered = sorted(normalized_shares.items(), key=lambda item: item[1], reverse=True)
    light_share = sum(share for name, share in ordered if name in LIGHT_NEUTRAL_NAMES)
    dark_share = sum(share for name, share in ordered if name in DARK_NEUTRAL_NAMES)
    chromatic = [(name, share) for name, share in ordered if name in CHROMATIC_NAMES]

    primary = ordered[0][0]
    if light_share >= 0.42:
        primary = "White"
    elif dark_share >= 0.5:
        primary = "Black"
    elif chromatic and chromatic[0][1] >= 0.12:
        primary = chromatic[0][0]

    accents: list[str] = []
    if primary == "White":
        preferred = ["Gray-Light", "Gray-Dark", "Black", "Blue", "Gold", "Brown"]
    elif primary == "Black":
        preferred = ["White", "Gray-Light", "Blue", "Gray-Dark"]
    else:
        preferred = ["White", "Gray-Light", "Gray-Dark", "Black", "Gold", "Brown"]

    for name in preferred:
        if name != primary and normalized_shares.get(name, 0.0) >= MIN_ACCENT_SHARE and name not in accents:
            accents.append(name)
        if len(accents) >= 3:
            break

    for name, _share in ordered:
        if name == primary or name in accents:
            continue
        accents.append(name)
        if len(accents) >= 3:
            break

    return [primary], accents[:3]


def analyze_from_named_shares(source: str, named_shares: list[tuple[str, float]], engine: str) -> dict[str, object]:
    primary_colors, accent_colors = select_primary_and_accent(named_shares)
    review_candidates = [name for name, _share in named_shares[:5]]

    return {
        "source": source,
        "engine": engine,
        "primary_colors": primary_colors,
        "accent_colors": accent_colors,
        "review_candidates": review_candidates,
        "color_tone": infer_color_tone(named_shares),
        "palette_breakdown": [
            {"name": name, "share": round(share, 4)}
            for name, share in named_shares
        ],
    }


def combine_named_shares(*named_share_lists: list[tuple[str, float]]) -> list[tuple[str, float]]:
    shares: dict[str, float] = {}
    for share_list in named_share_lists:
        for name, share in share_list:
            normalized_name = normalize_catalog_color(name)
            shares[normalized_name] = shares.get(normalized_name, 0.0) + share
    if not shares:
        return []
    divisor = max(1, len(named_share_lists))
    combined = [(name, share / divisor) for name, share in shares.items()]
    return sorted(combined, key=lambda item: item[1], reverse=True)


def analyze_image(source: str, engine: str = "combined") -> dict[str, object]:
    image = load_image_from_source(source)
    adaptive_named_shares = merge_named_shares(sample_palette(image))
    if engine == "adaptive":
        return analyze_from_named_shares(source, adaptive_named_shares, engine)

    colorgram_named_shares = merge_named_shares(sample_palette_colorgram(image))
    if engine == "colorgram":
        return analyze_from_named_shares(source, colorgram_named_shares, engine)

    colorthief_named_shares = merge_named_shares(sample_palette_colorthief(image))
    if engine == "colorthief":
        return analyze_from_named_shares(source, colorthief_named_shares, engine)

    combined_named_shares = combine_named_shares(adaptive_named_shares, colorgram_named_shares, colorthief_named_shares)
    result = analyze_from_named_shares(source, combined_named_shares, engine)
    result["engine_breakdown"] = {
        "adaptive": [{"name": name, "share": round(share, 4)} for name, share in adaptive_named_shares],
        "colorgram": [{"name": name, "share": round(share, 4)} for name, share in colorgram_named_shares],
        "colorthief": [{"name": name, "share": round(share, 4)} for name, share in colorthief_named_shares],
    }
    return result


def load_batch_rows(args: argparse.Namespace) -> tuple[list[dict[str, object]], str]:
    if args.input_json:
        path = Path(args.input_json)
        rows = json.loads(path.read_text(encoding="utf-8"))
        return [dict(row) for row in rows], "json"
    if args.input_csv:
        path = Path(args.input_csv)
        with path.open("r", newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle)), "csv"
    raise ValueError("Batch mode requires --input-json or --input-csv")


def derive_output_path(args: argparse.Namespace, input_kind: str, input_path: str) -> Path:
    if args.output:
        return Path(args.output)
    path = Path(input_path)
    suffix = ".json" if input_kind == "json" else ".csv"
    return path.with_name(f"{path.stem}_color_analysis{suffix}")


def derive_review_output_path(args: argparse.Namespace, input_path: str) -> Path:
    if args.review_output:
        return Path(args.review_output)
    path = Path(input_path)
    return path.with_name(f"{path.stem}_color_review.csv")


def write_batch_output(rows: list[dict[str, object]], output_path: Path, input_kind: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if input_kind == "json":
        output_path.write_text(json.dumps(rows, indent=2, ensure_ascii=True), encoding="utf-8")
        return

    fieldnames: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def review_priority(row: dict[str, object]) -> str:
    if row.get("color_analysis_error"):
        return "error"
    disagreement = int(row.get("predicted_engine_disagreement_count") or 0)
    if disagreement >= 2:
        return "high"
    if disagreement == 1:
        return "medium"
    return "low"


def write_review_output(rows: list[dict[str, object]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    review_rows = []
    for row in rows:
        review_rows.append(
            {
                "review_priority": review_priority(row),
                "name": row.get("name", ""),
                "image_url": row.get("image_url", ""),
                "detail_url": row.get("detail_url", ""),
                "predicted_primary_colors": row.get("predicted_primary_colors", ""),
                "predicted_accent_colors": row.get("predicted_accent_colors", ""),
                "predicted_color_tone": row.get("predicted_color_tone", ""),
                "predicted_review_candidates": row.get("predicted_review_candidates", ""),
                "predicted_engine_disagreement_count": row.get("predicted_engine_disagreement_count", ""),
                "adaptive_primary": row.get("predicted_adaptive_primary", ""),
                "colorgram_primary": row.get("predicted_colorgram_primary", ""),
                "colorthief_primary": row.get("predicted_colorthief_primary", ""),
                "color_analysis_error": row.get("color_analysis_error", ""),
            }
        )

    priority_rank = {"error": 0, "high": 1, "medium": 2, "low": 3}
    review_rows.sort(key=lambda item: (priority_rank.get(str(item["review_priority"]), 9), str(item["name"])))

    fieldnames = list(review_rows[0].keys()) if review_rows else [
        "review_priority",
        "name",
        "image_url",
        "detail_url",
        "predicted_primary_colors",
        "predicted_accent_colors",
        "predicted_color_tone",
        "predicted_review_candidates",
        "predicted_engine_disagreement_count",
        "adaptive_primary",
        "colorgram_primary",
        "colorthief_primary",
        "color_analysis_error",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(review_rows)


def batch_analyze(args: argparse.Namespace) -> None:
    rows, input_kind = load_batch_rows(args)
    input_path = args.input_json or args.input_csv
    output_path = derive_output_path(args, input_kind, input_path)
    review_output_path = derive_review_output_path(args, input_path)
    analyzed_rows: list[dict[str, object]] = []

    for index, row in enumerate(rows, start=1):
        image_source = str(row.get(args.image_field) or "").strip()
        name = str(row.get(args.name_field) or f"row-{index}").strip()
        result = {
            **row,
            "predicted_primary_colors": "",
            "predicted_accent_colors": "",
            "predicted_color_tone": "",
            "predicted_review_candidates": "",
            "predicted_engine_disagreement_count": "",
            "predicted_adaptive_primary": "",
            "predicted_colorgram_primary": "",
            "predicted_colorthief_primary": "",
            "predicted_palette_breakdown": "",
            "color_analysis_error": "",
        }

        if not image_source:
            result["color_analysis_error"] = "missing image source"
            analyzed_rows.append(result)
            continue

        try:
            analysis = analyze_image(image_source, engine=args.engine)
            result["predicted_primary_colors"] = ", ".join(analysis["primary_colors"])
            result["predicted_accent_colors"] = ", ".join(analysis["accent_colors"])
            result["predicted_color_tone"] = analysis["color_tone"] or ""
            result["predicted_review_candidates"] = ", ".join(analysis.get("review_candidates", []))
            result["predicted_palette_breakdown"] = json.dumps(analysis["palette_breakdown"], ensure_ascii=True)
            engine_breakdown = analysis.get("engine_breakdown") or {}
            adaptive_primary = ((engine_breakdown.get("adaptive") or [{}])[0] or {}).get("name", "")
            colorgram_primary = ((engine_breakdown.get("colorgram") or [{}])[0] or {}).get("name", "")
            colorthief_primary = ((engine_breakdown.get("colorthief") or [{}])[0] or {}).get("name", "")
            result["predicted_adaptive_primary"] = normalize_catalog_color(str(adaptive_primary)) if adaptive_primary else ""
            result["predicted_colorgram_primary"] = normalize_catalog_color(str(colorgram_primary)) if colorgram_primary else ""
            result["predicted_colorthief_primary"] = normalize_catalog_color(str(colorthief_primary)) if colorthief_primary else ""
            engine_primaries = {
                value for value in [
                    result["predicted_adaptive_primary"],
                    result["predicted_colorgram_primary"],
                    result["predicted_colorthief_primary"],
                ] if value
            }
            result["predicted_engine_disagreement_count"] = max(0, len(engine_primaries) - 1)
            print(f"[{index}/{len(rows)}] analyzed {name}")
        except Exception as error:
            result["color_analysis_error"] = str(error)
            print(f"[{index}/{len(rows)}] failed {name}: {error}")

        analyzed_rows.append(result)

    write_batch_output(analyzed_rows, output_path, input_kind)
    write_review_output(analyzed_rows, review_output_path)
    print(f"Wrote color analysis output to {output_path}")
    print(f"Wrote color review output to {review_output_path}")


def single_analyze(args: argparse.Namespace) -> None:
    source = args.image_url or args.image_path
    if not source:
        raise ValueError("Single-image mode requires --image-url or --image-path")
    analysis = analyze_image(source, engine=args.engine)
    print(json.dumps(analysis, indent=2, ensure_ascii=True))


def main() -> None:
    args = parse_args()
    if args.image_url or args.image_path:
        single_analyze(args)
        return

    if args.input_json or args.input_csv:
        batch_analyze(args)
        return

    raise ValueError("Provide either a single image source or a batch input file.")


if __name__ == "__main__":
    main()
