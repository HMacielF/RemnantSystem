"""
Vadara slab scraper.

Current scope:
- View-all designs listing collection
- Detail-page extraction for richer image/spec fields
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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.vadara.com"
LISTING_URL = f"{BASE_URL}/designs/"
LISTING_GRID_SELECTOR = "#us_grid_1"
PRODUCT_CARD_SELECTOR = "#us_grid_1 .w-grid-item-h"
PRODUCT_LINK_SELECTOR = ".post_image a[href*='/designs/']"
PRODUCT_NAME_SELECTOR = ".woocommerce-loop-product__title"
DETAIL_READY_SELECTOR = ".detail-table"
DETAIL_NAME_SELECTOR = "h1.product_title, h1.entry-title, h1"
DETAIL_CODE_SELECTOR = ".w-post-elm.post_taxonomy.style_simple span[class*='term-v'], .us_custom_9ab24180 span[class*='term-v']"
DETAIL_DESCRIPTION_SELECTOR = ".detail-table .post_content[itemprop='text']"
DETAIL_ATTR_ROW_SELECTOR = ".detail-table .product_field.attributes.display_table > div"
DETAIL_IMAGE_DOWNLOAD_SELECTOR = "a[href$='.jpg'], a[href$='.jpeg']"
DETAIL_SPECS_TABLE_ROW_SELECTOR = "table tr"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/vadara")
DEFAULT_LIMIT = 0
DEFAULT_MATERIAL = "Quartz"


@dataclass
class VadaraSlabRecord:
    name: str
    code: str | None
    detail_url: str
    image_url: str | None
    description: str | None
    collection: str | None
    thickness: str | None
    style_inspiration: str | None
    background_color: str | None
    vein_color: str | None
    hue: str | None
    features: str | None
    slab_size: str | None
    finish: str | None
    material: str


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_options(headless: bool) -> Options:
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,2600")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    return options


def create_driver(headless: bool = True) -> webdriver.Chrome:
    return webdriver.Chrome(options=build_options(headless))


def safe_text(element) -> str:
    return " ".join((element.text or "").split())


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    logging.info("Opening Vadara listing page: %s", LISTING_URL)
    driver.get(LISTING_URL)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, LISTING_GRID_SELECTOR)))
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
        if not detail_url or detail_url.rstrip("/") == LISTING_URL.rstrip("/") or detail_url in seen_urls:
            continue

        name = ""
        try:
            name = safe_text(card.find_element(By.CSS_SELECTOR, PRODUCT_NAME_SELECTOR))
        except NoSuchElementException:
            name = (link.get_attribute("aria-label") or "").strip()

        if not name:
            continue

        products.append((name, detail_url))
        seen_urls.add(detail_url)

        if limit > 0 and len(products) >= limit:
            break

    return products


def parse_detail_attributes(driver: webdriver.Chrome) -> dict[str, str]:
    info: dict[str, str] = {}

    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_ATTR_ROW_SELECTOR):
        try:
            label = row.find_element(By.CSS_SELECTOR, ".w-post-elm-before")
            value = row.find_element(By.CSS_SELECTOR, ".woocommerce-product-attributes-item__value")
        except NoSuchElementException:
            continue

        key = safe_text(label).lower().rstrip(":")
        val = safe_text(value)
        if key and val:
            info[key] = val

    return info


def parse_specs_table(driver: webdriver.Chrome) -> dict[str, str]:
    info: dict[str, str] = {}

    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_SPECS_TABLE_ROW_SELECTOR):
        cells = row.find_elements(By.CSS_SELECTOR, "td")
        if len(cells) < 2:
            continue

        key = safe_text(cells[0]).lower().rstrip(":")
        value = " ".join(safe_text(cell) for cell in cells[1:] if safe_text(cell))
        if key and value:
            info[key] = value

    return info


def select_detail_image_url(driver: webdriver.Chrome) -> str | None:
    for link in driver.find_elements(By.CSS_SELECTOR, DETAIL_IMAGE_DOWNLOAD_SELECTOR):
        href = (link.get_attribute("href") or "").strip()
        label = safe_text(link).lower()
        if href and ("download image" in label or "hires" in href.lower()):
            return urljoin(BASE_URL, href)

    return None


def select_detail_code(driver: webdriver.Chrome) -> str | None:
    try:
        code = safe_text(driver.find_element(By.CSS_SELECTOR, DETAIL_CODE_SELECTOR))
        if code:
            return code
    except NoSuchElementException:
        pass

    try:
        sku_input = driver.find_element(By.CSS_SELECTOR, "input[name='gtm4wp_product_data']")
        raw_value = (sku_input.get_attribute("value") or "").strip()
        if '"sku":"' in raw_value:
            code = raw_value.split('"sku":"', 1)[1].split('"', 1)[0].strip()
            if code:
                return code.split("-", 1)[0]
    except NoSuchElementException:
        pass

    return None


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
) -> VadaraSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_READY_SELECTOR)))

    page_name = listing_name
    try:
        title = driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)
        page_name = safe_text(title) or listing_name
    except NoSuchElementException:
        pass

    description = None
    try:
        description = safe_text(driver.find_element(By.CSS_SELECTOR, DETAIL_DESCRIPTION_SELECTOR)) or None
    except NoSuchElementException:
        pass

    attrs = parse_detail_attributes(driver)
    specs = parse_specs_table(driver)

    return VadaraSlabRecord(
        name=page_name,
        code=select_detail_code(driver),
        detail_url=detail_url,
        image_url=select_detail_image_url(driver),
        description=description,
        collection=attrs.get("collection"),
        thickness=attrs.get("thickness"),
        style_inspiration=attrs.get("style inspiration"),
        background_color=attrs.get("background color"),
        vein_color=attrs.get("vein color"),
        hue=attrs.get("hue"),
        features=attrs.get("features"),
        slab_size=specs.get("slab size"),
        finish=specs.get("finish"),
        material=DEFAULT_MATERIAL,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    product_links: list[tuple[str, str]],
) -> list[VadaraSlabRecord]:
    records: list[VadaraSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(product_links, start=1):
        logging.info("Scraping detail %s/%s: %s", index, len(product_links), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url))

    return records


def to_unified(record: VadaraSlabRecord, scraped_at: str) -> UnifiedSlabRecord:
    width_in, height_in = parse_dimensions_inches(record.slab_size)
    extra = {}
    if record.description:
        extra["description"] = record.description
    if record.style_inspiration:
        extra["style_inspiration"] = record.style_inspiration
    if record.background_color:
        extra["background_color"] = record.background_color
    if record.vein_color:
        extra["vein_color"] = record.vein_color
    if record.hue:
        extra["hue"] = record.hue
    if record.features:
        extra["features"] = record.features
    return UnifiedSlabRecord(
        supplier="vadara",
        source_category="quartz",
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand="Vadara",
        collection=record.collection,
        sku=record.code,
        image_url=record.image_url,
        width_in=width_in,
        height_in=height_in,
        size_text=record.slab_size,
        thickness_cm=parse_thickness_to_cm(record.thickness),
        finishes=canonical_finishes([record.finish] if record.finish else []),
        color_tone=record.hue,
        extra=extra,
    )


def export_records(records: list[VadaraSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"vadara_quartz_{stamp}.json"

    payload = [
        {
            "name": record.name,
            "code": record.code,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "description": record.description,
            "collection": record.collection,
            "thickness": record.thickness,
            "style_inspiration": record.style_inspiration,
            "background_color": record.background_color,
            "vein_color": record.vein_color,
            "hue": record.hue,
            "features": record.features,
            "slab_size": record.slab_size,
            "finish": record.finish,
            "material": record.material,
        }
        for record in records
    ]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    scraped_at = iso_now()
    unified = [to_unified(record, scraped_at) for record in records]
    csv_path = export_unified_csv(unified, output_dir, supplier="vadara", suffix="quartz")

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Vadara quartz designs.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where the exported JSON and CSV files will be written.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Optional maximum number of detail pages to scrape. Use 0 for all.",
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
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_listing_page(driver, wait)
        product_links = collect_listing_products(driver, args.limit)
        logging.info("Collected %s Vadara products from the listing", len(product_links))

        records = scrape_detail_pages(driver, wait, product_links)
        json_path, csv_path = export_records(records, output_dir)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading the Vadara catalog") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
