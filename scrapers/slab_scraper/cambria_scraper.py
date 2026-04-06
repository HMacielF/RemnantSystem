"""
Cambria slab scraper.

Current scope:
- Cambria quartz colors catalog listing
- Infinite-scroll aware product collection
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


BASE_URL = "https://www.cambriausa.com"
LISTING_URL = f"{BASE_URL}/quartz-countertops/quartz-colors"
PRODUCT_CARD_SELECTOR = "li.ais-InfiniteHits-item"
PRODUCT_LINK_SELECTOR = "a.cmp-design-card__link"
PRODUCT_NAME_SELECTOR = ".cmp-design-card__design-name-text"
LOAD_MORE_SELECTOR = "button.ais-InfiniteHits-loadMore"
DETAIL_PAGE_READY_SELECTOR = ".pdp-details"
DETAIL_ATTR_SELECTOR = ".pdp-details-attributes"
DETAIL_DOWNLOAD_LINK_SELECTOR = ".pdp-details-downloads a.finish-items"
DETAIL_MEDIA_IMAGE_SELECTOR = ".carousel__media-item img, .cmp-media__image img"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/cambria")
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
    "white",
    "beige",
    "ivory",
}


@dataclass
class CambriaSlabRecord:
    name: str
    detail_url: str
    image_url: str | None
    primary_colors: str | None
    accent_colors: str | None
    vein: str | None
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


def title_case_name(name: str) -> str:
    cleaned = safe_inline_text(name)
    return cleaned.title() if cleaned.isupper() else cleaned


def safe_inline_text(text: str) -> str:
    return " ".join((text or "").split())


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, url: str) -> None:
    logging.info("Opening Cambria listing page: %s", url)
    driver.get(url)
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)))


def load_more_listing_items(driver: webdriver.Chrome, wait: WebDriverWait, limit: int) -> None:
    last_count = 0
    stable_rounds = 0

    while stable_rounds < 3:
        cards = driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)
        count = len(cards)
        if limit > 0 and count >= limit:
            return

        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(0.75)
        load_more_buttons = driver.find_elements(By.CSS_SELECTOR, LOAD_MORE_SELECTOR)
        if load_more_buttons:
            try:
                button = load_more_buttons[0]
                if button.is_enabled() and button.is_displayed():
                    driver.execute_script("arguments[0].click();", button)
                    time.sleep(0.75)
            except Exception:
                pass
        try:
            wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR)) > count)
            stable_rounds = 0
        except TimeoutException:
            new_count = len(driver.find_elements(By.CSS_SELECTOR, PRODUCT_CARD_SELECTOR))
            if new_count == last_count:
                stable_rounds += 1
            else:
                stable_rounds = 0
            last_count = new_count


def collect_listing_products(driver: webdriver.Chrome, wait: WebDriverWait, limit: int) -> list[tuple[str, str]]:
    load_more_listing_items(driver, wait, limit)

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
            break

    return products


def parse_dimensions(raw_value: str) -> str | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*in\s*x\s*(\d+(?:\.\d+)?)\s*in", raw_value, flags=re.IGNORECASE)
    if match:
        return f"{match.group(1)} x {match.group(2)}"
    return None


def parse_detail_attributes(driver: webdriver.Chrome) -> dict[str, list[str]]:
    info: dict[str, list[str]] = {}

    for row in driver.find_elements(By.CSS_SELECTOR, DETAIL_ATTR_SELECTOR):
        try:
            label = row.find_element(By.CSS_SELECTOR, ".pdp-details-label")
        except NoSuchElementException:
            continue

        key = safe_text(label).lower()
        if not key:
            continue

        values: list[str] = []
        link_nodes = row.find_elements(By.CSS_SELECTOR, "a")
        if link_nodes:
            values = [safe_text(node) for node in link_nodes if safe_text(node)]
        else:
            value_nodes = row.find_elements(By.CSS_SELECTOR, ".pdp-details-label-items")
            values = [safe_text(node) for node in value_nodes if safe_text(node)]

        if values:
            info[key] = values

    return info


def parse_color_values(values: list[str]) -> tuple[str | None, str | None, str | None]:
    if not values:
        return None, None, None

    normalized: list[str] = []
    features: list[str] = []
    for value in values:
        lowered = value.strip().lower()
        if lowered in KNOWN_COLOR_LABELS:
            normalized.append("Gray" if lowered == "grey" else value.title())
        elif value.strip():
            features.append(value.title())

    normalized = list(dict.fromkeys(normalized))
    features = list(dict.fromkeys(features))
    if not normalized:
        return None, None, ",".join(features) or None
    return normalized[0], ",".join(normalized[1:]) or None, ",".join(features) or None


def normalize_finish(values: list[str]) -> str | None:
    cleaned = []
    for value in values:
        text = value.replace("Cambria Satin™", "Satin").replace("Cambria Matte ®", "Matte")
        text = text.replace("Cambria Matte®", "Matte").replace("™", "").replace("®", "").strip()
        if text:
            cleaned.append(text.title())
    cleaned = list(dict.fromkeys(cleaned))
    return ",".join(cleaned) if cleaned else None


def select_detail_image(driver: webdriver.Chrome) -> str | None:
    for link in driver.find_elements(By.CSS_SELECTOR, DETAIL_DOWNLOAD_LINK_SELECTOR):
        label = safe_text(link).lower()
        href = (link.get_attribute("href") or "").strip()
        if "slab image" in label and href:
            return urljoin(BASE_URL, href)

    try:
        image = driver.find_element(By.CSS_SELECTOR, DETAIL_MEDIA_IMAGE_SELECTOR)
        raw_src = (
            image.get_attribute("data-src")
            or image.get_attribute("src")
            or ""
        ).strip()
        return urljoin(BASE_URL, raw_src) if raw_src else None
    except NoSuchElementException:
        return None


def collect_detail_record(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    listing_name: str,
    detail_url: str,
) -> CambriaSlabRecord:
    driver.get(detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, DETAIL_PAGE_READY_SELECTOR)))
    wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, DETAIL_ATTR_SELECTOR)))

    page_name = listing_name
    try:
        title_candidates = [safe_text(node).replace("TM", "").replace("™", "").strip() for node in driver.find_elements(By.CSS_SELECTOR, "h1")]
        title = next((value for value in title_candidates if value), "")
        if title:
            code_match = re.match(r"\d+\s+(.*)$", title)
            page_name = title_case_name(code_match.group(1) if code_match else title)
    except NoSuchElementException:
        pass

    info = parse_detail_attributes(driver)
    primary_colors, accent_colors, vein = parse_color_values(info.get("color & features", []))
    finishes = normalize_finish(info.get("finish", []))
    dimensions = parse_dimensions(",".join(info.get("slab size", [])) or "")
    thickness = ",".join(info.get("thickness", [])) or None
    image_url = select_detail_image(driver)

    return CambriaSlabRecord(
        name=page_name,
        detail_url=detail_url,
        image_url=image_url,
        primary_colors=primary_colors,
        accent_colors=accent_colors,
        vein=vein,
        dimensions=dimensions,
        thickness=thickness,
        finishes=finishes,
        material=DEFAULT_MATERIAL,
    )


def scrape_detail_pages(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    products: list[tuple[str, str]],
) -> list[CambriaSlabRecord]:
    records: list[CambriaSlabRecord] = []

    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping Cambria detail %s/%s: %s", index, len(products), detail_url)
        records.append(collect_detail_record(driver, wait, listing_name, detail_url))

    return records


def export_records(records: list[CambriaSlabRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"cambria_quartz_{stamp}.json"
    csv_path = output_dir / f"cambria_quartz_{stamp}.csv"

    payload = [
        {
            "name": record.name,
            "detail_url": record.detail_url,
            "image_url": record.image_url,
            "primary_colors": record.primary_colors,
            "accent_colors": record.accent_colors,
            "vein": record.vein,
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
                "primary_colors",
                "accent_colors",
                "vein",
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
    parser = argparse.ArgumentParser(description="Scrape Cambria quartz colors.")
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
        logging.info("Collected %s Cambria quartz slabs", len(records))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
