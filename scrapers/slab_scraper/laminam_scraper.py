"""
Laminam product scraper.

Scope:
- Scrape the Laminam products listing across all paginated listing pages
- Fetch each detail page for finishes, size/thickness options, and gallery images
- Export normalized JSON/CSV only; no database writes

The exported rows are shaped to support Laminam being offered through Emerstone:
- supplier = Emerstone
- brand = Laminam
- material = Porcelain
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup
from requests import RequestException


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.laminam.com"
LISTING_URL = f"{BASE_URL}/en/products/"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/laminam")
DEFAULT_TIMEOUT_SEC = 45
DEFAULT_REQUEST_DELAY_SEC = 0.1
MAX_LISTING_PAGES = 20
MAX_REQUEST_ATTEMPTS = 4
DEFAULT_SUPPLIER = "Emerstone"
DEFAULT_BRAND = "Laminam"
DEFAULT_MATERIAL = "Porcelain"


@dataclass
class LaminamRecord:
    name: str
    supplier: str
    brand: str
    material: str
    detail_url: str
    image_url: str | None
    gallery_image_urls: str
    collection: str | None
    finishes: str
    sizes: str
    thicknesses: str
    size_thickness_options: str
    finish_count_listing: int | None
    size_count_listing: int | None
    listing_summary: str | None
    book_match: bool


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def clean_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def dedupe_preserve_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        cleaned = clean_text(value)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        output.append(cleaned)
    return output


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; LaminamScraper/1.0)",
        }
    )
    return session


def fetch_html(session: requests.Session, url: str, timeout_sec: int) -> str:
    last_error: Exception | None = None
    for attempt in range(1, MAX_REQUEST_ATTEMPTS + 1):
        try:
            response = session.get(url, timeout=timeout_sec)
            response.raise_for_status()
            return response.text
        except RequestException as exc:
            last_error = exc
            logging.warning(
                "Request failed for %s (attempt %s/%s): %s",
                url,
                attempt,
                MAX_REQUEST_ATTEMPTS,
                exc,
            )
            if attempt >= MAX_REQUEST_ATTEMPTS:
                break
            time.sleep(min(2 ** (attempt - 1), 6))

    assert last_error is not None
    raise last_error


def normalize_listing_url(url: str) -> str:
    return url.rstrip("/") + "/"


def parse_listing_card(card) -> dict[str, object] | None:
    href = clean_text(card.get("href"))
    if not href or "/en/products/" not in href or "/en/products/page/" in href:
        return None

    name_node = card.select_one("h5")
    summary_node = card.select_one("p._body-3")
    collection_node = card.select_one(".card__detail")
    image_node = card.select_one("img[src]")

    name = clean_text(name_node.get_text(" ", strip=True) if name_node else card.get("title"))
    if not name:
        return None

    summary = clean_text(summary_node.get_text(" ", strip=True) if summary_node else "")
    collection_text = clean_text(collection_node.get_text(" ", strip=True) if collection_node else "")
    collection = re.sub(r"^Collection\s+", "", collection_text, flags=re.IGNORECASE) or None

    finish_count = None
    size_count = None
    summary_match = re.search(r"(\d+)\s+finishes?,\s+(\d+)\s+sizes?", summary, re.IGNORECASE)
    if summary_match:
        finish_count = int(summary_match.group(1))
        size_count = int(summary_match.group(2))

    image_url = clean_text(image_node.get("src")) if image_node else None

    return {
        "name": name,
        "detail_url": normalize_listing_url(href),
        "listing_image_url": image_url or None,
        "listing_summary": summary or None,
        "collection": collection,
        "finish_count_listing": finish_count,
        "size_count_listing": size_count,
    }


def collect_listing_products(
    session: requests.Session,
    timeout_sec: int,
    request_delay_sec: float,
) -> list[dict[str, object]]:
    seen_urls: set[str] = set()
    products: list[dict[str, object]] = []
    current_url = LISTING_URL

    for _ in range(MAX_LISTING_PAGES):
        logging.info("Collecting listing page: %s", current_url)
        html = fetch_html(session, current_url, timeout_sec)
        soup = BeautifulSoup(html, "html.parser")

        page_new_count = 0
        for card in soup.select('a.card[href*="/en/products/"]'):
            payload = parse_listing_card(card)
            if not payload:
                continue
            detail_url = str(payload["detail_url"])
            if detail_url in seen_urls:
                continue
            seen_urls.add(detail_url)
            products.append(payload)
            page_new_count += 1

        logging.info("Collected %s new products from %s", page_new_count, current_url)

        next_link = soup.select_one('link[rel="next"]')
        next_url = clean_text(next_link.get("href")) if next_link else ""
        if not next_url or next_url in seen_urls:
            break

        current_url = next_url
        time.sleep(request_delay_sec)

    return products


def parse_finish_map(soup: BeautifulSoup) -> dict[str, str]:
    finish_map: dict[str, str] = {}
    for button in soup.select("[data-detail-btn][data-product-finish]"):
        target_key = clean_text(button.get("data-detail-btn"))
        finish_name = clean_text(button.get_text(" ", strip=True))
        if target_key and finish_name:
            finish_map[target_key] = finish_name
    return finish_map


def normalize_size_option(value: str) -> str:
    normalized = clean_text(value)
    if not normalized:
        return ""
    normalized = normalized.replace("avaliable", "available")
    normalized = normalized.replace("×", "x")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def extract_size_thickness_options(info_block) -> list[str]:
    options: list[str] = []
    for item in info_block.select("li"):
        text = normalize_size_option(item.get_text(" ", strip=True))
        if text:
            options.append(text)
    return dedupe_preserve_order(options)


def parse_dimensions_and_thickness(option: str) -> tuple[str | None, str | None]:
    cleaned = clean_text(option)
    if not cleaned:
        return None, None

    size_match = re.search(r"(\d+\s*[xX]\s*\d+\s*mm(?:\s+Full Size)?)", cleaned, re.IGNORECASE)
    thickness_match = re.search(r"Laminam\s+([0-9.]+(?:\+[0-9.]+)?)", cleaned, re.IGNORECASE)

    size_value = None
    thickness_value = None

    if size_match:
        size_value = re.sub(r"\s+", " ", size_match.group(1)).replace("X", "x").strip()
    if thickness_match:
        thickness_value = f"{thickness_match.group(1).strip()} MM"

    return size_value, thickness_value


def parse_gallery_image_urls(soup: BeautifulSoup) -> list[str]:
    gallery_urls: list[str] = []
    for image in soup.select('img[src*="laminam-cdn.thron.com"], img[data-src*="laminam-cdn.thron.com"]'):
        raw_url = clean_text(image.get("src") or image.get("data-src"))
        alt = clean_text(image.get("alt"))
        if not raw_url:
            continue
        if "thumbnail" in raw_url.lower():
            continue
        if alt and "thumbnail" in alt.lower():
            continue
        gallery_urls.append(raw_url)
    return dedupe_preserve_order(gallery_urls)


def parse_og_image_url(soup: BeautifulSoup) -> str | None:
    node = soup.select_one('meta[property="og:image"]')
    return clean_text(node.get("content")) if node else None


def collect_detail_record(
    session: requests.Session,
    listing_payload: dict[str, object],
    timeout_sec: int,
) -> LaminamRecord:
    detail_url = str(listing_payload["detail_url"])
    html = fetch_html(session, detail_url, timeout_sec)
    soup = BeautifulSoup(html, "html.parser")

    title_node = soup.select_one(".product__content h1")
    name = clean_text(title_node.get_text(" ", strip=True) if title_node else str(listing_payload["name"]))
    finish_map = parse_finish_map(soup)

    finish_names: list[str] = []
    size_options: list[str] = []
    sizes: list[str] = []
    thicknesses: list[str] = []

    for info_block in soup.select(".product__info-item[data-detail-target]"):
        target = clean_text(info_block.get("data-detail-target"))
        finish_name = finish_map.get(target)
        if finish_name:
            finish_names.append(finish_name)
        for option in extract_size_thickness_options(info_block):
            size_options.append(option)
            size_value, thickness_value = parse_dimensions_and_thickness(option)
            if size_value:
                sizes.append(size_value)
            if thickness_value:
                thicknesses.append(thickness_value)

    finish_names = dedupe_preserve_order(finish_names)
    size_options = dedupe_preserve_order(size_options)
    sizes = dedupe_preserve_order(sizes)
    thicknesses = dedupe_preserve_order(thicknesses)

    gallery_urls = parse_gallery_image_urls(soup)
    hero_image_url = parse_og_image_url(soup) or (gallery_urls[0] if gallery_urls else None)

    normalized_name = re.sub(r"^Book Match\s+", "", name, flags=re.IGNORECASE).strip()

    return LaminamRecord(
        name=normalized_name,
        supplier=DEFAULT_SUPPLIER,
        brand=DEFAULT_BRAND,
        material=DEFAULT_MATERIAL,
        detail_url=detail_url,
        image_url=hero_image_url,
        gallery_image_urls=" | ".join(gallery_urls),
        collection=listing_payload.get("collection"),  # type: ignore[arg-type]
        finishes=", ".join(finish_names),
        sizes=", ".join(sizes),
        thicknesses=", ".join(thicknesses),
        size_thickness_options=" | ".join(size_options),
        finish_count_listing=listing_payload.get("finish_count_listing"),  # type: ignore[arg-type]
        size_count_listing=listing_payload.get("size_count_listing"),  # type: ignore[arg-type]
        listing_summary=listing_payload.get("listing_summary"),  # type: ignore[arg-type]
        book_match=bool(re.search(r"\bbook match\b", name, flags=re.IGNORECASE)),
    )


def export_records(records: list[LaminamRecord], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    json_path = output_dir / f"laminam_inventory_{stamp}.json"
    csv_path = output_dir / f"laminam_inventory_{stamp}.csv"

    payload = [asdict(record) for record in records]
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(payload[0].keys()) if payload else [
                "name",
                "supplier",
                "brand",
                "material",
                "detail_url",
                "image_url",
                "gallery_image_urls",
                "collection",
                "finishes",
                "sizes",
                "thicknesses",
                "size_thickness_options",
                "finish_count_listing",
                "size_count_listing",
                "listing_summary",
                "book_match",
            ],
        )
        writer.writeheader()
        writer.writerows(payload)

    return json_path, csv_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Laminam products into local JSON/CSV exports.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--delay", type=float, default=DEFAULT_REQUEST_DELAY_SEC)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session = build_session()

    products = collect_listing_products(
        session=session,
        timeout_sec=args.timeout,
        request_delay_sec=args.delay,
    )
    logging.info("Collected %s unique Laminam product urls", len(products))

    records: list[LaminamRecord] = []
    for index, payload in enumerate(products, start=1):
        logging.info("Scraping Laminam detail %s/%s: %s", index, len(products), payload["detail_url"])
        records.append(
            collect_detail_record(
                session=session,
                listing_payload=payload,
                timeout_sec=args.timeout,
            )
        )
        time.sleep(args.delay)

    json_path, csv_path = export_records(records, args.output_dir)
    logging.info("Exported %s Laminam records to %s and %s", len(records), json_path, csv_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
