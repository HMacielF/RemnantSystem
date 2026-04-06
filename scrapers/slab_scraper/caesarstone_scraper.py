"""
Caesarstone slab scraper.

Current scope:
- Caesarstone material-filtered catalog listing
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
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlparse, parse_qsl

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


BASE_URL = "https://www.caesarstoneus.com"
CATALOG_BASE_URL = f"{BASE_URL}/countertops/"
SUPPORTED_MATERIALS = ("quartz",)
PRODUCT_CARD_SELECTOR = "article.stone"
PRODUCT_LINK_SELECTOR = "a.stone-title.stretched-link"
PRODUCT_CODE_SELECTOR = ".stone-title .stone-title"
PRODUCT_NAME_SELECTOR = ".stone-title .stone-title-text"
PAGINATION_NEXT_SELECTOR = "a.next.page-numbers, .pagination-next a"
DETAIL_TITLE_SELECTOR = ".catalog-title__main"
DETAIL_IMAGE_SELECTOR = ".catalog-header picture"
DETAIL_SPECS_ROW_SELECTOR = ".details-specs-row"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/caesarstone")
DEFAULT_LIMIT = 0
DEFAULT_MATERIAL = "Quartz"


@dataclass
class CaesarstoneSlabRecord:
    name: str
    product_code: str | None
    detail_url: str
    image_url: str | None
    primary_colors: str | None
    accent_colors: str | None
    dimensions: str | None
    thickness: str | None
    finishes: str | None
    collection: str | None
    pattern: str | None
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


def build_listing_url(material_slug: str) -> str:
    return f"{CATALOG_BASE_URL}?{urlencode({'material': material_slug})}"


def material_label_from_slug(material_slug: str) -> str:
    return " ".join(part.capitalize() for part in material_slug.strip("/").split("-") if part)


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str) -> None:
    logging.info("Opening Caesarstone listing page: %s", url)
    driver.get(url)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def normalize_pagination_url(url: str, material_slug: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["material"] = material_slug
    query_string = urlencode(query)
    normalized_path = parsed.path or "/countertops/"
    return f"{BASE_URL}{normalized_path}?{query_string}" if query_string else f"{BASE_URL}{normalized_path}"


def collect_listing_page_urls(driver: webdriver.Chrome, wait: WebDriverWait, material_slug: str) -> list[str]:
    page_urls: list[str] = []
    seen_urls: set[str] = set()
    current_url = normalize_pagination_url(driver.current_url, material_slug)

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
        if not next_href:
            break
        next_href = normalize_pagination_url(next_href, material_slug)
        if next_href.rstrip("/") in seen_urls:
            break

        open_listing_page(driver, wait, next_href)
        current_url = normalize_pagination_url(driver.current_url, material_slug)

    return page_urls


def collect_listing_products(driver: webdriver.Chrome, wait: WebDriverWait, material_slug: str, limit: int) -> list[tuple[str, str, str | None]]:
    products: list[tuple[str, str, str | None]] = []
    seen_urls: set[str] = set()
    page_urls = collect_listing_page_urls(driver, wait, material_slug)

    for page_index, page_url in enumerate(page_urls, start=1):
        if normalize_pagination_url(driver.current_url, material_slug).rstrip("/") != page_url.rstrip("/"):
            open_listing_page(driver, wait, page_url)

        logging.info("Collecting Caesarstone listing page %s/%s: %s", page_index, len(page_urls), page_url)
        for card in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
            try:
                link = card.find_element(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR)
            except NoSuchElementException:
                continue

            detail_url = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
            if not detail_url or detail_url in seen_urls:
                continue

            product_code = None
            product_name = ""
            try:
                product_code = safe_text(card.find_element(By.CSS_SELECTOR, PRODUCT_CODE_SELECTOR)) or None
            except NoSuchElementException:
                pass
            try:
                product_name = safe_text(card.find_element(By.CSS_SELECTOR, PRODUCT_NAME_SELECTOR))
            except NoSuchElementException:
                product_name = safe_text(link)

            if not product_name:
                continue

            products.append((product_name, detail_url, product_code))
            seen_urls.add(detail_url)
            if limit > 0 and len(products) >= limit:
                return products

    return products


def parse_spec_rows(driver: webdriver.Chrome) -> dict[str, list[str]]:
    info: dict[str, list[str]] = {}
    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_SPECS_ROW_SELECTOR):
        try:
            label = row.find_element(By.CSS_SELECTOR, ".details-specs-label")
            values = row.find_elements(By.CSS_SELECTOR, ".details-specs-value")
        except NoSuchElementException:
            continue

        key = safe_text(label).lower()
        value_texts = [safe_text(value) for value in values if safe_text(value)]
        if key and value_texts:
            info[key] = value_texts
    return info


def parse_dimensions(size_values: list[str]) -> str | None:
    for value in size_values:
        match = re.search(r'(\d+(?:\.\d+)?)"\s*±?.*?\(L\)\s*×\s*(\d+(?:\.\d+)?)"\s*±?.*?\(W\)', value)
        if match:
            return f"{match.group(1)} x {match.group(2)}"
        simple_match = re.search(r'(\d+(?:\.\d+)?)[\"”]\s*[x×]\s*(\d+(?:\.\d+)?)[\"”]', value)
        if simple_match:
            return f"{simple_match.group(1)} x {simple_match.group(2)}"
    return size_values[0] if size_values else None


def normalize_finish(values: list[str]) -> str | None:
    cleaned = []
    for value in values:
        normalized = re.sub(r"\s+Finish$", "", value, flags=re.IGNORECASE).strip()
        if normalized:
            cleaned.append(normalized.title())
    cleaned = list(dict.fromkeys(cleaned))
    return ",".join(cleaned) if cleaned else None


def clean_color_group(values: list[str]) -> tuple[str | None, str | None]:
    if not values:
        return None, None
    primary = values[0].rstrip("s").title()
    accents = values[1:]
    return primary, ",".join(value.rstrip("s").title() for value in accents if value) or None


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
    product_code: str | None,
    material_slug: str,
) -> CaesarstoneSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_TITLE_SELECTOR)))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_SPECS_ROW_SELECTOR)))

    page_name = listing_name
    page_code = product_code
    try:
        title = driver.find_element(By.CSS_SELECTOR, DETAIL_TITLE_SELECTOR)
        main_text = safe_text(title)
        if main_text:
            code_match = re.match(r"(\d+)\s+(.*)$", main_text)
            if code_match:
                page_code = code_match.group(1)
                page_name = code_match.group(2).strip() or listing_name
            else:
                page_name = main_text
    except NoSuchElementException:
        pass

    image_url = None
    try:
        picture = driver.find_element(By.CSS_SELECTOR, DETAIL_IMAGE_SELECTOR)
        raw_src = ""
        source_candidates = picture.find_elements(By.CSS_SELECTOR, "source[srcset]")
        for source in source_candidates:
            srcset = (source.get_attribute("srcset") or "").strip()
            if not srcset:
                continue
            parts = [part.strip() for part in srcset.split(",") if part.strip()]
            if parts:
                raw_src = parts[-1].split(" ")[0].strip()
                if raw_src:
                    break

        if not raw_src:
            image = picture.find_element(By.CSS_SELECTOR, "img.catalog-header-image")
            raw_src = (
                image.get_attribute("data-src")
                or image.get_attribute("srcset")
                or image.get_attribute("src")
                or ""
            ).strip()
            if raw_src and "," in raw_src:
                srcset_parts = [part.strip() for part in raw_src.split(",") if part.strip()]
                raw_src = srcset_parts[-1].split(" ")[0].strip()
        image_url = urljoin(BASE_URL, raw_src) if raw_src else None
    except NoSuchElementException:
        pass

    specs = parse_spec_rows(driver)
    primary_color, accent_colors = clean_color_group(specs.get("color group", []))
    thickness = ",".join(specs.get("thickness", [])) or None
    dimensions = parse_dimensions(specs.get("size", []))
    finishes = normalize_finish(specs.get("finish", []))
    collection = ",".join(specs.get("collection", [])) or None
    pattern = ",".join(specs.get("pattern", [])) or None
    material_values = specs.get("material", [])
    material = material_label_from_slug(material_slug)
    if material_values:
        material = material_values[0].title()

    return CaesarstoneSlabRecord(
        name=page_name.title(),
        product_code=page_code,
        detail_url=detail_url,
        image_url=image_url,
        primary_colors=primary_color,
        accent_colors=accent_colors,
        dimensions=dimensions,
        thickness=thickness,
        finishes=finishes,
        collection=collection,
        pattern=pattern,
        material=material,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str, str | None]],
    material_slug: str,
) -> list[CaesarstoneSlabRecord]:
    records: list[CaesarstoneSlabRecord] = []

    for index, (listing_name, detail_url, product_code) in enumerate(products, start=1):
        logging.info("Scraping Caesarstone detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url, product_code, material_slug))

    return records


def export_records(records: list[CaesarstoneSlabRecord], output_dir: Path, material_slug: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    slug_token = material_slug.strip("/").replace("-", "_")
    json_path = output_dir / f"caesarstone_{slug_token}_{stamp}.json"
    csv_path = output_dir / f"caesarstone_{slug_token}_{stamp}.csv"

    payload = [
        {
            "name": record.name,
            "product_code": record.product_code,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "primary_colors": record.primary_colors,
            "accent_colors": record.accent_colors,
            "dimensions": record.dimensions,
            "thickness": record.thickness,
            "finishes": record.finishes,
            "collection": record.collection,
            "pattern": record.pattern,
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
                "product_code",
                "detail_url",
                "image_url",
                "primary_colors",
                "accent_colors",
                "dimensions",
                "thickness",
                "finishes",
                "collection",
                "pattern",
                "material",
            ],
        )
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Caesarstone countertops by material.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--material",
        choices=SUPPORTED_MATERIALS,
        default="quartz",
        help="Catalog material filter to scrape.",
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
    listing_url = build_listing_url(args.material)
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_listing_page(driver, wait, listing_url)
        products = collect_listing_products(driver, wait, args.material, args.limit)
        records = scrape_detail_pages(driver, wait, products, args.material)
        json_path, csv_path = export_records(records, output_dir, args.material)
        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
        logging.info("Collected %s Caesarstone %s slabs", len(records), args.material)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading Caesarstone listing or detail pages") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
