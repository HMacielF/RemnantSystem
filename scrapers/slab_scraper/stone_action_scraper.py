"""
Stone Action slab scraper.

Scope:
- Scrape Stone Action WordPress portfolio category archives
- Fetch each portfolio detail page for the canonical stone name and gallery image
- Export local JSON/CSV only; no database writes
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
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://stoneaction.net"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/stone_action")
DEFAULT_TIMEOUT_SEC = 45
DEFAULT_REQUEST_DELAY_SEC = 0.15
MAX_PAGES_PER_CATEGORY = 20
CATEGORY_CONFIGS = [
    {
        "key": "quartz",
        "archive_url": f"{BASE_URL}/portfolio-category/quartz/",
        "material": "Quartz",
        "brand": "Vivara Quartz",
    },
    {
        "key": "soapstone",
        "archive_url": f"{BASE_URL}/portfolio-category/soapstone/",
        "material": "Soapstone",
        "brand": None,
    },
    {
        "key": "quartzite",
        "archive_url": f"{BASE_URL}/portfolio-category/quartzite/",
        "material": "Quartzite",
        "brand": None,
    },
    {
        "key": "marble",
        "archive_url": f"{BASE_URL}/portfolio-category/marble/",
        "material": "Marble",
        "brand": None,
    },
    {
        "key": "granite",
        "archive_url": f"{BASE_URL}/portfolio-category/granite/",
        "material": "Granite",
        "brand": None,
    },
]


@dataclass
class StoneActionRecord:
    name: str
    material: str
    brand: str | None
    detail_url: str
    image_url: str | None
    archive_thumbnail_url: str | None
    gallery_image_urls: str
    block_number: str | None
    thickness: str | None
    base_color: str | None
    width_in: float | None
    height_in: float | None
    avg_size_text: str | None
    archive_url: str
    category_key: str


MATERIAL_PREFIXES = ("Granite ", "Marble ", "Quartz ", "Quartzite ", "Soapstone ")
STONE_ACTION_FINISH_SUFFIX_RE = re.compile(
    r"\s+(?:Polish/Leather|Polished/Leather|Polish/Honed|Polished/Honed|Honed|Leathered|Leather)$",
    re.IGNORECASE,
)


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def clean_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def smart_title_token(token: str) -> str:
    raw = clean_text(token)
    if not raw:
        return ""
    letters = re.sub(r"[^A-Za-z]", "", raw)
    if letters and letters == letters.upper() and len(letters) <= 3:
        return raw.upper()
    lowered = raw.lower()
    lowered = re.sub(r"(^|[\(\[\/\-])([a-z])", lambda match: f"{match.group(1)}{match.group(2).upper()}", lowered)
    lowered = re.sub(r"(^|['’])([a-z])", lambda match: f"{match.group(1)}{match.group(2).upper()}", lowered)
    lowered = re.sub(r"\(([a-z]{1,3})\)", lambda match: f"({match.group(1).upper()})", lowered)
    return lowered


def normalize_catalog_name_case(value: str | None) -> str:
    return " ".join(smart_title_token(token) for token in clean_text(value).split()).strip()


def normalize_name(name: str, material: str, block_number: str | None, brand: str | None) -> str:
    normalized = clean_text(name)
    if material == "Soapstone":
        return "Soapstone"
    for prefix in MATERIAL_PREFIXES:
        if normalized.upper().startswith(prefix.upper()):
            normalized = normalized[len(prefix):].strip()
            break
    if block_number:
        normalized = re.sub(rf"\s+{re.escape(clean_text(block_number))}$", "", normalized, flags=re.IGNORECASE).strip()
    if material == "Quartz" and brand == "Vivara Quartz" and normalized.upper().startswith("VIVARA "):
        normalized = normalized[7:].strip()
    normalized = STONE_ACTION_FINISH_SUFFIX_RE.sub("", normalized).strip()
    return normalize_catalog_name_case(normalized.strip(" -/"))


def normalize_thickness(value: str | None) -> str | None:
    cleaned = clean_text(value)
    if not cleaned:
        return None
    return re.sub(r"(?i)\b(\d+(?:\.\d+)?)\s*cm\b", r"\1 CM", cleaned)


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; StoneActionScraper/1.0)",
        }
    )
    return session


def fetch_html(session: requests.Session, url: str, timeout_sec: int) -> str:
    response = session.get(url, timeout=timeout_sec)
    response.raise_for_status()
    return response.text


def archive_page_url(base_archive_url: str, page_number: int) -> str:
    if page_number <= 1:
        return base_archive_url
    return urljoin(base_archive_url, f"page/{page_number}/")


def extract_background_image_url(style_value: str) -> str | None:
    match = re.search(r"--awb-bg-image:url\('([^']+)'\)", style_value or "")
    if not match:
        return None
    return clean_text(match.group(1)) or None


def parse_archive_cards(html: str, base_archive_url: str) -> list[dict[str, str | None]]:
    soup = BeautifulSoup(html, "html.parser")
    cards: list[dict[str, str | None]] = []
    for item in soup.select("li.fusion-post-cards-grid-column"):
        link_node = item.select_one("a.fusion-column-anchor[href]")
        if not link_node:
            continue

        detail_url = clean_text(link_node.get("href"))
        if not detail_url or detail_url.rstrip("/") == f"{BASE_URL}/portfolio":
            continue

        thumbnail_url = None
        for node in item.select("[style]"):
            thumbnail_url = extract_background_image_url(node.get("style", ""))
            if thumbnail_url:
                break

        cards.append(
            {
                "detail_url": detail_url,
                "archive_thumbnail_url": thumbnail_url,
                "archive_url": base_archive_url,
            }
        )
    return cards


def collect_archive_cards(
    session: requests.Session,
    archive_url: str,
    timeout_sec: int,
    request_delay_sec: float,
) -> list[dict[str, str | None]]:
    deduped: dict[str, dict[str, str | None]] = {}
    for page_number in range(1, MAX_PAGES_PER_CATEGORY + 1):
        page_url = archive_page_url(archive_url, page_number)
        try:
            html = fetch_html(session, page_url, timeout_sec)
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                break
            raise
        cards = parse_archive_cards(html, archive_url)
        if not cards:
            break

        new_count = 0
        for card in cards:
            detail_url = clean_text(card["detail_url"])
            if detail_url not in deduped:
                deduped[detail_url] = card
                new_count += 1

        logging.info(
            "Stone Action archive page %s yielded %s cards (%s new)",
            page_url,
            len(cards),
            new_count,
        )
        if new_count == 0:
            break
        time.sleep(request_delay_sec)

    return list(deduped.values())


def parse_size(text: str | None) -> tuple[float | None, float | None]:
    cleaned = clean_text(text).replace('"', "")
    match = re.search(r"(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)", cleaned)
    if not match:
        return None, None
    return float(match.group(1)), float(match.group(2))


def parse_detail_fields(soup: BeautifulSoup) -> dict[str, str | None]:
    fields: dict[str, str | None] = {
        "block_number": None,
        "thickness": None,
        "base_color": None,
        "avg_size_text": None,
    }
    for paragraph in soup.select(".post-content p"):
        text = clean_text(paragraph.get_text(" ", strip=True))
        if not text:
            continue
        if text.startswith("Block #"):
            fields["block_number"] = text.removeprefix("Block #").strip() or None
        elif text.startswith("Thickness:"):
            fields["thickness"] = text.removeprefix("Thickness:").strip() or None
        elif text.startswith("Base Color:"):
            fields["base_color"] = text.removeprefix("Base Color:").strip() or None
        elif text.startswith("Avg. Size:"):
            fields["avg_size_text"] = text.removeprefix("Avg. Size:").strip() or None
    return fields


def unique_preserve_order(values: Iterable[str | None]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = clean_text(value)
        if not cleaned or cleaned.startswith("data:image/"):
            continue
        if cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)
    return deduped


def normalize_records(rows: list[StoneActionRecord]) -> list[StoneActionRecord]:
    normalized_rows: list[StoneActionRecord] = []
    seen_detail_urls: set[str] = set()

    for row in rows:
        detail_url = clean_text(row.detail_url)
        if not detail_url or detail_url in seen_detail_urls:
            continue
        seen_detail_urls.add(detail_url)
        normalized_rows.append(
            StoneActionRecord(
                name=normalize_name(row.name, row.material, row.block_number, row.brand),
                material=row.material,
                brand=row.brand,
                detail_url=detail_url,
                image_url=clean_text(row.image_url) or None,
                archive_thumbnail_url=clean_text(row.archive_thumbnail_url) or None,
                gallery_image_urls=" | ".join(unique_preserve_order(row.gallery_image_urls.split("|"))),
                block_number=clean_text(row.block_number) or None,
                thickness=normalize_thickness(row.thickness),
                base_color=normalize_catalog_name_case(row.base_color) if clean_text(row.base_color) else None,
                width_in=row.width_in,
                height_in=row.height_in,
                avg_size_text=clean_text(row.avg_size_text) or None,
                archive_url=clean_text(row.archive_url),
                category_key=row.category_key,
            )
        )

    normalized_rows.sort(key=lambda row: (row.material, row.name, row.detail_url))
    return normalized_rows


def parse_detail_page(
    session: requests.Session,
    card: dict[str, str | None],
    material: str,
    brand: str | None,
    category_key: str,
    timeout_sec: int,
) -> StoneActionRecord:
    detail_url = clean_text(card["detail_url"])
    html = fetch_html(session, detail_url, timeout_sec)
    soup = BeautifulSoup(html, "html.parser")

    title_node = soup.select_one("h1")
    name = clean_text(title_node.get_text(" ", strip=True) if title_node else "")
    if not name:
        raise RuntimeError(f"Stone Action detail page is missing a title: {detail_url}")

    gallery_urls = unique_preserve_order(
        [anchor.get("href") for anchor in soup.select("a.fusion-lightbox[href]")]
    )
    primary_image_url = gallery_urls[0] if gallery_urls else clean_text(card["archive_thumbnail_url"]) or None

    fields = parse_detail_fields(soup)
    width_in, height_in = parse_size(fields["avg_size_text"])

    return StoneActionRecord(
        name=name,
        material=material,
        brand=brand,
        detail_url=detail_url,
        image_url=primary_image_url,
        archive_thumbnail_url=clean_text(card["archive_thumbnail_url"]) or None,
        gallery_image_urls=" | ".join(gallery_urls),
        block_number=fields["block_number"],
        thickness=fields["thickness"],
        base_color=fields["base_color"],
        width_in=width_in,
        height_in=height_in,
        avg_size_text=fields["avg_size_text"],
        archive_url=clean_text(card["archive_url"]),
        category_key=category_key,
    )


def scrape_stone_action(timeout_sec: int, request_delay_sec: float) -> list[StoneActionRecord]:
    session = build_session()
    records: list[StoneActionRecord] = []

    for config in CATEGORY_CONFIGS:
        cards = collect_archive_cards(
            session,
            archive_url=config["archive_url"],
            timeout_sec=timeout_sec,
            request_delay_sec=request_delay_sec,
        )
        logging.info("Stone Action %s total unique detail pages: %s", config["key"], len(cards))
        for index, card in enumerate(cards, start=1):
            record = parse_detail_page(
                session=session,
                card=card,
                material=config["material"],
                brand=config["brand"],
                category_key=config["key"],
                timeout_sec=timeout_sec,
            )
            records.append(record)
            if index % 10 == 0:
                logging.info("Stone Action %s processed %s/%s detail pages", config["key"], index, len(cards))
            time.sleep(request_delay_sec)

    records.sort(key=lambda row: (row.material, row.name, row.detail_url))
    return records


def write_json(path: Path, rows: list[StoneActionRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump([asdict(row) for row in rows], handle, indent=2)


def write_csv(path: Path, rows: list[StoneActionRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(asdict(rows[0]).keys()) if rows else list(StoneActionRecord.__dataclass_fields__.keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Stone Action slabs into local JSON and CSV files.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--timeout-sec", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--request-delay-sec", type=float, default=DEFAULT_REQUEST_DELAY_SEC)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    timestamp = now_timestamp_slug()
    rows = scrape_stone_action(
        timeout_sec=args.timeout_sec,
        request_delay_sec=args.request_delay_sec,
    )
    normalized_rows = normalize_records(rows)

    json_path = args.output_dir / f"stone_action_inventory_{timestamp}.json"
    csv_path = args.output_dir / f"stone_action_inventory_{timestamp}.csv"
    normalized_json_path = args.output_dir / f"stone_action_inventory_normalized_{timestamp}.json"
    normalized_csv_path = args.output_dir / f"stone_action_inventory_normalized_{timestamp}.csv"
    write_json(json_path, rows)
    write_csv(csv_path, rows)
    write_json(normalized_json_path, normalized_rows)
    write_csv(normalized_csv_path, normalized_rows)

    material_counts: dict[str, int] = {}
    for row in normalized_rows:
        material_counts[row.material] = material_counts.get(row.material, 0) + 1

    logging.info("Stone Action exported %s raw rows", len(rows))
    logging.info("Stone Action exported %s normalized rows", len(normalized_rows))
    logging.info("Stone Action material counts: %s", material_counts)
    logging.info("Stone Action JSON output: %s", json_path)
    logging.info("Stone Action CSV output: %s", csv_path)
    logging.info("Stone Action normalized JSON output: %s", normalized_json_path)
    logging.info("Stone Action normalized CSV output: %s", normalized_csv_path)


if __name__ == "__main__":
    main()
