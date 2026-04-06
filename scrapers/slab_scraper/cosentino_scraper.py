"""
Cosentino slab scraper.

Current scope:
- Brand-driven Cosentino color catalog listing
- Pagination-aware product collection
- Detail-page extraction for image/spec fields
- Respects the published 10-second crawl delay

This scraper intentionally lives outside the remnant sync flow so supplier slab
catalog work can evolve independently from Moraware remnant ingestion.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import time
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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.cosentino.com"
SUPPORTED_BRANDS = ("silestone", "dekton")
BRAND_URLS = {
    "silestone": f"{BASE_URL}/usa/colors/silestone/",
    "dekton": f"{BASE_URL}/usa/colors/dekton/",
}
BRAND_MATERIALS = {
    "silestone": "Quartz",
    "dekton": "Porcelain",
}
PRODUCT_CARD_SELECTOR = ".inspiration"
PRODUCT_LINK_SELECTOR = "a.stretched-link"
PRODUCT_NAME_SELECTOR = ".info .title"
CARD_BADGE_SELECTOR = ".bottom-badge"
PAGINATION_NEXT_SELECTOR = "a.next.page-numbers, .pagination a.next"
DETAIL_READY_SELECTOR = ".row.extra, .color-vista-zoomed__title"
DETAIL_FINISH_SELECTOR = ".propiedades.a_acabados .acabados_content_title"
DETAIL_THICKNESS_SELECTOR = ".espesores-content .span-espesor"
DETAIL_DIMENSIONS_SELECTOR = "#collapse-formatos dd.text, .format dd.text"
DETAIL_IMAGE_LINK_SELECTOR = ".color-vista-zoomed__title a.enlace-mood, .color-image-detail a.stretched-link"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/cosentino")
DEFAULT_LIMIT = 0
DEFAULT_CRAWL_DELAY_SEC = 10.0


@dataclass
class CosentinoSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    dimensions: str | None
    thickness: str | None
    finishes: str | None
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


def open_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str, ready_selector: str, crawl_delay_sec: float) -> None:
    logging.info("Opening Cosentino page: %s", url)
    driver.get(url)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, ready_selector)))
    if crawl_delay_sec > 0:
        time.sleep(crawl_delay_sec)


def title_case_name(name: str) -> str:
    cleaned = " ".join((name or "").split()).strip()
    return cleaned.title() if cleaned.isupper() else cleaned


def parse_dimensions(raw_text: str) -> str | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*in", raw_text, flags=re.IGNORECASE)
    if match:
        return f"{match.group(1)} x {match.group(2)}"
    return None


def normalize_thickness(values: list[str]) -> str | None:
    cleaned: list[str] = []
    for value in values:
        normalized = value.replace(",", ".").strip().lower()
        normalized = normalized.replace(" ", "")
        if normalized.endswith("cm"):
            cleaned.append(normalized)
    cleaned = list(dict.fromkeys(cleaned))
    return ",".join(cleaned) if cleaned else None


def normalize_finishes(values: list[str]) -> str | None:
    cleaned: list[str] = []
    for value in values:
        normalized = " ".join(value.split()).strip()
        if normalized:
            cleaned.append(normalized.title())
    cleaned = list(dict.fromkeys(cleaned))
    return ",".join(cleaned) if cleaned else None


def collect_listing_page_urls(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    brand: str,
    crawl_delay_sec: float,
) -> list[str]:
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

        open_page(driver, wait, next_href, PRODUCT_CARD_SELECTOR, crawl_delay_sec)
        current_url = driver.current_url

    return page_urls


def should_skip_card(card) -> bool:
    badges = card.find_elements(By.CSS_SELECTOR, CARD_BADGE_SELECTOR)
    if not badges:
        return False

    for badge in badges:
        class_name = (badge.get_attribute("class") or "").lower()
        if "lowes-badge" in class_name or "home" in class_name or "depot" in class_name:
            return True
    return False


def collect_listing_products(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    brand: str,
    limit: int,
    crawl_delay_sec: float,
) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    page_urls = collect_listing_page_urls(driver, wait, brand, crawl_delay_sec)

    for page_index, page_url in enumerate(page_urls, start=1):
        if driver.current_url.rstrip("/") != page_url.rstrip("/"):
            open_page(driver, wait, page_url, PRODUCT_CARD_SELECTOR, crawl_delay_sec)

        logging.info("Collecting Cosentino listing page %s/%s: %s", page_index, len(page_urls), page_url)
        for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
            if should_skip_card(card):
                continue

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
                name = (card.get_attribute("data-title") or "").strip()

            if not name:
                continue

            products.append((title_case_name(name), detail_url))
            seen_urls.add(detail_url)
            if limit > 0 and len(products) >= limit:
                return products

    return products


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
    brand: str,
    crawl_delay_sec: float,
) -> CosentinoSlabRecord:
    open_page(driver, wait, detail_url, DETAIL_READY_SELECTOR, crawl_delay_sec)

    finishes = normalize_finishes([safe_text(node) for node in driver.find_elements(By.CSS_SELECTOR, DETAIL_FINISH_SELECTOR)])
    thickness = normalize_thickness([safe_text(node) for node in driver.find_elements(By.CSS_SELECTOR, DETAIL_THICKNESS_SELECTOR)])

    dimensions = None
    for node in driver.find_elements(By.CSS_SELECTOR, DETAIL_DIMENSIONS_SELECTOR):
        parsed = parse_dimensions(safe_text(node))
        if parsed:
            dimensions = parsed
            break

    image_url = None
    for link in driver.find_elements(By.CSS_SELECTOR, DETAIL_IMAGE_LINK_SELECTOR):
        href = (link.get_attribute("href") or "").strip()
        if href:
            image_url = urljoin(BASE_URL, href)
            break

    return CosentinoSlabRecord(
        name=listing_name,
        detail_url=detail_url,
        image_url=image_url,
        dimensions=dimensions,
        thickness=thickness,
        finishes=finishes,
        material=BRAND_MATERIALS[brand],
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
    brand: str,
    crawl_delay_sec: float,
) -> list[CosentinoSlabRecord]:
    records: list[CosentinoSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping Cosentino detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url, brand, crawl_delay_sec))

    return records


def export_records(records: list[CosentinoSlabRecord], output_dir: Path, brand: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"cosentino_{brand}_{stamp}.json"
    csv_path = output_dir / f"cosentino_{brand}_{stamp}.csv"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "dimensions": record.dimensions,
            "thickness": record.thickness,
            "finishes": record.finishes,
            "material": record.material,
        }
        for record in records
    ]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "name",
                "detail_url",
                "image_url",
                "dimensions",
                "thickness",
                "finishes",
                "material",
            ],
        )
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Cosentino colors by brand.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--brand",
        choices=SUPPORTED_BRANDS,
        default="silestone",
        help="Cosentino brand to scrape.",
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
    parser.add_argument(
        "--crawl-delay-sec",
        type=float,
        default=DEFAULT_CRAWL_DELAY_SEC,
        help="Delay between requests to respect the site's crawl guidance.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    listing_url = BRAND_URLS[args.brand]
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_page(driver, wait, listing_url, PRODUCT_CARD_SELECTOR, args.crawl_delay_sec)
        products = collect_listing_products(driver, wait, args.brand, args.limit, args.crawl_delay_sec)
        records = scrape_detail_pages(driver, wait, products, args.brand, args.crawl_delay_sec)
        json_path, csv_path = export_records(records, output_dir, args.brand)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Collected %s Cosentino %s slabs", len(records), args.brand)
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
