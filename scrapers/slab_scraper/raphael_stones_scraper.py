"""
Raphael Stones slab scraper.

Current scope:
- Engineered Stone and Printed Stone archive pages
- Infinite-scroll aware archive traversal via exposed paginated URLs
- Detail-page extraction from WooCommerce variation payloads and attributes
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

try:
    from .unified_csv import (
        UnifiedSlabRecord,
        canonical_finishes,
        canonical_material,
        export_unified_csv,
        iso_now,
        parse_dimensions_inches,
        parse_thickness_to_cm,
    )
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from unified_csv import (  # type: ignore
        UnifiedSlabRecord,
        canonical_finishes,
        canonical_material,
        export_unified_csv,
        iso_now,
        parse_dimensions_inches,
        parse_thickness_to_cm,
    )


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.raphaelstoneusa.com"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/raphael_stones")
DEFAULT_TIMEOUT_SEC = 30
DEFAULT_LIMIT = 0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
CATALOG_SOURCES: tuple[tuple[str, str, str], ...] = (
    (
        "Engineered Stone",
        "Quartz",
        "https://www.raphaelstoneusa.com/collection-attributes/product-line/engineered-stone/",
    ),
    (
        "Printed Stone",
        "Printed Quartz",
        "https://www.raphaelstoneusa.com/collection-attributes/product-line/printed-stone/",
    ),
)


@dataclass(frozen=True)
class RaphaelCatalogSource:
    source_name: str
    material: str
    listing_url: str


@dataclass
class RaphaelSlabRecord:
    name: str
    sku: str | None
    size: str | None
    thickness: str | None
    finish: str | None
    material: str
    detail_url: str
    image_url: str | None
    source_name: str


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def safe_text(value: str | None) -> str:
    return " ".join((value or "").split())


def normalize_slug_text(value: str | None) -> str | None:
    cleaned = safe_text(value).strip("-")
    if not cleaned:
        return None
    if cleaned.lower() == "coming-soon":
        return "Coming Soon"
    if re.fullmatch(r"\d+(x\d+)+", cleaned, flags=re.IGNORECASE):
        return cleaned.upper()
    if re.fullmatch(r"\d+(?:\.\d+)?cm", cleaned, flags=re.IGNORECASE):
        return cleaned.upper()
    return cleaned.replace("-", " ").title()


def get_soup(session: requests.Session, url: str, timeout_sec: int) -> BeautifulSoup:
    response = session.get(url, timeout=timeout_sec)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def collect_catalog_sources() -> list[RaphaelCatalogSource]:
    return [
        RaphaelCatalogSource(source_name=source_name, material=material, listing_url=listing_url)
        for source_name, material, listing_url in CATALOG_SOURCES
    ]


def collect_max_page(soup: BeautifulSoup) -> int:
    anchor = soup.select_one(".e-load-more-anchor[data-max-page]")
    if not anchor:
        return 1

    raw_value = safe_text(anchor.get("data-max-page"))
    try:
        return max(int(raw_value), 1)
    except ValueError:
        return 1


def build_page_url(base_url: str, page_number: int) -> str:
    if page_number <= 1:
        return base_url
    return urljoin(base_url, f"page/{page_number}/")


def collect_listing_products(
    session: requests.Session,
    source: RaphaelCatalogSource,
    timeout_sec: int,
    limit: int,
) -> list[tuple[str, str]]:
    first_page = get_soup(session, source.listing_url, timeout_sec)
    max_page = collect_max_page(first_page)
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()

    for page_number in range(1, max_page + 1):
        page_url = build_page_url(source.listing_url, page_number)
        soup = first_page if page_number == 1 else get_soup(session, page_url, timeout_sec)
        logging.info("Collecting Raphael listing page %s/%s: %s", page_number, max_page, page_url)

        for anchor in soup.select("a[href*='/design/engineered-stone/'], a[href*='/design/printed-stone/']"):
            detail_url = urljoin(BASE_URL, safe_text(anchor.get("href")))
            if not detail_url or detail_url in seen_urls:
                continue

            title = anchor.select_one(".product_title") or anchor.find("h1")
            name = safe_text(title.get_text()) if title else ""
            if not name:
                name = safe_text(anchor.get_text())
            if not name:
                continue

            seen_urls.add(detail_url)
            products.append((name, detail_url))

            if limit > 0 and len(products) >= limit:
                return products

    return products


def parse_variations_form(soup: BeautifulSoup) -> list[dict]:
    form = soup.select_one("form.variations_form[data-product_variations]")
    if not form:
        return []

    raw_variations = form.get("data-product_variations")
    if not raw_variations:
        return []

    decoded = html.unescape(raw_variations)
    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError:
        return []

    return payload if isinstance(payload, list) else []


def parse_attributes_table(soup: BeautifulSoup) -> dict[str, str]:
    details: dict[str, str] = {}

    for row in soup.select("tr.woocommerce-product-attributes-item"):
        label = row.select_one(".woocommerce-product-attributes-item__label")
        value = row.select_one(".woocommerce-product-attributes-item__value")
        key = safe_text(label.get_text() if label else "").lower().rstrip(":")
        text_value = safe_text(value.get_text() if value else "")
        if key and text_value:
            details[key] = text_value

    return details


def parse_acf_variations(soup: BeautifulSoup) -> dict[str, dict[str, str]]:
    for script in soup.find_all("script"):
        script_text = script.string or script.get_text()
        if "const acfVariations =" not in script_text:
            continue

        match = re.search(r"const acfVariations = (\{.*?\});", script_text, flags=re.DOTALL)
        if not match:
            continue

        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            return {}

        return payload if isinstance(payload, dict) else {}

    return {}


def parse_default_meta_line(soup: BeautifulSoup, label: str) -> str | None:
    pattern = re.compile(rf"<strong>{re.escape(label)}:</strong>\s*([^<]+)", flags=re.IGNORECASE)
    for script in soup.find_all("script"):
        script_text = script.string or script.get_text()
        if "renderMeta(" not in script_text:
            continue

        match = pattern.search(script_text)
        if match:
            value = safe_text(match.group(1))
            if not value or "'" in value or "+" in value:
                continue
            return value

    return None


def parse_thickness_from_classes(soup: BeautifulSoup) -> str | None:
    candidates = soup.select("div.product, .elementor-location-single.product, body")
    thickness_values: list[str] = []

    for node in candidates:
        for class_name in node.get("class", []):
            if not class_name.startswith("pa_thickness-"):
                continue
            normalized = normalize_slug_text(class_name.removeprefix("pa_thickness-"))
            if normalized and normalized not in thickness_values:
                thickness_values.append(normalized)

    if thickness_values:
        return ", ".join(thickness_values)

    return None


def normalize_variation_value(value: str | None) -> str | None:
    cleaned = safe_text(value)
    if not cleaned:
        return None
    if re.fullmatch(r"\d+(x\d+)+", cleaned, flags=re.IGNORECASE):
        return cleaned.upper()
    if re.fullmatch(r"\d+(?:\.\d+)?cm", cleaned, flags=re.IGNORECASE):
        return cleaned.upper()
    if re.fullmatch(r"\d+(?:\.\d+)?cm(?:,\s*\d+(?:\.\d+)?cm)+", cleaned, flags=re.IGNORECASE):
        parts = [part.strip().upper() for part in cleaned.split(",") if part.strip()]
        return ", ".join(parts)
    return cleaned.title()


def collect_gallery_image_candidates(soup: BeautifulSoup) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    for node in soup.select(".custom-product-gallery .gallery-main img, .custom-product-gallery .gallery-thumbs img"):
        for attr_name in ("src", "data-src"):
            raw_value = safe_text(node.get(attr_name))
            if not raw_value:
                continue
            image_url = urljoin(BASE_URL, raw_value)
            if image_url not in seen:
                seen.add(image_url)
                candidates.append(image_url)

    return candidates


def normalize_image_url(image_url: str | None) -> str | None:
    cleaned = safe_text(image_url)
    if not cleaned:
        return None
    return re.sub(r"-(?:\d+)x(?:\d+)(?=\.(?:jpg|jpeg|png|webp)$)", "", cleaned, flags=re.IGNORECASE)


def image_candidate_score(image_url: str, position: int) -> int:
    filename = Path(urlparse(image_url).path).name.lower()
    score = 0

    if position == 1:
        score += 4
    elif position == 0:
        score += 1

    preferred_tokens = (
        "pc-",
        "_sz-",
        "_ma-",
        "quartz",
        "engineered",
        "printed",
        "slab",
    )
    penalty_tokens = (
        "kitchen",
        "bath",
        "bathroom",
        "living",
        "office",
        "island",
        "scene",
        "room",
        "certified",
        "logo",
        "icon",
    )

    for token in preferred_tokens:
        if token in filename:
            score += 6
    for token in penalty_tokens:
        if token in filename:
            score -= 8

    if re.search(r"-(?:\d+)x(?:\d+)(?=\.(?:jpg|jpeg|png|webp)$)", filename):
        score -= 12

    if re.search(r"\b\d{3,4}x\d{2,4}\b", filename):
        score += 4

    return score


def choose_best_image_url(variation_image_url: str | None, soup: BeautifulSoup) -> str | None:
    candidates: list[str] = []
    seen: set[str] = set()

    for image_url in [variation_image_url, *collect_gallery_image_candidates(soup)]:
        cleaned = normalize_image_url(image_url)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        candidates.append(cleaned)

    if not candidates:
        return None

    scored = [
        (image_candidate_score(image_url, index), index, image_url)
        for index, image_url in enumerate(candidates)
    ]
    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[0][2]


def collect_detail_records(
    session: requests.Session,
    source: RaphaelCatalogSource,
    listing_name: str,
    detail_url: str,
    timeout_sec: int,
) -> list[RaphaelSlabRecord]:
    soup = get_soup(session, detail_url, timeout_sec)
    attributes = parse_attributes_table(soup)
    variations = parse_variations_form(soup)
    acf_variations = parse_acf_variations(soup)
    page_name = safe_text((soup.select_one(".product_title") or soup.select_one("h1")).get_text()) if (soup.select_one(".product_title") or soup.select_one("h1")) else listing_name
    fallback_finish = attributes.get("finish")
    fallback_size = attributes.get("size and shape")
    fallback_thickness = (
        parse_default_meta_line(soup, "Thickness")
        or attributes.get("thickness")
        or parse_thickness_from_classes(soup)
    )

    records: list[RaphaelSlabRecord] = []
    seen_keys: set[tuple[str, str | None, str | None, str | None, str]] = set()

    if not variations:
        dedupe_key = (page_name, fallback_size, fallback_thickness, fallback_finish, source.material)
        records.append(
            RaphaelSlabRecord(
                name=page_name,
                sku=parse_default_meta_line(soup, "SKU"),
                size=fallback_size,
                thickness=fallback_thickness,
                finish=fallback_finish,
                material=source.material,
                detail_url=detail_url,
                image_url=None,
                source_name=source.source_name,
            )
        )
        seen_keys.add(dedupe_key)
        return records

    for variation in variations:
        variation_id = str(variation.get("variation_id") or "")
        variation_attrs = variation.get("attributes") or {}
        variation_acf = acf_variations.get(variation_id) or {}

        size = normalize_variation_value(
            variation_attrs.get("attribute_pa_size-and-shape") or fallback_size
        )
        finish = normalize_variation_value(
            variation_attrs.get("attribute_pa_finish") or fallback_finish
        )
        thickness = normalize_variation_value(
            variation_acf.get("thickness") or fallback_thickness
        )
        sku = safe_text(variation.get("sku")) or parse_default_meta_line(soup, "SKU")
        image = variation.get("image") or {}
        variation_image_url = safe_text(image.get("full_src") or image.get("url")) or None
        image_url = choose_best_image_url(variation_image_url, soup)

        dedupe_key = (page_name, size, thickness, finish, source.material)
        if dedupe_key in seen_keys:
            continue

        seen_keys.add(dedupe_key)
        records.append(
            RaphaelSlabRecord(
                name=page_name,
                sku=sku,
                size=size,
                thickness=thickness,
                finish=finish,
                material=source.material,
                detail_url=detail_url,
                image_url=image_url,
                source_name=source.source_name,
            )
        )

    return records


def record_to_payload(record: RaphaelSlabRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "sku": record.sku,
        "size": record.size,
        "thickness": record.thickness,
        "finish": record.finish,
        "material": record.material,
        "detail_url": record.detail_url,
        "image_url": record.image_url,
        "source_name": record.source_name,
    }


def to_unified(record: RaphaelSlabRecord, scraped_at: str) -> UnifiedSlabRecord:
    width_in, height_in = parse_dimensions_inches(record.size)
    extra = {}
    if record.source_name:
        extra["source_name"] = record.source_name
    return UnifiedSlabRecord(
        supplier="raphael_stones",
        source_category=record.material.lower() if record.material else "",
        name=record.name,
        material=canonical_material(record.material),
        detail_url=record.detail_url,
        scraped_at=scraped_at,
        brand="Raphael Stones",
        collection=record.source_name,
        sku=record.sku,
        image_url=record.image_url,
        width_in=width_in,
        height_in=height_in,
        size_text=record.size,
        thickness_cm=parse_thickness_to_cm(record.thickness),
        finishes=canonical_finishes([record.finish] if record.finish else []),
        extra=extra,
    )


def export_records(records: list[RaphaelSlabRecord], output_dir: Path) -> list[tuple[str, Path, Path]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    scraped_at = iso_now()
    exports: list[tuple[str, Path, Path]] = []

    for material_slug, material_label in (("quartz", "Quartz"), ("printed_quartz", "Printed Quartz")):
        material_records = [record for record in records if record.material == material_label]
        if not material_records:
            continue

        json_path = output_dir / f"raphael_stones_{material_slug}_{stamp}.json"
        payload = [record_to_payload(record) for record in material_records]
        json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

        unified = [to_unified(record, scraped_at) for record in material_records]
        csv_path = export_unified_csv(unified, output_dir, supplier="raphael_stones", suffix=material_slug)

        exports.append((material_label, json_path, csv_path))

    return exports


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Raphael Stones quartz catalogs.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where the exported JSON and CSV files will be written.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Optional maximum number of detail pages to scrape per catalog. Use 0 for all.",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help="HTTP timeout in seconds.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    session = build_session()
    all_records: list[RaphaelSlabRecord] = []

    for source in collect_catalog_sources():
        logging.info("Opening Raphael catalog page: %s", source.listing_url)
        products = collect_listing_products(
            session=session,
            source=source,
            timeout_sec=args.timeout_sec,
            limit=args.limit,
        )
        logging.info("Collected %s products from %s", len(products), source.listing_url)

        for index, (listing_name, detail_url) in enumerate(products, start=1):
            logging.info("Scraping Raphael detail %s/%s: %s", index, len(products), detail_url)
            all_records.extend(
                collect_detail_records(
                    session=session,
                    source=source,
                    listing_name=listing_name,
                    detail_url=detail_url,
                    timeout_sec=args.timeout_sec,
                )
            )

    exports = export_records(all_records, Path(args.output_dir))
    for material, json_path, csv_path in exports:
        logging.info("%s JSON: %s", material, json_path)
        logging.info("%s CSV: %s", material, csv_path)


if __name__ == "__main__":
    main()
