"""
HanStone slab scraper.

Current scope:
- HanStone quartz listing collection
- Pagination-aware product collection
- Detail-page extraction for slab image and stats fields

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


BASE_URL = "https://hyundailncusa.com"
LISTING_URL = f"{BASE_URL}/colors?brand%5B%5D=hanstone-quartz"
PRODUCT_CARD_SELECTOR = "a.item"
PRODUCT_NAME_SELECTOR = ".caption, .details .name"
PAGINATION_NEXT_SELECTOR = "a.next, .pagination a.next, a[rel='next']"
DETAIL_IMAGE_LINK_SELECTOR = ".graphic a.zoom"
DETAIL_IMAGE_SELECTOR = ".graphic img"
DETAIL_STATS_SELECTOR = "p.stats"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/hanstone")
DEFAULT_LIMIT = 0
DEFAULT_MATERIAL = "Quartz"
KNOWN_COLOR_LABELS = {
    "black",
    "blue",
    "brown",
    "cream",
    "gold",
    "gray",
    "grey",
    "green",
    "red",
    "taupe",
    "warm",
    "cool",
    "white",
    "beige",
    "ivory",
}


@dataclass
class HanstoneSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    primary_colors: str | None
    accent_colors: str | None
    vein: str | None
    dimensions: str | None
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


def title_case_name(name: str) -> str:
    cleaned = " ".join((name or "").split()).strip()
    cleaned = re.sub(r"\s*-\s*[A-Z0-9]+$", "", cleaned)
    return cleaned.title() if cleaned.isupper() else cleaned


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str) -> None:
    logging.info("Opening HanStone listing page: %s", url)
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

        logging.info("Collecting HanStone listing page %s/%s: %s", page_index, len(page_urls), page_url)
        for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
            detail_url = urljoin(BASE_URL, (card.get_attribute("href") or "").strip())
            if detail_url.startswith("//"):
                detail_url = "https:" + detail_url
            if not detail_url or detail_url in seen_urls:
                continue

            name = ""
            try:
                name = safe_text(card.find_element(By.CSS_SELECTOR, ".caption"))
            except NoSuchElementException:
                pass
            if not name:
                try:
                    name = safe_text(card.find_element(By.CSS_SELECTOR, ".details .name"))
                except NoSuchElementException:
                    name = safe_text(card)

            if not name:
                continue

            products.append((title_case_name(name), detail_url))
            seen_urls.add(detail_url)
            if limit > 0 and len(products) >= limit:
                return products

    return products


def parse_stats_text(stats_text: str) -> dict[str, str]:
    info: dict[str, str] = {}
    lines = [line.strip() for line in stats_text.splitlines() if line.strip()]
    for line in lines:
        if ":" not in line:
            continue
        label, value = line.split(":", 1)
        info[label.strip().lower()] = value.strip()
    return info


def parse_dimensions(raw_value: str) -> str | None:
    match = re.search(r'(\d+(?:\.\d+)?)"\s*[x×]\s*(\d+(?:\.\d+)?)"', raw_value, flags=re.IGNORECASE)
    if match:
        return f"{match.group(1)} x {match.group(2)}"
    return None


def parse_colors(raw_value: str) -> tuple[str | None, str | None]:
    values = [part.strip().title() for part in raw_value.split(",") if part.strip()]
    normalized = []
    for value in values:
        lowered = value.lower()
        if lowered in KNOWN_COLOR_LABELS:
            normalized.append("Gray" if lowered == "grey" else value)
    normalized = list(dict.fromkeys(normalized))
    if not normalized:
        return None, None
    return normalized[0], ",".join(normalized[1:]) or None


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
) -> HanstoneSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_STATS_SELECTOR)))

    image_url = None
    try:
        link = driver.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_LINK_SELECTOR)
        raw_href = (link.get_attribute("href") or "").strip()
        image_url = urljoin(BASE_URL, raw_href) if raw_href else None
    except NoSuchElementException:
        try:
            image = driver.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_SELECTOR)
            raw_src = (image.get_attribute("src") or "").strip()
            image_url = urljoin(BASE_URL, raw_src) if raw_src else None
        except NoSuchElementException:
            pass

    stats_text = (driver.find_element(By.CSS_SELECTOR, DETAIL_STATS_SELECTOR).text or "").strip()
    info = parse_stats_text(stats_text)
    dimensions = parse_dimensions(info.get("slab size", ""))
    primary_colors, accent_colors = parse_colors(info.get("color palette", ""))
    vein = info.get("pattern", "").title() or None
    finishes = info.get("finish", "").title() or None

    return HanstoneSlabRecord(
        name=listing_name,
        detail_url=detail_url,
        image_url=image_url,
        primary_colors=primary_colors,
        accent_colors=accent_colors,
        vein=vein,
        dimensions=dimensions,
        finishes=finishes,
        material=DEFAULT_MATERIAL,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
) -> list[HanstoneSlabRecord]:
    records: list[HanstoneSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping HanStone detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url))

    return records


def export_records(records: list[HanstoneSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"hanstone_quartz_{stamp}.json"
    csv_path = output_dir / f"hanstone_quartz_{stamp}.csv"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "primary_colors": record.primary_colors,
            "accent_colors": record.accent_colors,
            "vein": record.vein,
            "dimensions": record.dimensions,
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
                "primary_colors",
                "accent_colors",
                "vein",
                "dimensions",
                "finishes",
                "material",
            ],
        )
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape HanStone quartz colors.")
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
        logging.info("Collected %s HanStone quartz slabs", len(records))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
