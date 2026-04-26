"""
East West Marble scraper.

Current scope:
- Vision Quartz listing collection
- Detail-page extraction for the product name and larger image only

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
from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

try:
    from .unified_csv import UnifiedSlabRecord, canonical_material, export_unified_csv, iso_now
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from unified_csv import UnifiedSlabRecord, canonical_material, export_unified_csv, iso_now  # type: ignore


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.ewmarble.com"
LISTING_URL = f"{BASE_URL}/products/quartz/vision-quartz"
PRODUCT_CARD_SELECTOR = ".block_product .product"
PRODUCT_LINK_SELECTOR = ".name a, .button_detail"
PRODUCT_NAME_SELECTOR = ".name a"
DETAIL_NAME_SELECTOR = ".productfull .name, h1.product_name, h1"
DETAIL_IMAGE_LINK_SELECTOR = ".image_middle a.lightbox[href*='components/com_jshopping/files/img_products/full_']"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/east_west_marble")
DEFAULT_LIMIT = 0
DEFAULT_MATERIAL = "Quartz"
DEFAULT_BRAND = "Vision Quartz"
IMAGE_NOT_AVAILABLE = "Image Not Available"


@dataclass
class EastWestMarbleRecord:
    name: str
    detail_url: str
    image_url: str | None
    material: str
    brand: str


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


def title_case_name(name: str) -> str:
    cleaned = " ".join((name or "").split()).strip()
    return cleaned.title() if cleaned.isupper() else cleaned


def has_unstable_detail_url(detail_url: str) -> bool:
    return "/product/view/" in (detail_url or "")


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    logging.info("Opening East West Marble listing page: %s", LISTING_URL)
    driver.get(LISTING_URL)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def collect_listing_products(driver: webdriver.Chrome, limit: int) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()

    for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
        try:
            link = card.find_element(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR)
        except NoSuchElementException:
            continue

        detail_url = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
        if not detail_url or detail_url in seen_urls:
            continue

        try:
            name = safe_text(card.find_element(By.CSS_SELECTOR, PRODUCT_NAME_SELECTOR))
        except NoSuchElementException:
            name = safe_text(link)

        if not name:
            continue

        products.append((title_case_name(name), detail_url))
        seen_urls.add(detail_url)
        if limit > 0 and len(products) >= limit:
            break

    return products


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
) -> EastWestMarbleRecord:
    if has_unstable_detail_url(detail_url):
        return EastWestMarbleRecord(
            name=title_case_name(listing_name),
            detail_url=detail_url,
            image_url=IMAGE_NOT_AVAILABLE,
            material=DEFAULT_MATERIAL,
            brand=DEFAULT_BRAND,
        )

    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_IMAGE_LINK_SELECTOR)))

    page_name = listing_name
    try:
        page_name = safe_text(driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)) or listing_name
    except NoSuchElementException:
        pass

    image_url = None
    try:
        image_link = driver.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_LINK_SELECTOR)
        raw_href = (image_link.get_attribute("href") or "").strip()
        image_url = urljoin(BASE_URL, raw_href) if raw_href else None
    except NoSuchElementException:
        pass

    return EastWestMarbleRecord(
        name=title_case_name(page_name),
        detail_url=detail_url,
        image_url=image_url or IMAGE_NOT_AVAILABLE,
        material=DEFAULT_MATERIAL,
        brand=DEFAULT_BRAND,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
) -> list[EastWestMarbleRecord]:
    records: list[EastWestMarbleRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping East West Marble detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url))

    return records


def to_unified(record: EastWestMarbleRecord, scraped_at: str) -> UnifiedSlabRecord:
    return UnifiedSlabRecord(
        supplier="east_west_marble",
        source_category="vision-quartz",
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand=record.brand,
        image_url=record.image_url,
    )


def export_records(records: list[EastWestMarbleRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"east_west_marble_vision_quartz_{stamp}.json"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "material": record.material,
            "brand": record.brand,
        }
        for record in records
    ]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at) for record in records]
    csv_path = export_unified_csv(unified, output_dir, supplier="east_west_marble", suffix="vision_quartz")

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape East West Marble Vision Quartz products.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
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
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_listing_page(driver, wait)
        products = collect_listing_products(driver, args.limit)
        records = scrape_detail_pages(driver, wait, products)
        json_path, csv_path = export_records(records, output_dir)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Collected %s East West Marble Vision Quartz slabs", len(records))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
