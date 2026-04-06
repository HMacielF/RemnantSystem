"""
MSI Surfaces slab scraper.

Current scope:
- Quartz collections listing
- Conservative detail-page scraping with a default 7-product limit
- Product detail extraction for slab image and visible spec blocks
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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.msisurfaces.com"
LISTING_URL = f"{BASE_URL}/quartz-countertops/quartz-collections/"
PRODUCT_LINK_SELECTOR = "a.productid"
DETAIL_NAME_SELECTOR = ".pd-name h1"
DETAIL_SPEC_ROW_SELECTOR = ".ps-descbox"
DETAIL_IMAGE_SELECTOR = "a.MagicZoom.slab-zoom#mzpGallery"
DETAIL_QPLUS_SELECTOR = ".pd-name .space-top a[href*='/quartz-countertops/q-plus/'], .product-highlights a[href*='/quartz-countertops/q-plus/']"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/msi")
DEFAULT_LIMIT = 7
DEFAULT_MATERIAL = "Quartz"
CHECKPOINT_JSON_NAME = "msi_quartz_checkpoint.json"
CHECKPOINT_CSV_NAME = "msi_quartz_checkpoint.csv"
FAILED_URLS_NAME = "msi_quartz_failed_urls.json"


@dataclass
class MsiSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    primary_colors: str | None
    accent_colors: str | None
    style: str | None
    finishes: str | None
    material: str


def record_to_payload(record: MsiSlabRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "detail_url": record.detail_url,
        "image_url": record.image_url,
        "primary_colors": record.primary_colors,
        "accent_colors": record.accent_colors,
        "style": record.style,
        "finishes": record.finishes,
        "material": record.material,
    }


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_options(headless: bool) -> Options:
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,2200")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    return options


def create_driver(headless: bool = True) -> webdriver.Chrome:
    return webdriver.Chrome(options=build_options(headless))


def safe_text(element) -> str:
    return " ".join((element.text or "").split())

def detect_product_material(driver: webdriver.Chrome) -> str:
    qplus_nodes = driver.find_elements(By.CSS_SELECTOR, DETAIL_QPLUS_SELECTOR)
    return "Printed Quartz" if qplus_nodes else DEFAULT_MATERIAL


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    driver.get(LISTING_URL)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR)))


def collect_listing_products(driver: webdriver.Chrome, limit: int) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()

    for link in driver.find_elements(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR):
        href = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
        if not href or href in seen_urls:
            continue

        aria_name = (link.get_attribute("aria-label") or "").strip()
        normalized_name = aria_name.removesuffix(" product page").strip()
        if not normalized_name:
            normalized_name = safe_text(link)

        products.append((normalized_name, href))
        seen_urls.add(href)

        if len(products) >= limit:
            break

    return products


def collect_specs(driver: webdriver.Chrome) -> dict[str, str]:
    specs: dict[str, str] = {}

    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_SPEC_ROW_SELECTOR):
        try:
            label = row.find_element(By.CSS_SELECTOR, "b")
            value = row.find_element(By.CSS_SELECTOR, "label")
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
) -> MsiSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_SPEC_ROW_SELECTOR)))

    page_name = listing_name
    try:
        title = driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)
        page_name = safe_text(title) or listing_name
    except NoSuchElementException:
        pass

    specs = collect_specs(driver)

    image_url = None
    try:
        image_link = driver.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_SELECTOR)
        raw_href = (image_link.get_attribute("href") or "").strip()
        image_url = urljoin(BASE_URL, raw_href) if raw_href else None
    except NoSuchElementException:
        pass

    material = detect_product_material(driver)

    return MsiSlabRecord(
        name=page_name,
        detail_url=detail_url,
        image_url=image_url,
        primary_colors=specs.get("primary color(s)"),
        accent_colors=specs.get("accent color(s)"),
        style=specs.get("style"),
        finishes=specs.get("available finishes"),
        material=material,
    )


def checkpoint_paths(output_dir: Path) -> tuple[Path, Path, Path]:
    return (
        output_dir / CHECKPOINT_JSON_NAME,
        output_dir / CHECKPOINT_CSV_NAME,
        output_dir / FAILED_URLS_NAME,
    )


def write_records_csv(csv_path: Path, records: list[MsiSlabRecord]) -> None:
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "name",
                "detail_url",
                "image_url",
                "primary_colors",
                "accent_colors",
                "style",
                "finishes",
                "material",
            ],
        )
        writer.writeheader()
        writer.writerows(record_to_payload(record) for record in records)


def write_checkpoint(output_dir: Path, records: list[MsiSlabRecord], failed_urls: list[str]) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path, csv_path, failed_urls_path = checkpoint_paths(output_dir)

    payload = [record_to_payload(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    write_records_csv(csv_path, records)
    failed_urls_path.write_text(json.dumps(failed_urls, indent=2, ensure_ascii=True), encoding="utf-8")

    return json_path, csv_path, failed_urls_path


def load_checkpoint(output_dir: Path) -> list[MsiSlabRecord]:
    json_path, _, _ = checkpoint_paths(output_dir)
    if not json_path.exists():
        return []

    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logging.warning("Checkpoint file exists but could not be parsed; starting fresh")
        return []

    records: list[MsiSlabRecord] = []
    for item in payload:
        records.append(
            MsiSlabRecord(
                name=item.get("name") or "",
                detail_url=item.get("detail_url") or "",
                image_url=item.get("image_url"),
                primary_colors=item.get("primary_colors"),
                accent_colors=item.get("accent_colors"),
                style=item.get("style"),
                finishes=item.get("finishes"),
                material=item.get("material") or DEFAULT_MATERIAL,
            )
        )

    return records


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    product_links: list[tuple[str, str]],
    output_dir: Path,
    existing_records: list[MsiSlabRecord] | None = None,
) -> list[MsiSlabRecord]:
    records: list[MsiSlabRecord] = list(existing_records or [])
    failed_urls: list[str] = []
    completed_urls = {record.detail_url for record in records if record.detail_url}
    remaining_links = [(name, url) for name, url in product_links if url not in completed_urls]

    if completed_urls:
        logging.info("Resuming from checkpoint with %s completed records", len(completed_urls))

    for index, (listing_name, detail_url) in enumerate(remaining_links, start=1):
        logging.info(
            "Scraping detail %s/%s: %s",
            len(records) + 1,
            len(product_links),
            detail_url,
        )
        try:
            record = collect_detail_record(driver, wait, listing_name, detail_url)
        except TimeoutException:
            logging.warning("Timed out on detail page, skipping for now: %s", detail_url)
            failed_urls.append(detail_url)
            write_checkpoint(output_dir, records, failed_urls)
            continue

        records.append(record)
        write_checkpoint(output_dir, records, failed_urls)

    return records


def export_records(records: list[MsiSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"msi_quartz_{stamp}.json"
    csv_path = output_dir / f"msi_quartz_{stamp}.csv"

    payload = [record_to_payload(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    write_records_csv(csv_path, records)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape MSI quartz slabs conservatively for testing.")
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
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore any MSI checkpoint files and start the detail scrape from scratch.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    limit = max(1, args.limit)
    existing_records = [] if args.no_resume else load_checkpoint(output_dir)

    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        logging.info("Opening MSI quartz listing: %s", LISTING_URL)
        open_listing_page(driver, wait)
        product_links = collect_listing_products(driver, limit)
        logging.info("Collected %s product links for this run", len(product_links))

        records = scrape_detail_pages(driver, wait, product_links, output_dir, existing_records)
        json_path, csv_path = export_records(records, output_dir)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        checkpoint_json_path, checkpoint_csv_path, failed_urls_path = checkpoint_paths(output_dir)
        logging.info("Checkpoint JSON: %s", checkpoint_json_path)
        logging.info("Checkpoint CSV: %s", checkpoint_csv_path)
        logging.info("Failed URLs JSON: %s", failed_urls_path)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading MSI listing or detail pages") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
