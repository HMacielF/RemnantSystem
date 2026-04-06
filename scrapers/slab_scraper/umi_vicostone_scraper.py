"""
UMI Vicostone slab scraper.

Current scope:
- Beltsville UMI live inventory for Vicostone
- Beltsville-only toggle activation before collection
- Listing pagination across all rendered pages
- Variant-detail extraction for name, size, and thickness
- Vicostone official full-slab image enrichment via BQ code matching
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
from urllib.parse import urlencode, urljoin

import requests
from bs4 import BeautifulSoup
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


BASE_URL = "https://umistone.com"
LISTING_URL = f"{BASE_URL}/live-inventory/beltsville/?matGroup=vicostone"
VICOSTONE_BASE_URL = "https://us.vicostone.com"
VICOSTONE_DETAIL_URL_TEMPLATE = f"{VICOSTONE_BASE_URL}/en/product/{{code}}"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/umi_vicostone")
DEFAULT_TIMEOUT_SEC = 25
DEFAULT_LIMIT = 0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class UmiListingProduct:
    listing_name: str
    product_category: str
    group_code: str
    qty_lots: str
    umi_image_url: str | None
    detail_url: str


@dataclass
class UmiVicostoneRecord:
    name: str
    size: str | None
    thickness: str | None
    material: str
    finish: str | None
    sku: str | None
    vicostone_code: str | None
    image_url: str | None
    detail_url: str
    brand_detail_url: str | None
    source_branch: str


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


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def safe_text(value: str | None) -> str:
    return " ".join((value or "").split())


def element_text(element) -> str:
    return safe_text(element.text or element.get_attribute("textContent"))


def wait_for_cards(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "#loadedData .product-Item")))


def wait_for_pagination_ready(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(EC.presence_of_element_located((By.ID, "paginationSH")))
    wait.until(EC.presence_of_element_located((By.ID, "totalPages")))
    wait.until(
        lambda current_driver: bool(safe_text(current_driver.find_element(By.ID, "totalPages").text))
    )


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    logging.info("Opening UMI Vicostone inventory: %s", LISTING_URL)
    driver.get(LISTING_URL)
    wait_for_cards(driver, wait)
    wait_for_pagination_ready(driver, wait)


def ensure_beltsville_only_toggle(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    toggle = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".btn-toggle")))
    if toggle.get_attribute("aria-pressed") == "true":
        return

    body_text_before = safe_text(driver.find_element(By.TAG_NAME, "body").text)
    driver.execute_script("arguments[0].click();", toggle)

    def toggle_applied(_driver: webdriver.Chrome) -> bool:
        pressed = _driver.find_element(By.CSS_SELECTOR, ".btn-toggle").get_attribute("aria-pressed")
        body_text = safe_text(_driver.find_element(By.TAG_NAME, "body").text)
        return pressed == "true" and "Also showing inventory in:" not in body_text and body_text != body_text_before

    wait.until(toggle_applied)
    wait_for_cards(driver, wait)
    wait_for_pagination_ready(driver, wait)


def parse_total_pages(driver: webdriver.Chrome) -> int:
    try:
        total_text = safe_text(driver.find_element(By.ID, "totalPages").text)
    except NoSuchElementException:
        return 1

    match = re.search(r"OF\s+(\d+)", total_text, flags=re.IGNORECASE)
    if not match:
        return 1
    return max(int(match.group(1)), 1)


def parse_current_page(driver: webdriver.Chrome) -> int:
    try:
        current = safe_text(driver.find_element(By.ID, "paginationSH").text)
        return max(int(current), 1)
    except (NoSuchElementException, ValueError):
        return 1


def build_detail_url(product: UmiListingProduct) -> str:
    params = {
        "matGroup": "vicostone",
        "item": product.listing_name.upper(),
        "GroupCode": product.group_code,
        "qtyLots": product.qty_lots,
        "matImagePath": product.umi_image_url or "",
        "materialName": product.listing_name,
        "productCategory": product.product_category,
    }
    return f"{BASE_URL}/live-inventory/beltsville/?{urlencode(params)}"


def parse_listing_card(card) -> UmiListingProduct | None:
    try:
        listing_name = element_text(card.find_element(By.CSS_SELECTOR, ".matName"))
    except NoSuchElementException:
        return None

    if not listing_name:
        return None

    try:
        product_category = element_text(card.find_element(By.CSS_SELECTOR, ".mainSubs span"))
    except NoSuchElementException:
        product_category = "Vicostone Quartz Slabs"

    try:
        group_code = element_text(card.find_element(By.CSS_SELECTOR, ".productGroupCode"))
    except NoSuchElementException:
        group_code = "VS"

    try:
        qty_lots = element_text(card.find_element(By.CSS_SELECTOR, ".qtyLots"))
    except NoSuchElementException:
        qty_lots = "0"

    umi_image_url = None
    try:
        image = card.find_element(By.CSS_SELECTOR, ".productloopImg img")
        umi_image_url = (image.get_attribute("src") or "").strip() or None
    except NoSuchElementException:
        pass

    product = UmiListingProduct(
        listing_name=listing_name,
        product_category=product_category or "Vicostone Quartz Slabs",
        group_code=group_code or "VS",
        qty_lots=qty_lots or "0",
        umi_image_url=umi_image_url,
        detail_url="",
    )
    return UmiListingProduct(
        listing_name=product.listing_name,
        product_category=product.product_category,
        group_code=product.group_code,
        qty_lots=product.qty_lots,
        umi_image_url=product.umi_image_url,
        detail_url=build_detail_url(product),
    )


def collect_listing_products(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    limit: int,
) -> list[UmiListingProduct]:
    seen_names: set[str] = set()
    products: list[UmiListingProduct] = []

    total_pages = parse_total_pages(driver)
    for page_number in range(1, total_pages + 1):
        wait.until(lambda current_driver: parse_current_page(current_driver) == page_number)
        wait_for_cards(driver, wait)
        logging.info("Collecting UMI listing page %s/%s", page_number, total_pages)

        for card in driver.find_elements(By.CSS_SELECTOR, "#loadedData .product-Item"):
            product = parse_listing_card(card)
            if not product:
                continue
            if product.listing_name in seen_names:
                continue

            seen_names.add(product.listing_name)
            products.append(product)
            if limit > 0 and len(products) >= limit:
                return products

        if page_number >= total_pages:
            break

        next_button = driver.find_element(By.ID, "nextBtn")
        driver.execute_script("arguments[0].click();", next_button)
        wait.until(lambda current_driver: parse_current_page(current_driver) == page_number + 1)

    return products


def extract_bq_code(value: str | None) -> str | None:
    cleaned = safe_text(value).upper()
    match = re.search(r"(BQ\d{4})", cleaned)
    return match.group(1) if match else None


def normalize_name(listing_name: str) -> str:
    cleaned = safe_text(listing_name)
    if cleaned.lower().startswith("vicostone - "):
        return cleaned.split("-", 1)[1].strip()
    return cleaned


def normalize_size(width: str | None, height: str | None) -> str | None:
    if not width or not height:
        return None
    return f"{width}X{height}"


def parse_variant_size(variant_title: str) -> str | None:
    match = re.search(r"(\d+)\s*\"\s*X\s*(\d+)\s*\"", variant_title, flags=re.IGNORECASE)
    if not match:
        return None
    return normalize_size(match.group(1), match.group(2))


def parse_variant_thickness(variant_title: str) -> str | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*cm", variant_title, flags=re.IGNORECASE)
    if not match:
        return None
    return f"{match.group(1).rstrip('0').rstrip('.') if '.' in match.group(1) else match.group(1)}CM"


def format_dimension(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return f"{value:.1f}".rstrip("0").rstrip(".")


def infer_half_jumbo_size(full_3cm_size: str | None) -> str | None:
    if not full_3cm_size:
        return None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)", full_3cm_size)
    if not match:
        return None

    first = float(match.group(1))
    second = float(match.group(2))
    long_side = max(first, second)
    short_side = min(first, second)

    return f"{format_dimension(long_side)}X{format_dimension(short_side / 2)}"


def fetch_vicostone_image_url(
    session: requests.Session,
    vicostone_code: str | None,
    cache: dict[str, str | None],
    timeout_sec: int,
) -> str | None:
    if not vicostone_code:
        return None
    if vicostone_code in cache:
        return cache[vicostone_code]

    detail_url = VICOSTONE_DETAIL_URL_TEMPLATE.format(code=vicostone_code)
    try:
        response = session.get(detail_url, timeout=timeout_sec)
        response.raise_for_status()
    except requests.RequestException:
        cache[vicostone_code] = None
        return None

    html = response.text
    lower_code = vicostone_code.lower()
    match = re.search(
        rf"(/[^\"']*{re.escape(lower_code)}-fullslab\.jpg(?:\?[^\"']*)?)",
        html,
        flags=re.IGNORECASE,
    )
    if match:
        cache[vicostone_code] = urljoin(detail_url, match.group(1).replace("&amp;", "&"))
        return cache[vicostone_code]

    soup = BeautifulSoup(html, "html.parser")
    og_image = soup.select_one('meta[property="og:image"]')
    if og_image and og_image.get("content"):
        cache[vicostone_code] = urljoin(detail_url, og_image.get("content"))
        return cache[vicostone_code]

    cache[vicostone_code] = None
    return None


def collect_detail_records(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    session: requests.Session,
    product: UmiListingProduct,
    timeout_sec: int,
    image_cache: dict[str, str | None],
) -> list[UmiVicostoneRecord]:
    driver.get(product.detail_url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "#loadedData .product-Item")))

    base_name = normalize_name(product.listing_name)
    rows = driver.find_elements(By.CSS_SELECTOR, "#loadedData .product-Item")

    full_3cm_size: str | None = None
    raw_variants: list[dict[str, str | None]] = []

    for row in rows:
        try:
            variant_title = element_text(row.find_element(By.CSS_SELECTOR, ".matName"))
        except NoSuchElementException:
            continue

        sku = None
        try:
            sku = element_text(row.find_element(By.CSS_SELECTOR, ".productItemNmbr")) or None
        except NoSuchElementException:
            pass

        size = parse_variant_size(variant_title)
        thickness = parse_variant_thickness(variant_title)
        if size and thickness == "3CM":
            full_3cm_size = size

        raw_variants.append(
            {
                "variant_title": variant_title,
                "sku": sku,
                "size": size,
                "thickness": thickness,
            }
        )

    grouped_records: dict[tuple[str, str | None], UmiVicostoneRecord] = {}
    grouped_thicknesses: dict[tuple[str, str | None], list[str]] = {}

    for variant in raw_variants:
        variant_title = variant["variant_title"] or ""
        size = variant["size"]
        is_half = "half jumbo" in variant_title.lower()
        if "half jumbo" in variant_title.lower():
            size = infer_half_jumbo_size(full_3cm_size)

        thickness = variant["thickness"]
        sku = variant["sku"]
        vicostone_code = extract_bq_code(sku)
        brand_detail_url = (
            VICOSTONE_DETAIL_URL_TEMPLATE.format(code=vicostone_code)
            if vicostone_code
            else None
        )
        image_url = fetch_vicostone_image_url(session, vicostone_code, image_cache, timeout_sec)

        if is_half:
            group_key = (base_name, f"half::{size}")
        else:
            group_key = (base_name, size)

        if group_key not in grouped_records:
            grouped_records[group_key] = UmiVicostoneRecord(
                name=base_name,
                size=size,
                thickness=thickness,
                material="Quartz",
                finish=None,
                sku=sku,
                vicostone_code=vicostone_code,
                image_url=image_url,
                detail_url=product.detail_url,
                brand_detail_url=brand_detail_url,
                source_branch="Beltsville, MD",
            )
            grouped_thicknesses[group_key] = [thickness] if thickness else []
            continue

        if thickness and thickness not in grouped_thicknesses[group_key]:
            grouped_thicknesses[group_key].append(thickness)

        existing = grouped_records[group_key]
        if not existing.sku and sku:
            existing.sku = sku
        if not existing.vicostone_code and vicostone_code:
            existing.vicostone_code = vicostone_code
        if not existing.image_url and image_url:
            existing.image_url = image_url
        if not existing.brand_detail_url and brand_detail_url:
            existing.brand_detail_url = brand_detail_url

    records = list(grouped_records.values())
    for group_key, record in grouped_records.items():
        thicknesses = grouped_thicknesses[group_key]
        record.thickness = ", ".join(thicknesses) if thicknesses else None

    records.sort(key=lambda record: (record.name.lower(), record.size or "", record.thickness or ""))
    return records


def scrape_products(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    session: requests.Session,
    products: list[UmiListingProduct],
    timeout_sec: int,
) -> list[UmiVicostoneRecord]:
    records: list[UmiVicostoneRecord] = []
    image_cache: dict[str, str | None] = {}

    for index, product in enumerate(products, start=1):
        logging.info("Scraping UMI Vicostone detail %s/%s: %s", index, len(products), product.listing_name)
        records.extend(collect_detail_records(driver, wait, session, product, timeout_sec, image_cache))

    return records


def record_to_payload(record: UmiVicostoneRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "size": record.size,
        "thickness": record.thickness,
        "material": record.material,
        "finish": record.finish,
        "sku": record.sku,
        "vicostone_code": record.vicostone_code,
        "image_url": record.image_url,
        "detail_url": record.detail_url,
        "brand_detail_url": record.brand_detail_url,
        "source_branch": record.source_branch,
    }


def export_records(records: list[UmiVicostoneRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"umi_vicostone_beltsville_{stamp}.json"
    csv_path = output_dir / f"umi_vicostone_beltsville_{stamp}.csv"

    payload = [record_to_payload(record) for record in records]
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    fieldnames = list(payload[0].keys()) if payload else list(record_to_payload(
        UmiVicostoneRecord(
            name="",
            size=None,
            thickness=None,
            material="Quartz",
            finish=None,
            sku=None,
            vicostone_code=None,
            image_url=None,
            detail_url="",
            brand_detail_url=None,
            source_branch="Beltsville, MD",
        )
    ).keys())
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape UMI Beltsville Vicostone slabs.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Limit listing products to scrape.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where JSON and CSV exports are written.",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help="HTTP and browser wait timeout in seconds.",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run Chrome with a visible window for local debugging.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session = build_session()
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_listing_page(driver, wait)
        ensure_beltsville_only_toggle(driver, wait)
        products = collect_listing_products(driver, wait, args.limit)
        logging.info("Collected %s top-level UMI Vicostone products", len(products))

        records = scrape_products(driver, wait, session, products, args.timeout_sec)
        logging.info("Collected %s slab rows", len(records))

        json_path, csv_path = export_records(records, args.output_dir)
        logging.info("Wrote JSON: %s", json_path)
        logging.info("Wrote CSV: %s", csv_path)
        return 0
    except TimeoutException as exc:
        logging.error("Timed out while scraping UMI Vicostone inventory: %s", exc)
        return 1
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
