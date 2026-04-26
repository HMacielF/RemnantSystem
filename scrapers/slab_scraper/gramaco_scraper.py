"""
Gramaco slab scraper.

Current scope:
- Category-driven Gramaco catalog listing
- Pagination-aware product collection
- Detail-page extraction for image/spec fields

This scraper intentionally lives outside the remnant sync flow so supplier slab
catalog work can evolve independently from Moraware remnant ingestion.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

try:
    from .unified_csv import (
        UnifiedSlabRecord,
        canonical_finishes,
        canonical_material,
        export_unified_csv,
        iso_now,
        join_list,
        parse_dimensions_inches,
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
        join_list,
        parse_dimensions_inches,
        parse_thickness_to_cm,
    )


def _split_comma(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]

if __package__ is None or __package__ == "":
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scrapers.slab_scraper.tracking import (
    create_supabase_client,
    finalize_scrape_run,
    get_or_create_supplier,
    start_scrape_run,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.gramaco.com"
SUPPLIER_NAME = "Gramaco Granite & Marble"
SPECIAL_COLLECTION_URLS = {
    "hrp": f"{BASE_URL}/quartz/?swoof=1&type_collection=hrp&paged=1",
    "noble": f"{BASE_URL}/quartz/?swoof=1&paged=1&type_collection=noble",
    "polarstone": f"{BASE_URL}/quartz/?swoof=1&paged=1&type_collection=polarstone",
    "smart-quartz": f"{BASE_URL}/quartz/?swoof=1&paged=1&type_collection=smart-quartz",
}
SUPPORTED_CATEGORIES = (
    "quartz",
    "quartzite",
    "marble",
    "granite",
    "soapstone",
    "porcelain",
    "hrp",
    "noble",
    "polarstone",
    "smart-quartz",
)
PRODUCT_CARD_SELECTOR = ".product-item-inner"
PRODUCT_LINK_SELECTOR = ".product-thumb a.product-link, a.product-name"
PRODUCT_NAME_SELECTOR = "a.product-name"
PAGINATION_NEXT_SELECTOR = "nav.woocommerce-pagination a.next.page-numbers"
DETAIL_NAME_SELECTOR = "h1.product_title"
DETAIL_IMAGE_SELECTOR = ".single-product-image .woocommerce-product-gallery__image img"
DETAIL_INFO_ROW_SELECTOR = ".descricao-box h3.fundo-white"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/gramaco")
DEFAULT_LIMIT = 0
DEFAULT_CATEGORY = "quartz"


@dataclass
class GramacoSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    brand: str | None
    primary_colors: str | None
    accent_colors: str | None
    dimensions: str | None
    thickness: str | None
    finishes: str | None
    material: str
    source_collection: str


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_listing_url(category_slug: str) -> str:
    if category_slug in SPECIAL_COLLECTION_URLS:
        return SPECIAL_COLLECTION_URLS[category_slug]
    return f"{BASE_URL}/type_category/{category_slug.strip('/')}/"


def material_label_from_category(category_slug: str) -> str:
    if category_slug in SPECIAL_COLLECTION_URLS:
        return "Quartz"
    return " ".join(part.capitalize() for part in category_slug.strip("/").split("-") if part)


def build_options(headless: bool) -> Options:
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,2400")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    return options


def create_driver(headless: bool = True) -> webdriver.Chrome:
    return webdriver.Chrome(options=build_options(headless))


def safe_text(element) -> str:
    return " ".join((element.text or "").split())


def clean_material_text(material_values: list[str], category_slug: str) -> str:
    category_label = material_label_from_category(category_slug)
    for value in material_values:
        if value.strip().lower() == category_label.lower():
            return category_label
    return category_label


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str) -> None:
    logging.info("Opening Gramaco listing page: %s", url)
    driver.get(url)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def collect_listing_page_urls(driver: webdriver.Chrome, wait: WebDriverWait) -> list[str]:
    page_urls: list[str] = []
    seen_urls: set[str] = set()
    current_url = driver.current_url

    while current_url:
        normalized = current_url.rstrip("/")
        if normalized in seen_urls:
            break

        page_urls.append(current_url)
        seen_urls.add(normalized)

        next_links = driver.find_elements(By.CSS_SELECTOR, PAGINATION_NEXT_SELECTOR)
        if not next_links:
            break

        next_href = urljoin(BASE_URL, (next_links[0].get_attribute("href") or "").strip())
        if not next_href or next_href.rstrip("/") in seen_urls:
            break

        open_listing_page(driver, wait, next_href)
        current_url = driver.current_url

    return page_urls


def collect_listing_products(driver: webdriver.Chrome, wait: WebDriverWait, limit: int) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    page_urls = collect_listing_page_urls(driver, wait)

    for page_index, page_url in enumerate(page_urls, start=1):
        if driver.current_url.rstrip("/") != page_url.rstrip("/"):
            open_listing_page(driver, wait, page_url)

        logging.info("Collecting Gramaco listing page %s/%s: %s", page_index, len(page_urls), page_url)
        for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
            try:
                link = card.find_element(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR)
            except NoSuchElementException:
                continue

            detail_url = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
            if not detail_url or detail_url in seen_urls:
                continue

            name = ""
            try:
                name = safe_text(card.find_element(By.CSS_SELECTOR, PRODUCT_NAME_SELECTOR))
            except NoSuchElementException:
                name = safe_text(link)

            if not name:
                continue

            products.append((name, detail_url))
            seen_urls.add(detail_url)
            if limit > 0 and len(products) >= limit:
                return products

    return products


def parse_detail_info(driver: webdriver.Chrome) -> dict[str, list[str]]:
    info: dict[str, list[str]] = {}

    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_INFO_ROW_SELECTOR):
        text = safe_text(row)
        if not text or ":" not in text:
            continue

        label, raw_values = text.split(":", 1)
        key = label.strip().lower()
        values = [safe_text(link) for link in row.find_elements(By.CSS_SELECTOR, "a")]
        if not values:
            values = [part.strip() for part in raw_values.split(",") if part.strip()]

        info[key] = [value for value in values if value]

    return info


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
    category_slug: str,
) -> GramacoSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_INFO_ROW_SELECTOR)))

    page_name = listing_name
    try:
        page_name = safe_text(driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)) or listing_name
    except NoSuchElementException:
        pass

    image_url = None
    try:
        image = driver.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_SELECTOR)
        raw_src = (image.get_attribute("data-large_image") or image.get_attribute("src") or "").strip()
        image_url = urljoin(BASE_URL, raw_src) if raw_src else None
    except NoSuchElementException:
        pass

    info = parse_detail_info(driver)
    colors = info.get("color", [])
    brand = ",".join(info.get("collection", [])) or None
    primary_colors = colors[:1]
    accent_colors = colors[1:]
    dimensions = ", ".join(info.get("approx. size", [])) or None
    thickness = ",".join(info.get("thickness", [])) or None
    finishes = ",".join(info.get("finish", [])) or None
    material = clean_material_text(info.get("category", []), category_slug)

    return GramacoSlabRecord(
        name=page_name.title(),
        detail_url=detail_url,
        image_url=image_url,
        brand=brand,
        primary_colors=",".join(primary_colors) if primary_colors else None,
        accent_colors=",".join(accent_colors) if accent_colors else None,
        dimensions=dimensions,
        thickness=thickness,
        finishes=finishes,
        material=material.title() if material else material_label_from_category(category_slug),
        source_collection=category_slug,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
    category_slug: str,
) -> list[GramacoSlabRecord]:
    records: list[GramacoSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping Gramaco detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url, category_slug))

    return records


def to_unified(record: GramacoSlabRecord, scraped_at: str, category_slug: str) -> UnifiedSlabRecord:
    width_in, height_in = parse_dimensions_inches(record.dimensions)
    return UnifiedSlabRecord(
        supplier="gramaco",
        source_category=category_slug,
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand=record.brand,
        collection=record.source_collection or None,
        image_url=record.image_url,
        width_in=width_in,
        height_in=height_in,
        size_text=record.dimensions,
        thickness_cm=parse_thickness_to_cm(record.thickness),
        finishes=canonical_finishes(_split_comma(record.finishes)),
        primary_colors=join_list(_split_comma(record.primary_colors)),
        accent_colors=join_list(_split_comma(record.accent_colors)),
    )


def export_records(records: list[GramacoSlabRecord], output_dir: Path, category_slug: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    slug_token = category_slug.strip("/").replace("-", "_")
    json_path = output_dir / f"gramaco_{slug_token}_{stamp}.json"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "brand": record.brand,
            "primary_colors": record.primary_colors,
            "accent_colors": record.accent_colors,
            "dimensions": record.dimensions,
            "thickness": record.thickness,
            "finishes": record.finishes,
            "material": record.material,
            "source_collection": record.source_collection,
        }
        for record in records
    ]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at, category_slug) for record in records]
    csv_path = export_unified_csv(unified, output_dir, supplier="gramaco", suffix=slug_token)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Gramaco quartz slabs.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--category",
        choices=SUPPORTED_CATEGORIES,
        default=DEFAULT_CATEGORY,
        help="Gramaco category slug to scrape.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where the exported JSON and CSV files will be written.",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help="Selenium wait timeout in seconds.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Optional max number of listing products to scrape.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    listing_url = build_listing_url(args.category)
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)
    supabase = create_supabase_client()
    supplier = get_or_create_supplier(supabase, SUPPLIER_NAME, BASE_URL)
    run_id, _started_at = start_scrape_run(
        supabase,
        supplier.id,
        "gramaco_scraper",
        args.category,
        notes={
            "category": args.category,
            "listing_url": listing_url,
        },
    )

    try:
        open_listing_page(driver, wait, listing_url)
        products = collect_listing_products(driver, wait, args.limit)
        records = scrape_detail_pages(driver, wait, products, args.category)
        json_path, csv_path = export_records(records, output_dir, args.category)
        finalize_scrape_run(
            supabase,
            run_id,
            seen_count=len(records),
            updated_count=len(records),
            notes={
                "category": args.category,
                "listing_url": listing_url,
                "json_path": str(json_path),
                "csv_path": str(csv_path),
            },
        )
        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Collected %s Gramaco %s slabs", len(records), args.category)
    except TimeoutException as error:
        finalize_scrape_run(
            supabase,
            run_id,
            status="failed",
            notes={
                "category": args.category,
                "listing_url": listing_url,
                "error": "Timed out while loading Gramaco listing or detail pages",
            },
        )
        raise RuntimeError("Timed out while loading Gramaco listing or detail pages") from error
    except Exception as error:
        finalize_scrape_run(
            supabase,
            run_id,
            status="failed",
            notes={
                "category": args.category,
                "listing_url": listing_url,
                "error": str(error),
            },
        )
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
