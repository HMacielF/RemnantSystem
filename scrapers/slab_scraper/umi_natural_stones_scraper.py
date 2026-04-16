"""
UMI natural stone and Infinity slab scraper.

Current scope:
- Beltsville UMI live inventory for Granite/Quartzite, Marble, and Infinity
- Separate scraper from the Vicostone quartz flow
- Listing pagination across rendered pages
- Detail-page expansion into row-level slab inventory
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
from urllib.parse import urlencode

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
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/umi_natural_stones")
DEFAULT_TIMEOUT_SEC = 25
DEFAULT_LIMIT = 0
GROUP_CONFIGS = {
    "sg": {
        "mat_group": "SG",
        "label": "granite_quartzite",
        "branch_slug": "beltsville",
        "listing_url": f"{BASE_URL}/live-inventory/beltsville/?matGroup=SG",
        "product_category": "Granite/Quartzite Slabs",
    },
    "sm": {
        "mat_group": "SM",
        "label": "marble",
        "branch_slug": "beltsville",
        "listing_url": f"{BASE_URL}/live-inventory/beltsville/?matGroup=SM",
        "product_category": "Marble Slabs",
    },
    "is": {
        "mat_group": "IS",
        "label": "infinity",
        "branch_slug": "beltsville",
        "listing_url": f"{BASE_URL}/live-inventory/beltsville/?matGroup=IS",
        "product_category": "Infinity Surfaces Slabs",
    },
}


@dataclass(frozen=True)
class UmiListingProduct:
    listing_name: str
    item_code: str
    product_category: str
    group_code: str
    qty_lots: str
    umi_image_url: str | None
    detail_url: str
    category_key: str


@dataclass
class UmiNaturalStoneRecord:
    name: str
    finish: str | None
    thickness: str | None
    size: str | None
    material: str
    brand: str | None
    image_url: str | None
    detail_url: str
    sku: str | None
    product_category: str
    source_branch: str
    category_key: str


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


def open_listing_page(driver: webdriver.Chrome, wait: WebDriverWait, config: dict[str, str]) -> None:
    logging.info("Opening UMI natural stone inventory: %s", config["listing_url"])
    driver.get(config["listing_url"])
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
        "matGroup": product.group_code,
        "item": product.item_code,
        "GroupCode": product.group_code,
        "qtyLots": product.qty_lots,
        "matImagePath": product.umi_image_url or "",
        "materialName": product.listing_name,
        "productCategory": product.product_category,
    }
    return f"{BASE_URL}/live-inventory/beltsville/?{urlencode(params)}"


def parse_listing_card(card, category_key: str) -> UmiListingProduct | None:
    try:
        listing_name = element_text(card.find_element(By.CSS_SELECTOR, ".matName"))
    except NoSuchElementException:
        return None

    if not listing_name:
        return None

    try:
        item_code = element_text(card.find_element(By.CSS_SELECTOR, ".productItemNmbr"))
    except NoSuchElementException:
        item_code = ""

    if not item_code:
        return None

    try:
        product_category = element_text(card.find_element(By.CSS_SELECTOR, ".mainSubs span"))
    except NoSuchElementException:
        product_category = GROUP_CONFIGS[category_key]["product_category"]

    try:
        group_code = element_text(card.find_element(By.CSS_SELECTOR, ".productGroupCode"))
    except NoSuchElementException:
        group_code = GROUP_CONFIGS[category_key]["mat_group"]

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
        item_code=item_code,
        product_category=product_category,
        group_code=group_code,
        qty_lots=qty_lots,
        umi_image_url=umi_image_url,
        detail_url="",
        category_key=category_key,
    )
    return UmiListingProduct(
        listing_name=product.listing_name,
        item_code=product.item_code,
        product_category=product.product_category,
        group_code=product.group_code,
        qty_lots=product.qty_lots,
        umi_image_url=product.umi_image_url,
        detail_url=build_detail_url(product),
        category_key=product.category_key,
    )


def collect_listing_products(
    driver: webdriver.Chrome,
    wait: WebDriverWait,
    category_key: str,
    limit: int,
) -> list[UmiListingProduct]:
    seen_keys: set[tuple[str, str]] = set()
    products: list[UmiListingProduct] = []

    total_pages = parse_total_pages(driver)
    for page_number in range(1, total_pages + 1):
        wait.until(lambda current_driver: parse_current_page(current_driver) == page_number)
        wait_for_cards(driver, wait)
        logging.info("Collecting UMI %s listing page %s/%s", category_key, page_number, total_pages)

        for card in driver.find_elements(By.CSS_SELECTOR, "#loadedData .product-Item"):
            product = parse_listing_card(card, category_key)
            if not product:
                continue

            key = (product.listing_name, product.umi_image_url or "")
            if key in seen_keys:
                continue

            seen_keys.add(key)
            products.append(product)
            if limit > 0 and len(products) >= limit:
                return products

        if page_number >= total_pages:
            break

        next_button = driver.find_element(By.ID, "nextBtn")
        driver.execute_script("arguments[0].click();", next_button)
        wait.until(lambda current_driver: parse_current_page(current_driver) == page_number + 1)

    return products


def normalize_listing_name(value: str) -> str:
    return safe_text(value)


def normalize_material_name(value: str) -> str:
    cleaned = safe_text(value)
    if cleaned.isupper():
        cleaned = cleaned.title()
    return cleaned


def detect_finish(value: str) -> str | None:
    lower_value = safe_text(value).lower()
    finish_patterns = [
        ("Leathered", ("leathered", " leather ")),
        ("Leathered", (" leather-", " leather",)),
        ("Brushed", ("brushed",)),
        ("Honed", ("honed",)),
        ("Matte", ("matte",)),
        ("Polished", ("polished",)),
    ]
    for normalized, patterns in finish_patterns:
        if any(pattern in lower_value for pattern in patterns):
            return normalized
    return None


def parse_material_and_finish(product_category: str, listing_name: str) -> tuple[str, str | None]:
    category = safe_text(product_category).lower()
    cleaned_name = safe_text(listing_name)
    lower_name = cleaned_name.lower()

    if "infinity" in category:
        return "Porcelain", "Matte" if "matte" in lower_name else None
    if "marble" in category:
        return "Marble", detect_finish(cleaned_name)
    if "granite/quartzite" in category:
        return "Granite/Quartzite", detect_finish(cleaned_name)
    return safe_text(product_category), None


def parse_base_name(listing_name: str, finish: str | None, product_category: str) -> str:
    base = normalize_material_name(listing_name)
    if finish:
        finish_patterns = [finish]
        if finish == "Leathered":
            finish_patterns.append("Leather")
        for pattern in finish_patterns:
            base = re.sub(rf"\b{re.escape(pattern)}\b", " ", base, flags=re.IGNORECASE)
    base = re.sub(r"\s*-\s*\d+(?:\.\d+)?\s*cm\b", " ", base, flags=re.IGNORECASE)
    if "infinity" in safe_text(product_category).lower():
        base = re.sub(r"\b(infinity|surfaces?)\b", " ", base, flags=re.IGNORECASE)
    return safe_text(base).strip(" -")


def parse_thickness_from_text(value: str) -> str | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*cm", value, flags=re.IGNORECASE)
    if not match:
        return None
    number = match.group(1)
    return f"{number.rstrip('0').rstrip('.') if '.' in number else number}CM"


def parse_size_from_text(value: str) -> str | None:
    text = safe_text(value)
    match = re.search(r"(\d+(?:\.\d+)?)\s*\"?\s*[xX]\s*(\d+(?:\.\d+)?)\s*\"?", text)
    if not match:
        return None
    return f"{match.group(1)}X{match.group(2)}"


def fetch_lot_payload(
    driver: webdriver.Chrome,
    product: UmiListingProduct,
    branch_slug: str,
) -> list[dict]:
    script = """
        const itemCode = arguments[0];
        const groupCode = arguments[1];
        const qtyLots = arguments[2];
        const branchSlug = arguments[3];
        const done = arguments[arguments.length - 1];
        const params = new URLSearchParams({
            branch: branchSlug,
            item: itemCode,
            GroupCode: groupCode,
            qty: qtyLots,
        });

        Promise.all([
            fetch('https://apps.umistone.com/linv/ILot.php?' + params.toString()).then((r) => r.json()),
            fetch('https://apps.umistone.com/linv/isoon.php?' + params.toString()).then((r) => r.json()),
        ])
            .then((responses) => {
                const flattened = responses.flatMap((response) => {
                    if (!Array.isArray(response) || !Array.isArray(response[0])) {
                        return [];
                    }
                    return response[0];
                });
                done(flattened);
            })
            .catch((error) => done({ error: String(error) }));
    """
    payload = driver.execute_async_script(
        script,
        product.item_code,
        product.group_code,
        product.qty_lots,
        branch_slug,
    )
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(payload["error"])
    if not isinstance(payload, list):
        logging.warning(
            "fetch_lot_payload: unexpected result type %s for item %s — script may have timed out",
            type(payload).__name__,
            product.item_code,
        )
        return []
    return payload


def collect_detail_records(
    driver: webdriver.Chrome,
    product: UmiListingProduct,
    branch_slug: str,
) -> list[UmiNaturalStoneRecord]:
    rows = fetch_lot_payload(driver, product, branch_slug)
    material, finish_from_name = parse_material_and_finish(product.product_category, product.listing_name)
    records: list[UmiNaturalStoneRecord] = []

    for row in rows:
        variant_title = normalize_material_name(row.get("MaterialName")) or product.listing_name
        sku = safe_text(row.get("item")) or product.item_code or None
        row_text = safe_text(json.dumps(row))
        thickness = parse_thickness_from_text(variant_title) or parse_thickness_from_text(row_text)
        size = parse_size_from_text(variant_title) or parse_size_from_text(row_text)
        image_url = safe_text(row.get("url")) or product.umi_image_url

        finish = finish_from_name or detect_finish(variant_title)
        if not finish:
            finish = detect_finish(row_text)

        records.append(
            UmiNaturalStoneRecord(
                name=parse_base_name(variant_title, finish, product.product_category),
                finish=finish,
                thickness=thickness,
                size=size,
                material=material,
                brand="Infinity" if product.category_key == "is" else None,
                image_url=image_url,
                detail_url=product.detail_url,
                sku=sku,
                product_category=product.product_category,
                source_branch="Beltsville, MD",
                category_key=product.category_key,
            )
        )

    deduped: dict[tuple[str, str | None, str | None, str], UmiNaturalStoneRecord] = {}
    for record in records:
        key = (record.name, record.thickness, record.size, record.detail_url)
        if key not in deduped:
            deduped[key] = record

    return sorted(
        deduped.values(),
        key=lambda record: (record.category_key, record.name.lower(), record.thickness or "", record.size or ""),
    )


def scrape_products(
    driver: webdriver.Chrome,
    products: list[UmiListingProduct],
    branch_slug: str,
) -> list[UmiNaturalStoneRecord]:
    records: list[UmiNaturalStoneRecord] = []

    for index, product in enumerate(products, start=1):
        logging.info(
            "Scraping UMI %s detail %s/%s: %s",
            product.category_key,
            index,
            len(products),
            product.listing_name,
        )
        records.extend(collect_detail_records(driver, product, branch_slug))

    return records


def record_to_payload(record: UmiNaturalStoneRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "finish": record.finish,
        "thickness": record.thickness,
        "size": record.size,
        "material": record.material,
        "brand": record.brand,
        "image_url": record.image_url,
        "detail_url": record.detail_url,
        "sku": record.sku,
        "product_category": record.product_category,
        "source_branch": record.source_branch,
        "category_key": record.category_key,
    }


def export_records(records: list[UmiNaturalStoneRecord], output_dir: Path, category_key: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    slug = GROUP_CONFIGS[category_key]["label"]
    json_path = output_dir / f"umi_natural_stones_beltsville_{slug}_{stamp}.json"
    csv_path = output_dir / f"umi_natural_stones_beltsville_{slug}_{stamp}.csv"

    payload = [record_to_payload(record) for record in records]
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    fieldnames = list(payload[0].keys()) if payload else list(record_to_payload(
        UmiNaturalStoneRecord(
            name="",
            finish=None,
            thickness=None,
            size=None,
            material="",
            brand=None,
            image_url=None,
            detail_url="",
            sku=None,
            product_category="",
            source_branch="Beltsville, MD",
            category_key=category_key,
        )
    ).keys())
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape UMI Beltsville natural stone and Infinity slabs.")
    parser.add_argument(
        "--category",
        choices=tuple(GROUP_CONFIGS.keys()),
        default="sg",
        help="UMI material group to scrape.",
    )
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
        help="Browser wait timeout in seconds.",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run Chrome with a visible window for local debugging.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = GROUP_CONFIGS[args.category]
    driver = create_driver(headless=not args.headed)
    wait = WebDriverWait(driver, args.timeout_sec)

    try:
        open_listing_page(driver, wait, config)
        products = collect_listing_products(driver, wait, args.category, args.limit)
        logging.info("Collected %s top-level UMI %s products", len(products), args.category)

        records = scrape_products(driver, products, config["branch_slug"])
        logging.info("Collected %s slab rows", len(records))

        json_path, csv_path = export_records(records, args.output_dir, args.category)
        logging.info("Wrote JSON: %s", json_path)
        logging.info("Wrote CSV: %s", csv_path)
        return 0
    except TimeoutException as exc:
        logging.error("Timed out while scraping UMI %s inventory: %s", args.category, exc)
        return 1
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
