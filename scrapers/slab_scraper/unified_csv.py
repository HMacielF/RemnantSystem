"""
Unified slab-scraper CSV schema.

Every supplier scraper should emit rows shaped like UnifiedSlabRecord so the
downstream import into the `slabs` table + its junction tables
(`slab_finishes`, `slab_colors`, `slab_thicknesses`) has a single stable
contract.

List-valued columns (thicknesses, finishes, colors, gallery URLs) use `;`
as the delimiter — the importer splits on `;`. Values that legitimately
contain a semicolon are escaped by collapsing whitespace around them; the
helpers below never emit a semicolon inside a list entry.

Supplier-specific fields that don't fit a named column go into
`extra_json` so nothing captured by the scraper is lost.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


CANONICAL_MATERIALS = {
    "quartz": "Quartz",
    "marble": "Marble",
    "granite": "Granite",
    "quartzite": "Quartzite",
    "soapstone": "Soapstone",
    "dolomite": "Dolomite",
    "porcelain": "Porcelain",
    "sintered": "Sintered",
    "limestone": "Limestone",
    "travertine": "Travertine",
    "onyx": "Onyx",
    "basalt": "Basalt",
}

CANONICAL_FINISHES = {
    "polished": "Polished",
    "honed": "Honed",
    "leathered": "Leathered",
    "leather": "Leathered",
    "brushed": "Brushed",
    "matte": "Matte",
    "natural": "Natural",
    "sandblasted": "Sandblasted",
    "sandblast": "Sandblasted",
    "flamed": "Flamed",
    "hammered": "Hammered",
    "textured": "Textured",
    "satin": "Satin",
    "silk": "Silk",
    "suede": "Suede",
    "glossy": "Glossy",
    "velvet": "Velvet",
    "concrete": "Concrete",
    "dual": "Dual",
    "rough": "Rough",
}


UNIFIED_FIELDS: tuple[str, ...] = (
    "supplier",
    "source_category",
    "name",
    "material",
    "brand",
    "collection",
    "sku",
    "block_number",
    "detail_url",
    "image_url",
    "gallery_image_urls",
    "width_in",
    "height_in",
    "size_text",
    "thickness_cm",
    "finishes",
    "primary_colors",
    "accent_colors",
    "color_tone",
    "scraped_at",
    "extra_json",
)


@dataclass
class UnifiedSlabRecord:
    supplier: str
    source_category: str
    name: str
    material: str
    detail_url: str
    scraped_at: str

    brand: str | None = None
    collection: str | None = None
    sku: str | None = None
    block_number: str | None = None
    image_url: str | None = None
    gallery_image_urls: str | None = None
    width_in: float | None = None
    height_in: float | None = None
    size_text: str | None = None
    thickness_cm: str | None = None
    finishes: str | None = None
    primary_colors: str | None = None
    accent_colors: str | None = None
    color_tone: str | None = None
    extra: dict = field(default_factory=dict)

    def to_csv_row(self) -> dict[str, str]:
        row = asdict(self)
        extra = row.pop("extra") or {}
        row["extra_json"] = json.dumps(extra, sort_keys=True, ensure_ascii=False) if extra else ""

        def stringify(key: str, value) -> str:
            if value is None:
                return ""
            # Numeric dimensions should render as ints when they have no
            # fractional part ("122.0" → "122", "72.5" → "72.5").
            if key in ("width_in", "height_in") and isinstance(value, (int, float)):
                return f"{value:g}"
            return str(value)

        return {key: stringify(key, row.get(key)) for key in UNIFIED_FIELDS}


# ─── Normalizers ──────────────────────────────────────────────────────────────

def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_material(raw: str | None) -> str:
    key = (raw or "").strip().lower()
    return CANONICAL_MATERIALS.get(key, (raw or "").strip() or "")


def join_list(values: Iterable[str] | None, dedupe: bool = True) -> str | None:
    if not values:
        return None
    cleaned = []
    seen = set()
    for value in values:
        text = str(value or "").strip().replace(";", ",")
        if not text:
            continue
        if dedupe:
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
        cleaned.append(text)
    return ";".join(cleaned) if cleaned else None


def canonical_finishes(values: Iterable[str] | None) -> str | None:
    if not values:
        return None
    out = []
    for raw in values:
        key = str(raw or "").strip().lower()
        if not key:
            continue
        out.append(CANONICAL_FINISHES.get(key, raw.strip()))
    return join_list(out)


def parse_thickness_to_cm(raw: str | None) -> str | None:
    """Parse a thickness string like '3cm', '3 CM', '30 mm', '0.6 CM' into a
    semicolon-joined cm-only list: '3', '0.6', '2;3'."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    out: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(cm|mm)", text, flags=re.IGNORECASE):
        value = float(match.group(1))
        unit = match.group(2).lower()
        cm = value / 10 if unit == "mm" else value
        formatted = f"{cm:g}"
        if formatted in seen:
            continue
        seen.add(formatted)
        out.append(formatted)

    if not out:
        # Fall back: a bare number like "3" → treat as cm.
        match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*$", text)
        if match:
            return f"{float(match.group(1)):g}"
        return None

    return ";".join(out)


DIMENSION_PAIR_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)", flags=re.IGNORECASE)
DIMENSION_CLUTTER_RE = re.compile(r"[\"″]|\b(?:W|L|H|in|inches)\b", flags=re.IGNORECASE)


def parse_dimensions_inches(raw: str | None) -> tuple[float | None, float | None]:
    """Return (width_in, height_in) parsed from common dimension strings.
    '138 x 79', '138\"W x 79\"L', '120 x 79 inches' → (138.0, 79.0).
    Strips quote/letter clutter (\", W, L, H, in, inches) before matching."""
    if not raw:
        return (None, None)
    cleaned = DIMENSION_CLUTTER_RE.sub("", str(raw))
    match = DIMENSION_PAIR_RE.search(cleaned)
    if not match:
        return (None, None)
    return (float(match.group(1)), float(match.group(2)))


# ─── Export ───────────────────────────────────────────────────────────────────

def export_unified_csv(
    records: Iterable[UnifiedSlabRecord],
    output_dir: Path,
    supplier: str,
    suffix: str | None = None,
) -> Path:
    """Write records to a timestamped CSV at
    {output_dir}/{supplier}[_{suffix}]_{timestamp}Z.csv and return the path."""
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    parts = [supplier]
    if suffix:
        parts.append(suffix)
    parts.append(stamp)
    filename = "_".join(parts) + ".csv"
    path = output_dir / filename

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=UNIFIED_FIELDS)
        writer.writeheader()
        for record in records:
            writer.writerow(record.to_csv_row())

    return path
