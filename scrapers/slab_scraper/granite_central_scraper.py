"""
Granite Central slab inventory scraper.

Current scope:
- Direct JSON extraction from the public Stone Profits inventory API
- Row-level slab inventory export with optional per-item detail enrichment
- Local JSON/CSV exports only; no database writes
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import time
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


CATALOG_BASE_URL = "https://productcatalog.granitecentral.net"
API_URL = "https://granitecentral.stoneprofits.com/api/fetchdataAngularProductionToyota.ashx"
AUTH_TOKEN = "lA09rwzgL5CNmJIj4GPxP1O6pb8Nc0IJffWW3/LBtceHb8d/q87rqA/LWl2H0ZJ0FPt/nGkS5MdOHGwy"
WEBCONNECT_SETTING_ID = "1"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/granite_central")
DEFAULT_TIMEOUT_SEC = 60
DEFAULT_USER_ID = "123456789"
DEFAULT_REQUEST_DELAY_SEC = 0.05
EXCLUDED_ITEM_IDS = {803}
QUARTZ_MATERIAL_NAMES = {"Quartz"}


@dataclass
class GraniteCentralRecord:
    item_id: int
    name: str
    detail_url: str
    image_url: str | None
    primary_image_url: str | None
    cover_image_url: str | None
    material: str
    brand: str | None
    category: str
    subcategory: str | None
    product_form: str | None
    thickness: str | None
    finish: str | None
    origin: str | None
    sku: str | None
    block_number: str | None
    location: str | None
    location_id: int | None
    width_in: float | None
    height_in: float | None
    available_qty: float | None
    available_slabs: int | None
    uom: str | None
    file_id: str | None
    filename: str | None
    raw_inventory_json: str
    raw_detail_json: str


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def safe_text(value: Any) -> str:
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
        return int(value)
    except (TypeError, ValueError):
        return None


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "Authorization": AUTH_TOKEN,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; GraniteCentralScraper/1.0)",
        }
    )
    return session


def api_get(
    session: requests.Session,
    timeout_sec: int,
    **params: str,
) -> Any:
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


def fetch_settings(session: requests.Session, timeout_sec: int) -> dict[str, Any]:
    payload = api_get(
        session,
        timeout_sec,
        act="getSettings",
        WebconnectSettingID=WEBCONNECT_SETTING_ID,
    )
    if not payload:
        raise RuntimeError("Granite Central settings response was empty")
    return payload[0]


def fetch_inventory_rows(
    session: requests.Session,
    timeout_sec: int,
    user_id: str,
    include_not_in_stock: bool,
) -> list[dict[str, Any]]:
    params = {
        "act": "getInventoryGallery",
        "WebconnectSettingID": WEBCONNECT_SETTING_ID,
        "InventoryGroupBy": "IDONE_",
        "TrimmedUserID": user_id,
        "OnHold": "False",
        "OnSO": "False",
        "Intransit": "False",
        "showNotInStock": "True" if include_not_in_stock else "False",
        "Alphabet": "",
        "showLocation": "on",
    }
    payload = {
        "ItemName": "",
        "Location": "",
        "Type": "",
        "Category": "",
        "SubCategory": "",
        "Thickness": "",
        "Finish": "",
        "Group": "",
        "Color": "",
        "PriceRange": "",
        "Origin": "",
        "Kind": "",
        "SlabOptions": "",
        "SaleOptions": "",
        "AvailableOptions": "",
        "AvgCurrentAvailableQty": "",
        "AvgCurrentSlabLength": "",
        "AvgCurrentSlabWidth": "",
        "AvailableSlabs": "",
        "PageNo": "1",
        "PerPage": "1000",
    }
    rows = api_post(session, timeout_sec, params=params, payload=payload)
    if not isinstance(rows, list):
        raise RuntimeError("Granite Central inventory response was not a list")
    return rows


def fetch_item_detail(
    session: requests.Session,
    timeout_sec: int,
    item_id: int,
) -> dict[str, Any]:
    payload = api_get(session, timeout_sec, act="getProductDetails", id=str(item_id))
    if not payload:
        return {}
    return payload[0]


def build_detail_url(item_id: int, name: str) -> str:
    return f"{CATALOG_BASE_URL}/InventoryDetail/{item_id}"


def build_image_url(file_base: str, filename: str | None) -> str | None:
    cleaned = safe_text(filename)
    if not cleaned:
        return None
    return f"{file_base}{cleaned}"


def preferred_image_url(primary_image_url: str | None, cover_image_url: str | None) -> str | None:
    return primary_image_url or cover_image_url


def infer_material(category: str, subcategory: str | None) -> str:
    cleaned_subcategory = safe_text(subcategory)
    cleaned_category = safe_text(category)
    if cleaned_subcategory:
        return cleaned_subcategory
    if cleaned_category:
        return cleaned_category
    return "Unknown"


def infer_brand(category: str, name: str) -> str | None:
    cleaned_category = safe_text(category)
    cleaned_name = safe_text(name)
    if cleaned_category == "Quartz" or "Prizma Qtz" in cleaned_name or "Prizma Quartz" in cleaned_name:
        return "Prizma Quartz"
    return None


def normalize_record(
    inventory_row: dict[str, Any],
    detail_row: dict[str, Any],
    file_base: str,
) -> GraniteCentralRecord | None:
    item_id = as_optional_int(inventory_row.get("ItemID"))
    name = safe_text(inventory_row.get("ItemName") or detail_row.get("Name"))
    if item_id is None or not name:
        return None

    category = safe_text(inventory_row.get("CategoryName") or detail_row.get("ServiceCategoryValue"))
    subcategory = safe_text(inventory_row.get("SubCategoryName") or detail_row.get("ProductSubCategory")) or None
    filename = safe_text(inventory_row.get("Filename")) or None
    cover_filename = safe_text(detail_row.get("FileName")) or None
    primary_image = build_image_url(file_base, filename)
    cover_image = build_image_url(file_base, cover_filename)

    return GraniteCentralRecord(
        item_id=item_id,
        name=name,
        detail_url=build_detail_url(item_id, name),
        image_url=preferred_image_url(primary_image, cover_image),
        primary_image_url=primary_image,
        cover_image_url=cover_image,
        material=infer_material(category, subcategory),
        brand=infer_brand(category, name),
        category=category,
        subcategory=subcategory,
        product_form=safe_text(inventory_row.get("ProductFormValue") or detail_row.get("ProductFormValue")) or None,
        thickness=safe_text(detail_row.get("ProductThickness") or inventory_row.get("ProductThickness")) or None,
        finish=safe_text(detail_row.get("Finish") or inventory_row.get("Finish")) or None,
        origin=safe_text(detail_row.get("OriginValue")) or None,
        sku=safe_text(inventory_row.get("SKU") or detail_row.get("SKU")) or None,
        block_number=safe_text(inventory_row.get("IDONE")) or None,
        location=safe_text(inventory_row.get("Location")) or None,
        location_id=as_optional_int(inventory_row.get("LocationID")),
        width_in=as_optional_float(inventory_row.get("AverageWidth")),
        height_in=as_optional_float(inventory_row.get("AverageLength")),
        available_qty=as_optional_float(inventory_row.get("AvailableQty")),
        available_slabs=as_optional_int(inventory_row.get("AvailableSlabs")),
        uom=safe_text(inventory_row.get("UOM") or detail_row.get("UOM")) or None,
        file_id=safe_text(inventory_row.get("FileID")) or None,
        filename=filename,
        raw_inventory_json=json.dumps(inventory_row, ensure_ascii=True),
        raw_detail_json=json.dumps(detail_row, ensure_ascii=True),
    )


def record_quality(record: GraniteCentralRecord) -> tuple[int, int, int, int, int]:
    return (
        1 if record.primary_image_url else 0,
        1 if record.image_url else 0,
        1 if record.cover_image_url else 0,
        1 if record.thickness else 0,
        1 if record.block_number else 0,
    )


def choose_best_record(records: list[GraniteCentralRecord]) -> GraniteCentralRecord:
    return max(records, key=record_quality)


def exact_duplicate_signature(record: GraniteCentralRecord) -> tuple[Any, ...]:
    return (
        record.item_id,
        record.name,
        record.material,
        record.location,
        record.block_number,
        record.width_in,
        record.height_in,
        record.thickness,
        record.finish,
        record.available_qty,
        record.available_slabs,
    )


def dedupe_exact_rows(records: list[GraniteCentralRecord]) -> list[GraniteCentralRecord]:
    grouped: dict[tuple[Any, ...], list[GraniteCentralRecord]] = {}
    for record in records:
        grouped.setdefault(exact_duplicate_signature(record), []).append(record)
    return [choose_best_record(group) for group in grouped.values()]


def normalize_records(records: list[GraniteCentralRecord]) -> list[GraniteCentralRecord]:
    deduped_records = dedupe_exact_rows(records)

    quartz_by_item: dict[int, list[GraniteCentralRecord]] = {}
    non_quartz_records: list[GraniteCentralRecord] = []
    for record in deduped_records:
        if record.material in QUARTZ_MATERIAL_NAMES:
            quartz_by_item.setdefault(record.item_id, []).append(record)
        else:
            non_quartz_records.append(record)

    normalized_quartz = [choose_best_record(group) for group in quartz_by_item.values()]
    normalized = non_quartz_records + normalized_quartz
    normalized.sort(key=lambda record: (record.material, record.name.lower(), record.item_id, record.block_number or ""))
    return normalized


def scrape_records(
    session: requests.Session,
    timeout_sec: int,
    user_id: str,
    include_not_in_stock: bool,
    request_delay_sec: float,
) -> list[GraniteCentralRecord]:
    settings = fetch_settings(session, timeout_sec)
    file_base = safe_text(settings.get("FilePath"))
    if not file_base:
        raise RuntimeError("Granite Central file base URL missing from settings")

    inventory_rows = fetch_inventory_rows(session, timeout_sec, user_id, include_not_in_stock)
    logging.info("Fetched %s Granite Central inventory rows", len(inventory_rows))

    records: list[GraniteCentralRecord] = []
    for index, inventory_row in enumerate(inventory_rows, start=1):
        item_id = as_optional_int(inventory_row.get("ItemID"))
        if item_id is None:
            logging.warning("Skipping inventory row without ItemID: %s", inventory_row)
            continue
        if item_id in EXCLUDED_ITEM_IDS:
            logging.info("Skipping excluded Granite Central item: %s", item_id)
            continue

        logging.info("Enriching Granite Central item %s/%s: %s", index, len(inventory_rows), item_id)
        detail_row = fetch_item_detail(session, timeout_sec, item_id)
        record = normalize_record(inventory_row, detail_row, file_base)
        if record is not None:
            records.append(record)

        if request_delay_sec > 0:
            time.sleep(request_delay_sec)

    return records


def to_unified(record: GraniteCentralRecord, scraped_at: str) -> UnifiedSlabRecord:
    extra = {
        "item_id": record.item_id,
        "category": record.category,
        "subcategory": record.subcategory,
        "product_form": record.product_form,
        "origin": record.origin,
        "location": record.location,
        "location_id": record.location_id,
        "available_qty": record.available_qty,
        "available_slabs": record.available_slabs,
        "uom": record.uom,
        "file_id": record.file_id,
        "filename": record.filename,
    }
    extra = {key: value for key, value in extra.items() if value not in (None, "")}
    image_url = record.image_url or record.primary_image_url or record.cover_image_url
    return UnifiedSlabRecord(
        supplier="granite_central",
        source_category=(record.category or record.material or "").lower(),
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand=record.brand,
        sku=record.sku,
        block_number=record.block_number,
        image_url=image_url,
        width_in=record.width_in,
        height_in=record.height_in,
        thickness_cm=parse_thickness_to_cm(record.thickness),
        finishes=canonical_finishes([record.finish] if record.finish else []),
        extra=extra,
    )


def export_records(records: list[GraniteCentralRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"granite_central_inventory_{stamp}.json"

    payload = [asdict(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at) for record in records]
    csv_path = export_unified_csv(unified, output_dir, supplier="granite_central", suffix="inventory")

    return json_path, csv_path


def export_normalized_records(records: list[GraniteCentralRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"granite_central_inventory_normalized_{stamp}.json"

    payload = [asdict(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at) for record in records]
    csv_path = export_unified_csv(unified, output_dir, supplier="granite_central", suffix="inventory_normalized")

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Granite Central slab inventory via the public catalog API.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where JSON and CSV exports will be written.",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help="HTTP timeout in seconds.",
    )
    parser.add_argument(
        "--user-id",
        default=DEFAULT_USER_ID,
        help="Synthetic cart user id used by the upstream inventory API.",
    )
    parser.add_argument(
        "--include-not-in-stock",
        action="store_true",
        help="Include rows the upstream API marks as not in stock.",
    )
    parser.add_argument(
        "--request-delay-sec",
        type=float,
        default=DEFAULT_REQUEST_DELAY_SEC,
        help="Delay between per-item detail requests.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session = build_session()

    try:
        records = scrape_records(
            session=session,
            timeout_sec=args.timeout_sec,
            user_id=args.user_id,
            include_not_in_stock=args.include_not_in_stock,
            request_delay_sec=args.request_delay_sec,
        )
        json_path, csv_path = export_records(records, args.output_dir)
        normalized_records = normalize_records(records)
        normalized_json_path, normalized_csv_path = export_normalized_records(normalized_records, args.output_dir)
        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Normalized JSON: %s", normalized_json_path)
        logging.info("Normalized CSV: %s", normalized_csv_path)
        logging.info("Collected %s Granite Central inventory rows", len(records))
        logging.info("Normalized to %s Granite Central inventory rows", len(normalized_records))
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
