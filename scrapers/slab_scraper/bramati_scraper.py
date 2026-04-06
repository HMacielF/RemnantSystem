"""
Bramati slab scraper.

Current scope:
- Category-driven Bramati product listing with pagination
- Attempts to switch to the 60-per-page view first
- Extracts product information directly from the listing cards and inline modal

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
from urllib.parse import urljoin, urlparse

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from selenium.webdriver.support.ui import WebDriverWait


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://bramati.com"
SUPPORTED_CATEGORIES = ("quartz", "marble", "granite", "quartzite", "soapstone")
PER_PAGE_SELECT_SELECTOR = ".woocommerce-perpage select"
PRODUCT_CARD_SELECTOR = ".card.h-100"
CARD_MODAL_TRIGGER_SELECTOR = ".card-top-img a[href^='#modal-']"
CARD_NAME_SELECTOR = ".card-body h5"
CARD_BLOCK_SELECTOR = ".card-body p"
CARD_DETAIL_LINK_SELECTOR = ".card-body h5 a.button, .modal-body a.button"
CARD_TYPE_SELECTOR = ".card-footer"
PAGINATION_NEXT_SELECTOR = "nav.woocommerce-pagination a.next.page-numbers"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/bramati")
DEFAULT_CATEGORY = "quartz"
FINISH_KEYWORDS = {
    "polished": "Polished",
    "honed": "Honed",
    "leathered": "Leathered",
    "leather": "Leathered",
    "brushed": "Brushed",
    "flamed": "Flamed",
    "dual": "Dual",
}


@dataclass
class BramatiSlabRecord:
    name: str
    detail_url: str | None
    image_url: str | None
    block_number: str | None
    dimensions: str | None
    thickness: str | None
    finishes: str | None
    material: str


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_listing_url(category_slug: str) -> str:
    return f"{BASE_URL}/?product_cat={category_slug}&post_type=product&s="


def material_label_from_category(category_slug: str) -> str:
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


def clean_material_text(material_text: str, category_slug: str) -> str:
    normalized = " ".join((material_text or "").split()).strip().title()
    category_label = material_label_from_category(category_slug)
    if not normalized:
        return category_label

    normalized_tokens = [token.strip() for token in normalized.split(",") if token.strip()]
    for token in normalized_tokens:
        if token.lower() == category_label.lower():
            return category_label

    return category_label


def normalize_name(raw_name: str, category_slug: str) -> tuple[str, str | None, str | None]:
    cleaned = " ".join((raw_name or "").split()).strip()
    lower_cleaned = cleaned.lower()
    extracted_finishes: list[str] = []
    thickness_override = None

    thickness_match = re.search(r"\b([23]\s*cm)\b", cleaned, re.IGNORECASE)
    if thickness_match:
        thickness_override = thickness_match.group(1).replace(" ", "").lower()

    for keyword, normalized_finish in FINISH_KEYWORDS.items():
        if re.search(rf"\b{re.escape(keyword)}\b", lower_cleaned, re.IGNORECASE):
            extracted_finishes.append(normalized_finish)
            cleaned = re.sub(rf"\b{re.escape(keyword)}\b", " ", cleaned, flags=re.IGNORECASE)
            lower_cleaned = cleaned.lower()

    cleaned = re.sub(r"\bjumbo\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b3\s*cm\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b2\s*cm\b", " ", cleaned, flags=re.IGNORECASE)

    material_tokens = [
        material_label_from_category(category_slug),
        "Quartz",
        "Marble",
        "Granite",
        "Quartzite",
        "Soapstone",
    ]
    for token in material_tokens:
        cleaned = re.sub(rf"\b{re.escape(token)}\b", " ", cleaned, flags=re.IGNORECASE)

    cleaned = " ".join(cleaned.split()).strip(" -")
    cleaned = cleaned.title()
    unique_finishes = list(dict.fromkeys(extracted_finishes))
    if len(unique_finishes) == 1:
        finish_value = unique_finishes[0]
    elif len(unique_finishes) > 1:
        finish_value = ", ".join(unique_finishes)
    else:
        finish_value = "Polished"
    return cleaned, finish_value, thickness_override


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str) -> None:
    logging.info("Opening Bramati listing page: %s", url)
    driver.get(url)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def try_switch_to_per_page_60(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    try:
        select_el = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, PER_PAGE_SELECT_SELECTOR)))
    except TimeoutException:
        logging.info("Bramati per-page select not found; continuing with default pagination")
        return

    try:
        select = Select(select_el)
        matching_value = next(
            (
                option.get_attribute("value")
                for option in select.options
                if "perpage=60" in (option.get_attribute("value") or "")
            ),
            None,
        )
        if not matching_value:
            logging.info("Bramati 60-per-page option not found; continuing with current page size")
            return

        target_url = urljoin(BASE_URL, matching_value)
        if driver.current_url.rstrip("/") == target_url.rstrip("/"):
            return

        logging.info("Switching Bramati listing to 60-per-page view")
        driver.get(target_url)
        wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))
    except Exception as error:
        logging.info("Unable to switch Bramati to 60-per-page view: %s", type(error).__name__)


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


def parse_background_image_url(style_value: str) -> str | None:
    match = re.search(r"url\((['\"]?)(.*?)\1\)", style_value or "", re.IGNORECASE)
    if not match:
        return None
    return urljoin(BASE_URL, match.group(2).strip())


def parse_block_number(raw_text: str) -> str | None:
    match = re.search(r"block\s*#\s*:?\s*(.+)$", raw_text, re.IGNORECASE)
    return match.group(1).strip() if match else None


def parse_size_value(size_text: str) -> tuple[str | None, str | None]:
    cleaned = " ".join(size_text.split())
    if not cleaned:
        return None, None

    parts = [part.strip() for part in cleaned.split(";") if part.strip()]
    dimensions = parts[0] if parts else None
    thickness = parts[1] if len(parts) > 1 else None
    return dimensions, thickness


def element_text_content(element) -> str:
    raw = (element.get_attribute("textContent") or "").strip()
    return " ".join(raw.split())


def extract_modal_size_values(modal) -> tuple[str | None, str | None]:
    for section in modal.find_elements(By.CSS_SELECTOR, ".size"):
        text = element_text_content(section)
        if "SIZE" not in text.upper():
            continue

        size_value = text.split("SIZE", 1)[-1].strip() if "SIZE" in text.upper() else text
        dimensions, thickness = parse_size_value(size_value)
        if dimensions or thickness:
            return dimensions, thickness

    return None, None


def find_modal(driver: webdriver.Chrome, modal_href: str):
    raw_value = (modal_href or "").strip()
    if not raw_value:
        return None

    parsed = urlparse(raw_value)
    modal_id = (parsed.fragment or raw_value.lstrip("#")).strip()
    if not modal_id:
        return None
    try:
        return driver.find_element(By.ID, modal_id)
    except NoSuchElementException:
        return None


def collect_card_record(driver: webdriver.Chrome, card, category_slug: str) -> BramatiSlabRecord | None:
    try:
        modal_trigger = card.find_element(By.CSS_SELECTOR, CARD_MODAL_TRIGGER_SELECTOR)
        name_el = card.find_element(By.CSS_SELECTOR, CARD_NAME_SELECTOR)
    except NoSuchElementException:
        return None

    raw_name = safe_text(name_el)
    name, finish_from_name, thickness_from_name = normalize_name(raw_name, category_slug)
    if not name:
        return None

    detail_url = None
    try:
        detail_link = card.find_element(By.CSS_SELECTOR, CARD_DETAIL_LINK_SELECTOR)
        detail_url = urljoin(BASE_URL, (detail_link.get_attribute("href") or "").strip())
    except NoSuchElementException:
        pass

    material = material_label_from_category(category_slug)
    try:
        material_text = safe_text(card.find_element(By.CSS_SELECTOR, CARD_TYPE_SELECTOR))
        if material_text:
            material = clean_material_text(material_text, category_slug)
    except NoSuchElementException:
        pass

    block_number = None
    try:
        block_number = parse_block_number(safe_text(card.find_element(By.CSS_SELECTOR, CARD_BLOCK_SELECTOR)))
    except NoSuchElementException:
        pass

    image_url = None
    dimensions = None
    thickness = None
    finishes = finish_from_name

    modal_ref = (modal_trigger.get_attribute("data-target") or "").strip() or (modal_trigger.get_attribute("href") or "").strip()
    modal = find_modal(driver, modal_ref)
    if modal is not None:
        try:
            modal_image_header = modal.find_element(By.CSS_SELECTOR, ".modal-image-header")
            image_url = parse_background_image_url(modal_image_header.get_attribute("style") or "")
        except NoSuchElementException:
            pass

        if not detail_url:
            try:
                modal_link = modal.find_element(By.CSS_SELECTOR, CARD_DETAIL_LINK_SELECTOR)
                detail_url = urljoin(BASE_URL, (modal_link.get_attribute("href") or "").strip())
            except NoSuchElementException:
                pass

        dimensions, thickness = extract_modal_size_values(modal)

        if not block_number:
            try:
                block_section = modal.find_element(By.CSS_SELECTOR, ".block-number h3")
                block_number = parse_block_number(safe_text(block_section))
            except NoSuchElementException:
                pass

    if thickness_from_name:
        thickness = thickness_from_name

    return BramatiSlabRecord(
        name=name,
        detail_url=detail_url,
        image_url=image_url,
        block_number=block_number,
        dimensions=dimensions,
        thickness=thickness,
        finishes=finishes,
        material=material or material_label_from_category(category_slug),
    )


def collect_listing_products(driver: webdriver.Chrome, wait: WebDriverWait, category_slug: str) -> list[BramatiSlabRecord]:
    records: list[BramatiSlabRecord] = []
    seen_keys: set[str] = set()
    page_urls = collect_listing_page_urls(driver, wait)

    for page_index, page_url in enumerate(page_urls, start=1):
        if driver.current_url.rstrip("/") != page_url.rstrip("/"):
            open_listing_page(driver, wait, page_url)

        logging.info("Collecting Bramati listing page %s/%s: %s", page_index, len(page_urls), page_url)
        for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
            record = collect_card_record(driver, card, category_slug)
            if not record:
                continue

            dedupe_key = record.detail_url or f"{record.name}|{record.block_number or ''}"
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            records.append(record)

    return records


def apply_limit(records: list[BramatiSlabRecord], limit: int | None) -> list[BramatiSlabRecord]:
    if limit is None or limit <= 0:
        return records
    return records[:limit]


def export_records(records: list[BramatiSlabRecord], output_dir: Path, category_slug: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    slug_token = category_slug.strip("/").replace("-", "_")
    json_path = output_dir / f"bramati_{slug_token}_{stamp}.json"
    csv_path = output_dir / f"bramati_{slug_token}_{stamp}.csv"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "block_number": record.block_number,
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
                "block_number",
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
    parser = argparse.ArgumentParser(description="Scrape Bramati quartz slabs from listing cards and inline modals.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--category",
        choices=SUPPORTED_CATEGORIES,
        default=DEFAULT_CATEGORY,
        help="Bramati category slug to scrape.",
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
        default=0,
        help="Optional max number of records to export from the collected listing.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    listing_url = build_listing_url(args.category)

    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_listing_page(driver, wait, listing_url)
        try_switch_to_per_page_60(driver, wait)
        records = apply_limit(collect_listing_products(driver, wait, args.category), args.limit)

        json_path, csv_path = export_records(records, output_dir, args.category)
        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Collected %s Bramati %s slabs", len(records), args.category)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading Bramati listing pages") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
