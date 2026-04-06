"""
Blue Planet slab scraper.

Current scope:
- Blue Planet all-stones index
- Pagination-aware listing traversal
- Detail-page extraction for product name, brand, stone type, and a single primary image
- Slow-site safeguards: longer waits, short stabilization delays, and one retry

This scraper intentionally keeps the output minimal for this supplier:
- name
- detail_url
- image_url
- material
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
from selenium.common.exceptions import NoSuchElementException, StaleElementReferenceException, TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://blueplanetrockks.com"
LISTING_TARGETS = [
    (
        f"{BASE_URL}/stone-type/quartz/basic-quartz/?filter_brand=maryland",
        "Quartz",
    ),
    (
        f"{BASE_URL}/stone-type/quartz/exotic-quartz/?filter_brand=maryland",
        "Quartz",
    ),
    (
        f"{BASE_URL}/stone-type/printed-quartz/?filter_brand=maryland",
        "Printed Quartz",
    ),
]
PRODUCT_CARD_SELECTOR = "div.etheme-product-grid-item"
PRODUCT_TITLE_LINK_SELECTOR = "h2.woocommerce-loop-product__title a"
PRODUCT_LINK_SELECTOR = "a[href*='/stones/']"
PAGINATION_LINK_SELECTOR = "nav.etheme-elementor-pagination a.page-numbers"
NEXT_PAGE_SELECTOR = "nav.etheme-elementor-pagination a.next.page-numbers"
DETAIL_IMAGE_LINK_SELECTOR = ".woocommerce-product-gallery__image a[href]"
DETAIL_NAME_SELECTOR = "h1.product_title, .product_title"
DETAIL_META_SELECTOR = "body"
DEFAULT_TIMEOUT_SEC = 35
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/blue_planet")
DEFAULT_PAGE_DELAY_SEC = 2.0
DEFAULT_DETAIL_RETRIES = 1
CHECKPOINT_JSON_NAME = "blue_planet_maryland_checkpoint.json"
CHECKPOINT_CSV_NAME = "blue_planet_maryland_checkpoint.csv"
FAILED_URLS_NAME = "blue_planet_maryland_failed_urls.json"


@dataclass
class BluePlanetSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    material: str


def record_to_dict(record: BluePlanetSlabRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "detail_url": record.detail_url,
        "image_url": record.image_url,
        "material": record.material,
    }


def load_checkpoint(output_dir: Path) -> tuple[list[BluePlanetSlabRecord], list[str]]:
    checkpoint_path = output_dir / CHECKPOINT_JSON_NAME
    failed_urls_path = output_dir / FAILED_URLS_NAME

    records: list[BluePlanetSlabRecord] = []
    failed_urls: list[str] = []

    if checkpoint_path.exists():
        payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        for row in payload:
            records.append(
                BluePlanetSlabRecord(
                    name=str(row.get("name") or "").strip(),
                    detail_url=str(row.get("detail_url") or "").strip(),
                    image_url=(str(row.get("image_url")).strip() if row.get("image_url") else None),
                    material=str(row.get("material") or "").strip(),
                )
            )

    if failed_urls_path.exists():
        payload = json.loads(failed_urls_path.read_text(encoding="utf-8"))
        failed_urls = [str(url).strip() for url in payload if str(url).strip()]

    return records, failed_urls


def write_checkpoint(
    records: list[BluePlanetSlabRecord],
    failed_urls: list[str],
    output_dir: Path,
) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_json_path = output_dir / CHECKPOINT_JSON_NAME
    checkpoint_csv_path = output_dir / CHECKPOINT_CSV_NAME
    failed_urls_path = output_dir / FAILED_URLS_NAME

    payload = [record_to_dict(record) for record in records]
    checkpoint_json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    with checkpoint_csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["name", "detail_url", "image_url", "material"])
        writer.writeheader()
        writer.writerows(payload)

    failed_urls_path.write_text(json.dumps(sorted(set(failed_urls)), indent=2, ensure_ascii=True), encoding="utf-8")

    return checkpoint_json_path, checkpoint_csv_path, failed_urls_path


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


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, listing_url: str, delay_sec: float) -> None:
    logging.info("Opening Blue Planet listing page: %s", listing_url)
    driver.get(listing_url)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))
    time.sleep(delay_sec)


def collect_listing_page_urls(driver: webdriver.Chrome, listing_url: str) -> list[str]:
    page_urls: list[str] = []
    current_url = listing_url
    seen_urls: set[str] = set()

    while current_url:
        normalized_current = current_url.rstrip("/")
        if normalized_current in seen_urls:
            break

        logging.info("Inspecting Blue Planet pagination page: %s", current_url)
        if not page_urls:
            open_listing_page(driver, wait=WebDriverWait(driver, DEFAULT_TIMEOUT_SEC), listing_url=current_url, delay_sec=DEFAULT_PAGE_DELAY_SEC)
        else:
            open_listing_page(driver, wait=WebDriverWait(driver, DEFAULT_TIMEOUT_SEC), listing_url=current_url, delay_sec=DEFAULT_PAGE_DELAY_SEC)

        page_urls.append(current_url)
        seen_urls.add(normalized_current)

        next_links = driver.find_elements(By.CSS_SELECTOR, NEXT_PAGE_SELECTOR)
        if not next_links:
            logging.info("No Blue Planet next-page link found after: %s", current_url)
            break

        next_href = urljoin(BASE_URL, (next_links[0].get_attribute("href") or "").strip())
        if not next_href or next_href.rstrip("/") in seen_urls:
            logging.info("Blue Planet pagination ended at: %s", current_url)
            break
        current_url = next_href

    return page_urls


def collect_listing_products(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_url: str,
    delay_sec: float,
) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()

    page_urls = collect_listing_page_urls(driver, listing_url)

    for page_index, page_url in enumerate(page_urls, start=1):
        open_listing_page(driver, wait, page_url, delay_sec)

        logging.info("Collecting Blue Planet listing page %s/%s: %s", page_index, len(page_urls), page_url)

        cards = driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)
        if cards:
            for card in cards:
                try:
                    link = card.find_element(By.CSS_SELECTOR, PRODUCT_TITLE_LINK_SELECTOR)
                except NoSuchElementException:
                    continue

                detail_url = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
                name = safe_text(link)
                if "/quartz/" not in detail_url and "quartz" not in name.lower():
                    continue
                if not detail_url or not name or detail_url in seen_urls:
                    continue

                products.append((name, detail_url))
                seen_urls.add(detail_url)
            continue

        # Fallback for slower/theme-shifted Blue Planet pages where the product
        # card wrapper is unreliable but the title links still render.
        for link in driver.find_elements(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR):
            detail_url = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
            name = safe_text(link)
            if "/stones/" not in detail_url or not detail_url or not name or detail_url in seen_urls:
                continue
            if "/quartz/" not in detail_url and "quartz" not in name.lower():
                continue

            products.append((name, detail_url))
            seen_urls.add(detail_url)

    return products


def extract_meta_value(page_text: str, label: str) -> str | None:
    match = re.search(
        rf"{re.escape(label)}\s*:\s*(.*?)(?:Add to Wishlist|Add to Compare|SHIPPING & RETURNS POLICY|Relates Stones|$)",
        page_text,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None

    value = " ".join(match.group(1).replace(",", " ").split()).strip()
    return value or None


def normalize_material_from_stone_type(stone_type: str | None) -> str | None:
    value = (stone_type or "").strip().lower()
    if value in {"basic-quartz", "exotic-quartz"}:
        return "Quartz"
    if value == "printed-quartz":
        return "Printed Quartz"
    return None


def collect_primary_image_url(driver: webdriver.Chrome) -> str | None:
    seen_urls: list[str] = []
    for link in driver.find_elements(By.CSS_SELECTOR, DETAIL_IMAGE_LINK_SELECTOR):
        raw_href = (link.get_attribute("href") or "").strip()
        normalized = urljoin(BASE_URL, raw_href) if raw_href else None
        if normalized and normalized not in seen_urls:
            seen_urls.append(normalized)

    return seen_urls[0] if seen_urls else None


def collect_detail_record_once(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
    delay_sec: float,
) -> BluePlanetSlabRecord:
    logging.info("Opening Blue Planet detail page: %s", detail_url)
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_IMAGE_LINK_SELECTOR)))
    time.sleep(delay_sec)

    page_name = listing_name
    try:
        title = driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)
        page_name = safe_text(title) or listing_name
    except NoSuchElementException:
        pass

    page_text = driver.find_element(By.CSS_SELECTOR, DETAIL_META_SELECTOR).text
    stone_type = extract_meta_value(page_text, "Stone Type")
    material = normalize_material_from_stone_type(stone_type)
    if not material:
        raise NoSuchElementException(f"Unsupported Blue Planet stone type for {detail_url}: {stone_type}")

    brands = extract_meta_value(page_text, "Brand") or ""
    brand_tokens = {token.strip().lower() for token in brands.split() if token.strip()}
    if "maryland" not in brand_tokens:
        raise NoSuchElementException(f"Blue Planet detail is not a Maryland stone: {detail_url}")

    image_url = collect_primary_image_url(driver)

    return BluePlanetSlabRecord(
        name=page_name,
        detail_url=detail_url,
        image_url=image_url,
        material=material,
    )


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
    delay_sec: float,
    retries: int,
) -> BluePlanetSlabRecord:
    last_error = None
    for attempt in range(retries + 1):
        try:
            return collect_detail_record_once(driver, wait, listing_name, detail_url, delay_sec)
        except (TimeoutException, NoSuchElementException, StaleElementReferenceException) as error:
            last_error = error
            logging.warning(
                "Blue Planet detail failed on attempt %s/%s: %s",
                attempt + 1,
                retries + 1,
                detail_url,
            )
            logging.warning("Blue Planet detail failure type: %s", type(error).__name__)
            time.sleep(delay_sec)

    raise last_error or RuntimeError(f"Unable to scrape detail page: {detail_url}")


def scrape_catalog(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    delay_sec: float,
    retries: int,
    output_dir: Path,
    resume: bool,
) -> list[BluePlanetSlabRecord]:
    product_links: list[tuple[str, str, str]] = []
    seen_urls: set[str] = set()
    for listing_url, forced_material in LISTING_TARGETS:
        logging.info("Opening Blue Planet target catalog: %s", listing_url)
        category_products = collect_listing_products(driver, wait, listing_url, delay_sec)
        for listing_name, detail_url in category_products:
            if detail_url in seen_urls:
                continue
            product_links.append((listing_name, detail_url, forced_material))
            seen_urls.add(detail_url)

    logging.info("Collected %s products from Blue Planet target listings", len(product_links))

    records: list[BluePlanetSlabRecord] = []
    failed_urls: list[str] = []
    scraped_urls: set[str] = set()
    if resume:
        records, failed_urls = load_checkpoint(output_dir)
        scraped_urls = {record.detail_url for record in records if record.detail_url}
        if scraped_urls or failed_urls:
            logging.info(
                "Resuming Blue Planet from checkpoint: %s saved, %s failed",
                len(scraped_urls),
                len(set(failed_urls)),
            )

    for index, (listing_name, detail_url, forced_material) in enumerate(product_links, start=1):
        if detail_url in scraped_urls:
            logging.info(
                "Skipping Blue Planet detail %s/%s (already checkpointed): %s",
                index,
                len(product_links),
                detail_url,
            )
            continue

        logging.info(
            "Scraping Blue Planet detail %s/%s: %s",
            index,
            len(product_links),
            detail_url,
        )
        try:
            records.append(
                BluePlanetSlabRecord(
                    **{
                        **record_to_dict(
                            collect_detail_record(
                                driver,
                                wait,
                                listing_name,
                                detail_url,
                                delay_sec,
                                retries,
                            )
                        ),
                        "material": forced_material,
                    }
                )
            )
            scraped_urls.add(detail_url)
            failed_urls = [url for url in failed_urls if url != detail_url]
            write_checkpoint(records, failed_urls, output_dir)
        except Exception as error:
            logging.warning("Skipping Blue Planet detail after retries: %s (%s)", detail_url, type(error).__name__)
            if detail_url not in failed_urls:
                failed_urls.append(detail_url)
            write_checkpoint(records, failed_urls, output_dir)

    return records


def export_records(records: list[BluePlanetSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"blue_planet_maryland_{stamp}.json"
    csv_path = output_dir / f"blue_planet_maryland_{stamp}.csv"

    payload = [record_to_dict(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["name", "detail_url", "image_url", "material"])
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Blue Planet Maryland quartz and printed quartz slabs.")
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
        "--page-delay-sec",
        type=float,
        default=DEFAULT_PAGE_DELAY_SEC,
        help="Extra delay after listing/detail loads for this slower supplier site.",
    )
    parser.add_argument(
        "--detail-retries",
        type=int,
        default=DEFAULT_DETAIL_RETRIES,
        help="How many times to retry a slow detail page before skipping it.",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore any existing Blue Planet checkpoint files and start from scratch.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)

    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        logging.info("Opening Blue Planet target catalogs")
        records = scrape_catalog(
            driver,
            wait,
            args.page_delay_sec,
            max(0, args.detail_retries),
            output_dir,
            resume=not args.no_resume,
        )

        json_path, csv_path = export_records(records, output_dir)
        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading Blue Planet listing or detail pages") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
