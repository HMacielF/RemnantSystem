"""
Venezia Surfaces slab scraper.

Current scope:
- Quartz catalog listing
- DMV filter checkbox application
- First-page product collection
- Product detail scraping for image/spec fields
- Export of the collected records at the end of the run

This scraper intentionally lives outside the remnant sync flow so supplier slab
catalog work can grow into its own pipeline without coupling to Moraware logic.
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


BASE_URL = "https://www.veneziasurfaces.com"
DMV_FILTER_SELECTOR = 'input[name="extra_fields[4][]"][value="36"]'
PRODUCT_CARD_SELECTOR = "div.product"
PRODUCT_LINK_SELECTOR = "div.name a"
DETAIL_IMAGE_SELECTOR = "#dp-slider .dp_item img[itemprop='image']"
DETAIL_SPEC_ROW_SELECTOR = ".block_efg .extra_fields_el"
DETAIL_NAME_SELECTOR = "h1, .productfull .name h1, .jshop_prod_name"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/venezia")
DEFAULT_CATEGORY_SLUG = "quartz"


@dataclass
class VeneziaSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    image_urls: list[str]
    color: str | None
    thickness: str | None
    material: str | None


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_listing_url(category_slug: str) -> str:
    return f"{BASE_URL}/catalog/{category_slug.strip('/')}"


def material_label_from_slug(category_slug: str) -> str:
    return " ".join(part.capitalize() for part in category_slug.strip("/").split("-") if part)


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


def ensure_dmv_filter(driver: webdriver.Chrome, wait: WebDriverWait, listing_url: str) -> None:
    driver.get(listing_url)
    checkbox = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DMV_FILTER_SELECTOR)))

    # The site uses an inline submit on checkbox click. If the checkbox is
    # already selected, we manually submit the enclosing form so the scraper
    # still lands on the filtered state consistently.
    if checkbox.is_selected():
        driver.execute_script(
            """
            const box = arguments[0];
            const form = box.form || document.forms.namedItem('jshop_filters');
            if (form) {
              form.submit();
              return;
            }
            if (document.jshop_filters && typeof document.jshop_filters.submit === 'function') {
              document.jshop_filters.submit();
            }
            """,
            checkbox,
        )
    else:
        checkbox.click()

    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def collect_listing_products(driver: webdriver.Chrome) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []

    for product in driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR):
        try:
            link = product.find_element(By.CSS_SELECTOR, PRODUCT_LINK_SELECTOR)
        except NoSuchElementException:
            continue

        name = " ".join(link.text.split())
        href = urljoin(BASE_URL, (link.get_attribute("href") or "").strip())
        if not name or not href:
            continue
        products.append((name, href))

    return products


def safe_text(element) -> str:
    return " ".join((element.text or "").split())


def collect_slider_image_urls(driver: webdriver.Chrome) -> list[str]:
    image_urls: list[str] = []

    for image in driver.find_elements(By.CSS_SELECTOR, DETAIL_IMAGE_SELECTOR):
        raw_src = (image.get_attribute("src") or "").strip()
        normalized = urljoin(BASE_URL, raw_src) if raw_src else None
        if normalized and normalized not in image_urls:
            image_urls.append(normalized)

    return image_urls


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
    material_label: str,
) -> VeneziaSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "#dp-slider")))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_SPEC_ROW_SELECTOR)))

    specs: dict[str, str] = {}
    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_SPEC_ROW_SELECTOR):
        try:
            label = row.find_element(By.CSS_SELECTOR, ".extra_fields_name")
            value = row.find_element(By.CSS_SELECTOR, ".extra_fields_value")
        except NoSuchElementException:
            continue

        key = safe_text(label).lower()
        specs[key] = safe_text(value)

    page_name = listing_name
    try:
        title = driver.find_element(By.CSS_SELECTOR, DETAIL_NAME_SELECTOR)
        page_name = safe_text(title) or listing_name
    except NoSuchElementException:
        pass

    image_urls = collect_slider_image_urls(driver)
    image_url = image_urls[0] if image_urls else None

    return VeneziaSlabRecord(
        name=page_name,
        detail_url=detail_url,
        image_url=image_url,
        image_urls=image_urls,
        color=specs.get("color"),
        thickness=specs.get("thickness"),
        material=material_label or specs.get("category"),
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    product_links: list[tuple[str, str]],
    material_label: str,
) -> list[VeneziaSlabRecord]:
    records: list[VeneziaSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(product_links, start=1):
        logging.info("Scraping detail %s: %s", index, detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url, material_label))

    return records


def export_records(
    records: list[VeneziaSlabRecord],
    output_dir: Path,
    category_slug: str,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    slug_token = category_slug.strip("/").replace("-", "_")
    json_path = output_dir / f"venezia_{slug_token}_dmv_{stamp}.json"
    csv_path = output_dir / f"venezia_{slug_token}_dmv_{stamp}.csv"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "image_urls": record.image_urls,
            "color": record.color,
            "thickness": record.thickness,
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
                "image_urls_json",
                "color",
                "thickness",
                "material",
            ],
        )
        writer.writeheader()
        writer.writerows(
            {
                "name": record.name,
                "detail_url": record.detail_url,
                "image_url": record.image_url,
                "image_urls_json": json.dumps(record.image_urls, ensure_ascii=True),
                "color": record.color,
                "thickness": record.thickness,
                "material": record.material,
            }
            for record in records
        )

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Venezia quartz slabs for the DMV filter.")
    parser.add_argument("--headed", action="store_true", help="Run Chrome with a visible window.")
    parser.add_argument(
        "--category-slug",
        default=DEFAULT_CATEGORY_SLUG,
        help="Catalog slug under /catalog/<slug>, for example quartz or printed-quartz.",
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
        help="Request and Selenium wait timeout in seconds.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    category_slug = args.category_slug.strip().strip("/")
    listing_url = build_listing_url(category_slug)
    material_label = material_label_from_slug(category_slug)

    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        logging.info("Opening listing page and applying DMV filter: %s", listing_url)
        ensure_dmv_filter(driver, wait, listing_url)
        product_links = collect_listing_products(driver)
        logging.info("Collected %s products from the filtered listing", len(product_links))

        records = scrape_detail_pages(driver, wait, product_links, material_label)
        json_path, csv_path = export_records(records, output_dir, category_slug)

        logging.info("Export complete")
        logging.info("JSON: %s", json_path)
        logging.info("CSV: %s", csv_path)
    except TimeoutException as error:
        raise RuntimeError("Timed out while loading the Venezia catalog/filter state") from error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
