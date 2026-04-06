"""
Marble Systems slab scraper.

Current scope:
- Material-filtered slab listing for Fairfax, VA
- Pagination-aware product collection
- Detail-page extraction for technical info and Fairfax, VA batch inventory

This scraper intentionally lives outside the remnant sync flow so supplier slab
catalog work can evolve independently from Moraware remnant ingestion.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.marblesystems.com"
LISTING_URL = (
    f"{BASE_URL}/slabs/?filter_location=fairfax-va&query_type_location=or&"
    "filter_material=marble,quartzite,granite,soapstone&query_type_material=or"
)
PRODUCT_CARD_SELECTOR = ".item-container"
PRODUCT_LINK_SELECTOR = "a.stretched-link"
PRODUCT_NAME_SELECTOR = ".product-name"
PAGINATION_NEXT_SELECTOR = "a.next.page-numbers, nav.woocommerce-pagination a.next"
DETAIL_READY_SELECTOR = "#technical-info .technical-info, .batch-items-wrap .batch-item"
DETAIL_TECHNICAL_ATTR_SELECTOR = "#technical-info .attribute"
DETAIL_BATCH_SELECTOR = ".batch-items-wrap .batch-item"
DETAIL_BATCH_IMAGE_LINK_SELECTOR = ".image .batch-image a.popup"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/marble_systems")
DEFAULT_LIMIT = 0
TARGET_LOCATION = "Fairfax, VA"


@dataclass
class MarbleSystemsBatch:
    batch_number: str
    dimensions: str | None
    quantity_pcs: int | None
    status: str | None
    location: str | None
    image_url: str | None


@dataclass
class MarbleSystemsSlabRecord:
    name: str
    detail_url: str
    material: str | None
    primary_colors: str | None
    thickness: str | None
    finishes: str | None
    batch_number: str
    batch_dimensions: str | None
    batch_quantity_pcs: int | None
    batch_status: str | None
    batch_location: str | None
    image_url: str | None


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
    cleaned = re.sub(r'\s+\d+\s+\d+/\d+\s*"\s*thick$', "", cleaned, flags=re.IGNORECASE)
    return cleaned.title() if cleaned.isupper() else cleaned


def safe_text_content(element) -> str:
    return " ".join((element.get_attribute("textContent") or "").split())


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str) -> None:
    logging.info("Opening Marble Systems listing page: %s", url)
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

        logging.info("Collecting Marble Systems listing page %s/%s: %s", page_index, len(page_urls), page_url)
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

            products.append((title_case_name(name), detail_url))
            seen_urls.add(detail_url)
            if limit > 0 and len(products) >= limit:
                return products

    return products


def parse_technical_info(driver: webdriver.Chrome) -> dict[str, str]:
    info: dict[str, str] = {}
    for attribute in driver.find_elements(By.CSS_SELECTOR, DETAIL_TECHNICAL_ATTR_SELECTOR):
        try:
            title = safe_text_content(attribute.find_element(By.CSS_SELECTOR, ".title"))
            value = safe_text_content(attribute.find_element(By.CSS_SELECTOR, ".value"))
        except NoSuchElementException:
            continue
        if title and value:
            info[title.lower()] = value
    return info


def parse_dimensions(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)", value, flags=re.IGNORECASE)
    if match:
        return f"{match.group(1)} x {match.group(2)}"
    return None


def normalize_thickness(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.replace(" ", "")
    cleaned = re.sub(r'^(\d)(\d+/\d+)"$', r"\1 \2\"", cleaned)
    return cleaned


def parse_quantity(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"(\d+)", value)
    return int(match.group(1)) if match else None


def collect_va_batches(driver: webdriver.Chrome) -> list[MarbleSystemsBatch]:
    batches: list[MarbleSystemsBatch] = []

    for batch in driver.find_elements(By.CSS_SELECTOR, DETAIL_BATCH_SELECTOR):
        batch_data: dict[str, str | None] = {}
        for field_name in ["batch-number", "dimensions", "quantity", "status", "location"]:
            try:
                field = batch.find_element(By.CSS_SELECTOR, f".{field_name} .value")
                batch_data[field_name] = safe_text(field)
            except NoSuchElementException:
                batch_data[field_name] = None

        location = batch_data.get("location")
        if location != TARGET_LOCATION:
            continue

        image_url = None
        try:
            image_link = batch.find_element(By.CSS_SELECTOR, DETAIL_BATCH_IMAGE_LINK_SELECTOR)
            raw_href = (image_link.get_attribute("href") or "").strip()
            image_url = urljoin(BASE_URL, raw_href) if raw_href else None
        except NoSuchElementException:
            pass

        batches.append(
            MarbleSystemsBatch(
                batch_number=batch_data.get("batch-number") or "",
                dimensions=parse_dimensions(batch_data.get("dimensions")),
                quantity_pcs=parse_quantity(batch_data.get("quantity")),
                status=batch_data.get("status"),
                location=location,
                image_url=image_url,
            )
        )

    return batches


def record_payload(record: MarbleSystemsSlabRecord) -> dict[str, object]:
    return {
        "name": record.name,
        "detail_url": record.detail_url,
        "material": record.material,
        "primary_colors": record.primary_colors,
        "thickness": record.thickness,
        "finishes": record.finishes,
        "batch_number": record.batch_number,
        "batch_dimensions": record.batch_dimensions,
        "batch_quantity_pcs": record.batch_quantity_pcs,
        "batch_status": record.batch_status,
        "batch_location": record.batch_location,
        "image_url": record.image_url,
    }


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
) -> dict[str, object] | None:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_READY_SELECTOR)))

    technical = parse_technical_info(driver)
    va_batches = collect_va_batches(driver)
    if not va_batches:
        return None

    return {
        "name": listing_name,
        "detail_url": detail_url,
        "material": technical.get("material"),
        "primary_colors": technical.get("color"),
        "thickness": normalize_thickness(technical.get("thickness")),
        "finishes": technical.get("finish"),
        "va_batches": va_batches,
    }


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
) -> list[MarbleSystemsSlabRecord]:
    records: list[MarbleSystemsSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping Marble Systems detail %s/%s: %s", index, len(products), detail_url)
        detail = collect_detail_record(driver, wait, listing_name, detail_url)
        if detail is None:
            continue
        for batch in detail["va_batches"]:
            records.append(
                MarbleSystemsSlabRecord(
                    name=detail["name"],
                    detail_url=detail["detail_url"],
                    material=detail["material"],
                    primary_colors=detail["primary_colors"],
                    thickness=detail["thickness"],
                    finishes=detail["finishes"],
                    batch_number=batch.batch_number,
                    batch_dimensions=batch.dimensions,
                    batch_quantity_pcs=batch.quantity_pcs,
                    batch_status=batch.status,
                    batch_location=batch.location,
                    image_url=batch.image_url,
                )
            )

    return records


def export_records(records: list[MarbleSystemsSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"marble_systems_slabs_{stamp}.json"
    csv_path = output_dir / f"marble_systems_slabs_{stamp}.csv"

    payload = [record_payload(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "name",
                "detail_url",
                "material",
                "primary_colors",
                "thickness",
                "finishes",
                "batch_number",
                "batch_dimensions",
                "batch_quantity_pcs",
                "batch_status",
                "batch_location",
                "image_url",
            ],
        )
        writer.writeheader()
        for record in records:
            payload_row = record_payload(record)
            writer.writerow(
                {
                    "name": payload_row["name"],
                    "detail_url": payload_row["detail_url"],
                    "material": payload_row["material"],
                    "primary_colors": payload_row["primary_colors"],
                    "thickness": payload_row["thickness"],
                    "finishes": payload_row["finishes"],
                    "batch_number": payload_row["batch_number"],
                    "batch_dimensions": payload_row["batch_dimensions"],
                    "batch_quantity_pcs": payload_row["batch_quantity_pcs"],
                    "batch_status": payload_row["batch_status"],
                    "batch_location": payload_row["batch_location"],
                    "image_url": payload_row["image_url"],
                }
            )

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Marble Systems Fairfax, VA slab inventory.")
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
        open_listing_page(driver, wait, LISTING_URL)
        products = collect_listing_products(driver, wait, args.limit)
        records = scrape_detail_pages(driver, wait, products)
        json_path, csv_path = export_records(records, output_dir)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Collected %s Marble Systems slabs with Fairfax, VA batches", len(records))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
