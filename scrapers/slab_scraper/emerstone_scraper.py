"""
Emerstone slab scraper.

Current scope:
- Product listing under the all-products quartz catalog
- Detail-page extraction for product attributes and the better "Full Slab" image
- Export of the collected records at the end of the run

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
        parse_dimensions_inches,
        parse_thickness_to_cm,
    )


def _split_comma(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://emerstone.com"
LISTING_URL = f"{BASE_URL}/product-category/all/"
PRODUCT_CARD_SELECTOR = "li.product"
PRODUCT_LINK_SELECTOR = "a.woocommerce-LoopProduct-link"
LISTING_NAME_SELECTOR = "h2.woocommerce-loop-product__title"
PAGINATION_LINK_SELECTOR = "nav.woocommerce-pagination a.page-numbers"
DETAIL_NAME_SELECTOR = ".product_title, h1.product_title"
DETAIL_SPEC_ROW_SELECTOR = "table.shop_attributes tr"
DETAIL_IMAGE_TILE_SELECTOR = ".il_item"
DETAIL_IMAGE_SELECTOR = "img"
DETAIL_IMAGE_LABEL_SELECTOR = "h3"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/emerstone")
DEFAULT_LIMIT = 25
DEFAULT_MATERIAL = "Quartz"
DEFAULT_FINISH = "Polished"


@dataclass
class EmerstoneSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    thickness: str | None
    size: str | None
    finishes: str | None
    dimensions: str | None
    book_match: str | None
    color_tone: str | None
    material: str


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


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


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    driver.get(LISTING_URL)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def collect_listing_page_urls(driver: webdriver.Chrome) -> list[str]:
    page_urls = [LISTING_URL]
    seen_urls = {LISTING_URL.rstrip("/")}

    for link in driver.find_elements(By.CSS_SELECTOR, PAGINATION_LINK_SELECTOR):
        href = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
        normalized_href = href.rstrip("/")
        if not href or normalized_href in seen_urls:
            continue

        page_urls.append(href)
        seen_urls.add(normalized_href)

    return page_urls


def collect_listing_products(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    limit: int | None,
) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    page_urls = collect_listing_page_urls(driver)

    for page_index, page_url in enumerate(page_urls, start=1):
        if page_index > 1:
            driver.get(page_url)
            wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))

        logging.info("Collecting listing page %s/%s: %s", page_index, len(page_urls), page_url)

        for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
            try:
                link = card.find_element(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR)
                title = card.find_element(By.CSS_SELECTOR, LISTING_NAME_SELECTOR)
            except NoSuchElementException:
                continue

            detail_url = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
            if not detail_url or detail_url in seen_urls:
                continue

            name = safe_text(title)
            if not name:
                continue

            products.append((name, detail_url))
            seen_urls.add(detail_url)

            if limit is not None and len(products) >= limit:
                return products

    return products


def collect_full_slab_image_url(driver: webdriver.Chrome) -> str | None:
    for tile in driver.find_elements(By.CSS_SELECTOR, DETAIL_IMAGE_TILE_SELECTOR):
        try:
            label = tile.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_LABEL_SELECTOR)
            image = tile.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_SELECTOR)
        except NoSuchElementException:
            continue

        if safe_text(label).lower() != "full slab":
            continue

        raw_src = (image.get_attribute("src") or "").strip()
        return urljoin(BASE_URL, raw_src) if raw_src else None

    return None


def collect_detail_specs(driver: webdriver.Chrome) -> dict[str, str]:
    specs: dict[str, str] = {}

    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_SPEC_ROW_SELECTOR):
        try:
            label = row.find_element(By.CSS_SELECTOR, "th")
            value = row.find_element(By.CSS_SELECTOR, "td")
        except NoSuchElementException:
            continue

        key = safe_text(label).lower().rstrip(":")
        specs[key] = safe_text(value)

    return specs


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
) -> EmerstoneSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_SPEC_ROW_SELECTOR)))

    page_name = listing_name
    try:
        title = driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)
        page_name = safe_text(title) or listing_name
    except NoSuchElementException:
        pass

    specs = collect_detail_specs(driver)
    image_url = collect_full_slab_image_url(driver)

    return EmerstoneSlabRecord(
        name=page_name,
        detail_url=detail_url,
        image_url=image_url,
        thickness=specs.get("thickness"),
        size=specs.get("size"),
        finishes=specs.get("finish") or DEFAULT_FINISH,
        dimensions=specs.get("dimensions"),
        book_match=specs.get("book match"),
        color_tone=specs.get("color tone"),
        material=DEFAULT_MATERIAL,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
) -> list[EmerstoneSlabRecord]:
    records: list[EmerstoneSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url))

    return records


def to_unified(record: EmerstoneSlabRecord, scraped_at: str) -> UnifiedSlabRecord:
    width_in, height_in = parse_dimensions_inches(record.dimensions or record.size)
    extra = {}
    if record.book_match:
        extra["book_match"] = record.book_match
    if record.size:
        extra["size"] = record.size
    return UnifiedSlabRecord(
        supplier="emerstone",
        source_category="quartz",
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand="Emerstone",
        image_url=record.image_url,
        width_in=width_in,
        height_in=height_in,
        size_text=record.dimensions or record.size,
        thickness_cm=parse_thickness_to_cm(record.thickness),
        finishes=canonical_finishes(_split_comma(record.finishes)),
        color_tone=record.color_tone,
        extra=extra,
    )


def export_records(records: list[EmerstoneSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"emerstone_quartz_{stamp}.json"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "thickness": record.thickness,
            "size": record.size,
            "finishes": record.finishes,
            "dimensions": record.dimensions,
            "book_match": record.book_match,
            "color_tone": record.color_tone,
            "material": record.material,
        }
        for record in records
    ]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at) for record in records]
    csv_path = export_unified_csv(unified, output_dir, supplier="emerstone", suffix="quartz")

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Emerstone quartz slabs.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Maximum number of product detail pages to scrape in this run.",
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
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    limit = args.limit if args.limit > 0 else None

    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        logging.info("Opening Emerstone listing: %s", LISTING_URL)
        open_listing_page(driver, wait)
        products = collect_listing_products(driver, wait, limit)
        logging.info("Collected %s product links for this run", len(products))

        records = scrape_detail_pages(driver, wait, products)
        json_path, csv_path = export_records(records, output_dir)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading Emerstone listing or detail pages") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
