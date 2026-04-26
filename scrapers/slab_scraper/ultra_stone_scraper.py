"""
Ultra Stone slab inventory scraper.

Scope:
- Extract the public Stone Profits item gallery for Ultra Stone
- Normalize the API payload into review-friendly JSON/CSV exports
- Keep the first pass product-based to match the upstream gallery behavior
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

try:
    from .unified_csv import (
        UnifiedSlabRecord,
        canonical_finishes,
        canonical_material,
        export_unified_csv,
        iso_now,
        parse_thickness_to_cm,
    )
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from unified_csv import (  # type: ignore
        UnifiedSlabRecord,
        canonical_finishes,
        canonical_material,
        export_unified_csv,
        iso_now,
        parse_thickness_to_cm,
    )


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


CATALOG_BASE_URL = "https://ultrastonesweb.stoneprofits.com"
API_URL = "https://ultrastones.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx"
AUTH_TOKEN = "N9TAY8J0ln3blUE0pjoSbTrGBxdsBPn+YQi2WUFCYxAvCYwY6v0QGHhZtv3a04plQqVmzUXhIU6crN6v"
WEBCONNECT_SETTING_ID = "1"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/ultra_stone")
DEFAULT_TIMEOUT_SEC = 60
ENGINEERED_MATERIALS = {"Quartz", "Porcelain Slabs", "Porcelain Tile", "Glass", "Unknown"}
SUPPORTED_DB_MATERIALS = {
    "Dolomite",
    "Dolomitic Marble",
    "Granite",
    "Hard Marble",
    "Marble",
    "Mineral",
    "Onyx",
    "Other",
    "Porcelain",
    "Printed Quartz",
    "Quartz",
    "Quartzite",
    "Soapstone",
}
FINISH_OVERRIDES_BY_ITEM_ID = {
    2030: "Polished, Leathered",
}


@dataclass
class UltraStoneRecord:
    record_key: str
    item_id: int
    name: str
    detail_url: str
    image_url: str | None
    material: str
    brand: str | None
    category: str
    subcategory: str | None
    color: str | None
    finish: str | None
    thickness: str | None
    origin: str | None
    product_group: str | None
    kind: str | None
    sku: str | None
    width_in: float | None
    height_in: float | None
    available_qty: float | None
    available_slabs: int | None
    block_number: str | None
    location: str | None
    filename: str | None
    inventory_filename: str | None
    raw_item_json: str
    raw_inventory_json: str | None


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def as_optional_float(value: Any) -> float | None:
    if value in (None, "", "null"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_optional_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def smart_title_token(token: str) -> str:
    raw = clean_text(token)
    if not raw:
        return ""
    letters = re.sub(r"[^A-Za-z]", "", raw)
    if letters and letters == letters.upper() and len(letters) <= 3:
        return raw.upper()
    lowered = raw.lower()
    lowered = re.sub(r"(^|[\(\[\/\-])([a-z])", lambda match: f"{match.group(1)}{match.group(2).upper()}", lowered)
    lowered = re.sub(r"(^|['’])([a-z])", lambda match: f"{match.group(1)}{match.group(2).upper()}", lowered)
    lowered = re.sub(r"\(([a-z]{1,4})\)", lambda match: f"({match.group(1).upper()})", lowered)
    return lowered


def normalize_name_case(value: str | None) -> str:
    return " ".join(smart_title_token(token) for token in clean_text(value).split()).strip()


def normalize_material(value: str | None) -> str:
    normalized = normalize_name_case(value)
    return normalized or "Unknown"


def normalize_thickness(value: str | None) -> str | None:
    cleaned = clean_text(value)
    if not cleaned:
        return None
    cleaned = cleaned.replace("CM", " CM").replace("MM", " MM")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"(?i)^(\d+(?:\.\d+)?)\s*cm$", r"\1 CM", cleaned)
    cleaned = re.sub(r"(?i)^(\d+(?:\.\d+)?)\s*mm$", r"\1 MM", cleaned)
    return cleaned


def finish_variants(finish: str | None) -> list[str]:
    tokens = [normalize_name_case(part) for part in clean_text(finish).split(",")]
    tokens = [token for token in tokens if token]
    variants: set[str] = set()
    replacements = {
        "Polished": ["Pol", "POL"],
        "Honed": ["Hon", "HON"],
        "Leather": ["Lt", "LT"],
        "Leathered": ["Leather", "Lt", "LT"],
        "Leather/Honed": ["Lt/Hon", "LT/HON", "Hon/Lt", "HON/LT"],
        "Polished/Honed": ["Pol/Hon", "POL/HON"],
        "Polished/Leathered": ["Pol/Lt", "POL/LT", "Lt/Pol", "Leather/Polished"],
    }
    for cleaned in tokens:
        local_variants = {cleaned}
        compact = cleaned.replace(" ", "")
        spaced = re.sub(r"(?i)(\d)(CM|MM)\b", r"\1 \2", cleaned)
        local_variants.add(compact)
        local_variants.add(spaced)
        for key, extras in replacements.items():
            if cleaned.lower() == key.lower():
                local_variants.update(extras)
        variants.update(v for v in local_variants if v)
    return [v for v in variants if v]


def infer_finish_from_name(name: str, current_finish: str | None) -> str | None:
    if current_finish:
        return current_finish
    cleaned = normalize_name_case(name)
    lowered = cleaned.lower()
    if "dual" in lowered and ("/lt" in lowered or "/leather" in lowered or "polished/leather" in lowered or "polish leather" in lowered):
        return "Polished, Leathered"
    if "dual" in lowered and ("/hon" in lowered or "/honed" in lowered or "pol/hon" in lowered or "polished/honed" in lowered):
        return "Polished, Honed"
    if lowered.endswith("/lt") or lowered.endswith("/leather"):
        return "Leather"
    if lowered.endswith("/hon") or lowered.endswith("/honed"):
        return "Honed"
    if lowered.endswith("/pol") or lowered.endswith("/polished"):
        return "Polished"
    if lowered.endswith("/flammed"):
        return "Flammed"
    return current_finish


def normalize_finish_value(value: str | None) -> str | None:
    cleaned = normalize_name_case(value)
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered == "dual finish polished/leather":
        return "Polished, Leathered"
    if lowered == "dual finish pol/hon":
        return "Polished, Honed"
    if lowered == "leather":
        return "Leathered"
    return cleaned


def normalize_stone_name(name: str, thickness: str | None, finish: str | None) -> str:
    normalized = normalize_name_case(name)
    if not normalized:
        return normalized

    patterns: list[str] = []
    if thickness:
        t = re.escape(thickness)
        t_compact = re.escape(thickness.replace(" ", ""))
        patterns.extend([rf"\s+{t}\b", rf"\s+{t_compact}\b"])
    for variant in finish_variants(finish):
        patterns.append(rf"\s+{re.escape(variant)}\b")
    patterns.extend(
        [
            r"\s+\d+(?:\.\d+)?\s*CM\b",
            r"\s+\d+(?:\.\d+)?\s*MM\b",
            r"\s+(?:Polished|Honed|Leathered|Leather|Brushed|Matt|Matte|Pol|Hon|Lt)\b",
            r"\s+Dual\s+Finish\s+(?:Pol/Hon|Polished/Leather|Pol/Lt|Lt/Pol)\b",
            r"/(?:Polished|Honed|Leathered|Leather|Brushed|Matt|Matte|Pol|Hon|Lt|Flammed)\b",
            r"\s*-\s*Dual\s+Fins?i?h?\s*/?(?:Pol|Lt|Hon)\b",
            r"\s+Dual(?:\s+Finish)?/(?:(?:Polished|Leather|Honed|Pol|Lt|Hon))\b",
            r"\s+Dual\s+Finish/?(?:(?:Polished|Leather|Honed|Pol|Lt|Hon))\b",
        ]
    )
    changed = True
    while changed:
        changed = False
        for pattern in patterns:
            updated = re.sub(pattern, "", normalized, flags=re.IGNORECASE).strip(" -/")
            if updated != normalized:
                normalized = normalize_name_case(updated)
                changed = True
    return normalized


def slugify_name(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", clean_text(value)).strip("-")
    return slug or "item"


def build_detail_url(item_id: int, name: str) -> str:
    slug = slugify_name(name)
    return f"{CATALOG_BASE_URL}/#/InventoryItemDetail/{slug}/{item_id}"


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "Authorization": AUTH_TOKEN,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; UltraStoneScraper/1.0)",
        }
    )
    return session


def api_get(session: requests.Session, timeout_sec: int, **params: str) -> Any:
    response = session.get(API_URL, params=params, timeout=timeout_sec)
    response.raise_for_status()
    return response.json()


def api_post(
    session: requests.Session,
    timeout_sec: int,
    params: dict[str, str],
    payload: dict[str, Any],
) -> Any:
    response = session.post(API_URL, params=params, data=json.dumps(payload), timeout=timeout_sec)
    response.raise_for_status()
    return response.json()


def api_get_list(session: requests.Session, timeout_sec: int, **params: str) -> list[dict[str, Any]]:
    payload = api_get(session, timeout_sec, **params)
    if not isinstance(payload, list):
        raise RuntimeError(f"Expected list response for params={params!r}")
    return payload


def fetch_settings(session: requests.Session, timeout_sec: int) -> dict[str, Any]:
    payload = api_get(
        session,
        timeout_sec,
        act="getSettings",
        WebconnectSettingID=WEBCONNECT_SETTING_ID,
        q="1",
    )
    if not payload:
        raise RuntimeError("Ultra Stone settings response was empty")
    return payload[0]


def fetch_search_details(session: requests.Session, timeout_sec: int) -> list[dict[str, Any]]:
    payload = api_get(
        session,
        timeout_sec,
        act="getAllSearchDetails",
        WebconnectSettingID=WEBCONNECT_SETTING_ID,
        q="1",
    )
    if not isinstance(payload, list):
        raise RuntimeError("Ultra Stone search-details response was not a list")
    return payload


def fetch_item_rows(session: requests.Session, timeout_sec: int, settings: dict[str, Any]) -> list[dict[str, Any]]:
    params = {
        "act": "getItemGallery",
        "WebconnectSettingID": WEBCONNECT_SETTING_ID,
        "InventoryGroupBy": (clean_text(settings.get("GroupInventoryBy")) or "IDONE,").replace(",", "_"),
        "SearchbyItemIdentifiers": clean_text(settings.get("SearchbyItemIdentifiers")),
        "ShowFeatureProductOnTop": clean_text(settings.get("ShowFeatureProductsOnTop")),
        "OnHold": clean_text(settings.get("IncludeInventoryOnHold")),
        "OnSO": clean_text(settings.get("IncludeInventoryOnSO")),
        "Intransit": clean_text(settings.get("IncludeInventoryOnTransfer")),
        "showNotInStock": clean_text(settings.get("IncludeProductsNotinStock")),
        "SearchbyFinish": "on",
        "SearchbySKU": clean_text(settings.get("SearchbySKU")),
        "Alphabet": "",
        "q": "1",
    }
    payload = {
        "ItemName": "",
        "Location": "All",
        "Type": "All",
        "Category": "All",
        "Thickness": "All",
        "Finish": "All",
        "Group": "All",
        "Color": "All",
        "PriceRange": "All",
        "Origin": "All",
        "Kind": "All",
        "SubCategory": "All",
        "SlabOptions": "All",
        "SaleOptions": "All",
        "AvailableOptions": "All",
        "AvgCurrentAvailableQty": "",
        "AvgCurrentSlabLength": "",
        "AvgCurrentSlabWidth": "",
        "AvailableSlabs": "",
    }
    rows = api_post(session, timeout_sec, params=params, payload=payload)
    if not isinstance(rows, list):
        raise RuntimeError("Ultra Stone item-gallery response was not a list")
    return rows


def fetch_item_inventory_rows(
    session: requests.Session,
    timeout_sec: int,
    settings: dict[str, Any],
    item_id: int,
) -> list[dict[str, Any]]:
    return api_get_list(
        session,
        timeout_sec,
        act="getItemInventory",
        WebconnectSettingID=WEBCONNECT_SETTING_ID,
        id=str(item_id),
        InventoryGroupBy=(clean_text(settings.get("GroupInventoryBy")) or "IDONE,").replace(",", "_"),
        TrimmedUserID="123456789",
        OnHold=clean_text(settings.get("IncludeInventoryOnHold")),
        OnSO=clean_text(settings.get("IncludeInventoryOnSO")),
        Intransit=clean_text(settings.get("IncludeInventoryOnTransfer")),
        SelctdLocation="",
        ShowLocationinGallery=clean_text(settings.get("ShowLocationinGallery")),
        LotPicturesRestrictToSIPL=clean_text(settings.get("LotPictures_RestrictToSIPL")),
        q="1",
        DetailLocation="",
    )


def build_lookup(search_details: list[dict[str, Any]], option_name: str) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for row in search_details:
        if clean_text(row.get("SearchOption")) != option_name:
            continue
        value_id = clean_text(row.get("ID"))
        value = normalize_name_case(row.get("Value"))
        if value_id and value:
            lookup[value_id] = value
    return lookup


def resolve_lookup(lookup: dict[str, str], value_id: Any, fallback: Any = None) -> str | None:
    key = clean_text(value_id)
    if key and key in lookup:
        return lookup[key]
    fallback_text = normalize_name_case(fallback)
    return fallback_text or None


def build_image_url(file_base: str, filename: str | None) -> str | None:
    cleaned = clean_text(filename)
    if not cleaned:
        return None
    return f"{file_base}{cleaned}"


def pick_inventory_image_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    def score(row: dict[str, Any]) -> tuple[int, float, float]:
        return (
            1 if clean_text(row.get("FileName")) else 0,
            as_optional_float(row.get("AvailableSlabs")) or 0.0,
            as_optional_float(row.get("AvailableQty")) or 0.0,
        )
    return max(rows, key=score)


def dedupe_item_rows(item_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[int, dict[str, Any]] = {}
    for row in item_rows:
        item_id = as_optional_int(row.get("ItemID"))
        if item_id is None:
            continue
        existing = deduped.get(item_id)
        current_score = (
            1 if clean_text(row.get("Filename")) else 0,
            1 if clean_text(row.get("CategoryName")) else 0,
            1 if clean_text(row.get("SubCategory")) else 0,
        )
        existing_score = (
            1 if existing and clean_text(existing.get("Filename")) else 0,
            1 if existing and clean_text(existing.get("CategoryName")) else 0,
            1 if existing and clean_text(existing.get("SubCategory")) else 0,
        ) if existing else (-1, -1, -1)
        if existing is None or current_score > existing_score:
            deduped[item_id] = row
    return list(deduped.values())


def should_expand_to_inventory_rows(material: str) -> bool:
    return material not in ENGINEERED_MATERIALS


def dedupe_inventory_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (
            clean_text(row.get("IDTwo")),
            clean_text(row.get("FileName")),
            clean_text(row.get("Location")),
        )
        existing = deduped.get(key)
        current_score = (
            1 if clean_text(row.get("FileName")) else 0,
            as_optional_float(row.get("AvailableSlabs")) or 0.0,
            as_optional_float(row.get("AvailableQty")) or 0.0,
        )
        existing_score = (
            1 if existing and clean_text(existing.get("FileName")) else 0,
            as_optional_float(existing.get("AvailableSlabs")) or 0.0,
            as_optional_float(existing.get("AvailableQty")) or 0.0,
        ) if existing else (-1, -1.0, -1.0)
        if existing is None or current_score > existing_score:
            deduped[key] = row
    return list(deduped.values())


def normalize_record(
    item_row: dict[str, Any],
    file_base: str,
    finish_lookup: dict[str, str],
    origin_lookup: dict[str, str],
    inventory_row: dict[str, Any] | None,
) -> UltraStoneRecord | None:
    item_id = as_optional_int(item_row.get("ItemID"))
    if item_id is None:
        return None

    raw_name = clean_text(item_row.get("ItemName"))
    category = normalize_name_case(item_row.get("CategoryName"))
    subcategory = normalize_name_case(item_row.get("SubCategory")) or None
    material = normalize_material(category)
    finish = normalize_finish_value(resolve_lookup(finish_lookup, item_row.get("Finish")))
    if item_id in FINISH_OVERRIDES_BY_ITEM_ID:
        finish = FINISH_OVERRIDES_BY_ITEM_ID[item_id]
    finish = infer_finish_from_name(raw_name, finish)
    finish = normalize_finish_value(finish)
    thickness = normalize_thickness(
        f"{clean_text(item_row.get('Thickness'))} {clean_text(item_row.get('ThicknessUOM'))}".strip()
    )
    name = normalize_stone_name(raw_name, thickness, finish) or f"Item {item_id}"
    filename = clean_text(item_row.get("Filename")) or None
    inventory_filename = clean_text((inventory_row or {}).get("FileName")) or None
    prefers_inventory_image = should_expand_to_inventory_rows(material)
    image_url = (
        build_image_url(file_base, inventory_filename) or build_image_url(file_base, filename)
        if prefers_inventory_image
        else build_image_url(file_base, filename) or build_image_url(file_base, inventory_filename)
    )
    block_number = clean_text((inventory_row or {}).get("IDTwo")) or None
    location = clean_text((inventory_row or {}).get("Location")) or None
    record_key = f"item:{item_id}"
    if block_number or inventory_filename:
        record_key = f"item:{item_id}|block:{block_number}|image:{inventory_filename}"

    return UltraStoneRecord(
        record_key=record_key,
        item_id=item_id,
        name=name,
        detail_url=build_detail_url(item_id, raw_name or name),
        image_url=image_url,
        material=material,
        brand=None,
        category=category,
        subcategory=subcategory,
        color=normalize_name_case(item_row.get("Color")) or None,
        finish=finish,
        thickness=thickness,
        origin=resolve_lookup(origin_lookup, item_row.get("OriginID"), item_row.get("Origin")),
        product_group=normalize_name_case(item_row.get("ProductGroup")) or None,
        kind=normalize_name_case(item_row.get("Kind")) or None,
        sku=clean_text(item_row.get("SKU")) or None,
        width_in=as_optional_float(item_row.get("AvgCurrentSlabWidth")),
        height_in=as_optional_float(item_row.get("AvgCurrentSlabLength")),
        available_qty=as_optional_float(item_row.get("AvgCurrentAvailableQty")),
        available_slabs=as_optional_int(item_row.get("AvailableSlabs")),
        block_number=block_number,
        location=location,
        filename=filename,
        inventory_filename=inventory_filename,
        raw_item_json=json.dumps(item_row, separators=(",", ":"), ensure_ascii=True),
        raw_inventory_json=(
            json.dumps(inventory_row, separators=(",", ":"), ensure_ascii=True) if inventory_row is not None else None
        ),
    )


def export_records(records: list[UltraStoneRecord], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump([asdict(record) for record in records], fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def export_csv(records: list[UltraStoneRecord], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(asdict(records[0]).keys()) if records else list(UltraStoneRecord.__annotations__.keys())
    with output_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(asdict(record))


def to_unified(record: UltraStoneRecord, scraped_at: str) -> UnifiedSlabRecord:
    extra = {
        "item_id": record.item_id,
        "category": record.category,
        "subcategory": record.subcategory,
        "origin": record.origin,
        "product_group": record.product_group,
        "kind": record.kind,
        "location": record.location,
        "available_qty": record.available_qty,
        "available_slabs": record.available_slabs,
    }
    extra = {key: value for key, value in extra.items() if value not in (None, "")}
    return UnifiedSlabRecord(
        supplier="ultra_stone",
        source_category=(record.category or record.material or "").lower(),
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand=record.brand,
        sku=record.sku,
        block_number=record.block_number,
        image_url=record.image_url,
        width_in=record.width_in,
        height_in=record.height_in,
        thickness_cm=parse_thickness_to_cm(record.thickness),
        finishes=canonical_finishes([record.finish] if record.finish else []),
        color_tone=record.color,
        extra=extra,
    )


def export_unified(records: list[UltraStoneRecord], output_dir: Path, suffix: str) -> Path:
    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at) for record in records]
    return export_unified_csv(unified, output_dir, supplier="ultra_stone", suffix=suffix)


def write_latest_alias(source_path: Path, alias_name: str) -> Path:
    alias_path = source_path.parent / alias_name
    alias_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")
    return alias_path


def score_record(record: UltraStoneRecord) -> tuple[int, int, int, int]:
    return (
        1 if record.image_url else 0,
        1 if record.finish else 0,
        1 if record.thickness else 0,
        1 if record.origin else 0,
    )


def normalize_records(records: list[UltraStoneRecord]) -> list[UltraStoneRecord]:
    deduped: dict[str, UltraStoneRecord] = {}
    for record in records:
        existing = deduped.get(record.record_key)
        if existing is None or score_record(record) > score_record(existing):
            deduped[record.record_key] = record
    normalized = sorted(
        [row for row in deduped.values() if row.material in SUPPORTED_DB_MATERIALS],
        key=lambda row: (row.material, row.name, row.item_id),
    )
    return normalized


def scrape(timeout_sec: int) -> tuple[list[UltraStoneRecord], dict[str, Any]]:
    session = build_session()
    settings = fetch_settings(session, timeout_sec)
    search_details = fetch_search_details(session, timeout_sec)
    item_rows = dedupe_item_rows(fetch_item_rows(session, timeout_sec, settings))

    finish_lookup = build_lookup(search_details, "Finish")
    origin_lookup = build_lookup(search_details, "Origin")
    file_base = clean_text(settings.get("SecureFilePath") or settings.get("FilePath"))

    records: list[UltraStoneRecord] = []
    for item_row in item_rows:
        item_id = as_optional_int(item_row.get("ItemID"))
        material = normalize_material(item_row.get("CategoryName"))
        inventory_rows: list[dict[str, Any]] = []
        if item_id is not None:
            inventory_rows = dedupe_inventory_rows(fetch_item_inventory_rows(session, timeout_sec, settings, item_id))

        if should_expand_to_inventory_rows(material) and inventory_rows:
            for inventory_row in inventory_rows:
                record = normalize_record(item_row, file_base, finish_lookup, origin_lookup, inventory_row)
                if record is not None:
                    records.append(record)
            continue

        inventory_row = pick_inventory_image_row(inventory_rows) if inventory_rows and not clean_text(item_row.get("Filename")) else None
        record = normalize_record(item_row, file_base, finish_lookup, origin_lookup, inventory_row)
        if record is not None:
            records.append(record)

    records.sort(key=lambda row: (row.material, row.name, row.item_id))
    return records, settings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scrape Ultra Stone inventory from Stone Profits.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for JSON/CSV exports (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT_SEC})",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    records, settings = scrape(timeout_sec=args.timeout_sec)
    normalized_records = normalize_records(records)
    timestamp = now_timestamp_slug()

    json_path = args.output_dir / f"ultra_stone_inventory_{timestamp}.json"
    csv_path = args.output_dir / f"ultra_stone_inventory_{timestamp}.csv"
    normalized_json_path = args.output_dir / f"ultra_stone_inventory_normalized_{timestamp}.json"
    normalized_csv_path = args.output_dir / f"ultra_stone_inventory_normalized_{timestamp}.csv"

    export_records(records, json_path)
    export_csv(records, csv_path)
    export_records(normalized_records, normalized_json_path)
    export_csv(normalized_records, normalized_csv_path)
    unified_csv_path = export_unified(normalized_records, args.output_dir, suffix="inventory_normalized")
    logging.info("Ultra Stone unified CSV: %s", unified_csv_path)
    latest_raw_json_path = write_latest_alias(json_path, "latest_raw.json")
    latest_raw_csv_path = write_latest_alias(csv_path, "latest_raw.csv")
    latest_normalized_json_path = write_latest_alias(normalized_json_path, "latest_normalized.json")
    latest_normalized_csv_path = write_latest_alias(normalized_csv_path, "latest_normalized.csv")

    logging.info("Exported %s Ultra Stone rows", len(records))
    logging.info("Exported %s normalized Ultra Stone rows", len(normalized_records))
    logging.info("JSON: %s", json_path)
    logging.info("CSV: %s", csv_path)
    logging.info("Normalized JSON: %s", normalized_json_path)
    logging.info("Normalized CSV: %s", normalized_csv_path)
    logging.info("Latest raw JSON: %s", latest_raw_json_path)
    logging.info("Latest raw CSV: %s", latest_raw_csv_path)
    logging.info("Latest normalized JSON: %s", latest_normalized_json_path)
    logging.info("Latest normalized CSV: %s", latest_normalized_csv_path)
    logging.info("Gallery type: %s", clean_text(settings.get('GalleryListType')))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
