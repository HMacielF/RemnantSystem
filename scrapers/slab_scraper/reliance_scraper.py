"""
Reliance Surfaces slab scraper.

Current scope:
- Reliance quartz collection archive pages
- Detail-page extraction from WooCommerce variation payloads and selectors
- Export split by material so RQ and RPQ stay distinguishable
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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://reliancesurfaces.com"
LISTING_URL = f"{BASE_URL}/category/reliance-quartz-collections/"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/reliance")
DEFAULT_TIMEOUT_SEC = 30
DEFAULT_LIMIT = 0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


@dataclass
class RelianceSlabRecord:
    name: str
    size: str | None
    thickness: str | None
    finish: str | None
    material: str
    detail_url: str
    image_url: str | None


@dataclass(frozen=True)
class RelianceImageCandidate:
    url: str
    label: str | None
    size: str | None


def now_timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def safe_text(value: str | None) -> str:
    return " ".join((value or "").split())


def get_soup(session: requests.Session, url: str, timeout_sec: int) -> BeautifulSoup:
    response = session.get(url, timeout=timeout_sec)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def normalize_size(value: str | None) -> str | None:
    cleaned = safe_text(value).replace("\xa0", " ")
    if not cleaned:
        return None
    compact = re.sub(r"\s*[xX]\s*", "X", cleaned)
    compact = re.sub(r"\s+", "", compact)
    if re.fullmatch(r"\d+x\d+", compact, flags=re.IGNORECASE):
        return compact.upper()
    return cleaned.upper()


def normalize_thickness(value: str | None) -> str | None:
    cleaned = safe_text(value)
    if not cleaned:
        return None
    compact = re.sub(r"\s+", "", cleaned)
    if re.fullmatch(r"\d+(?:\.\d+)?cm", compact, flags=re.IGNORECASE):
        return compact.upper()
    if re.fullmatch(r"\d+(?:\.\d+)?cm(?:,\d+(?:\.\d+)?cm)+", compact, flags=re.IGNORECASE):
        return ", ".join(part.upper() for part in compact.split(","))
    return cleaned.title()


def normalize_finish(value: str | None) -> str | None:
    cleaned = safe_text(value)
    if not cleaned:
        return None
    return cleaned.title()


def normalize_material(value: str | None) -> str:
    cleaned = safe_text(value).lower()
    if "printed quartz" in cleaned:
        return "Printed Quartz"
    return "Quartz"


def collect_gallery_candidates(soup: BeautifulSoup) -> list[RelianceImageCandidate]:
    candidates: list[RelianceImageCandidate] = []
    seen: set[str] = set()

    labels: list[str | None] = []
    for thumb in soup.select("#product-thumbnail-images .thumbnail-item"):
        label = thumb.select_one(".gallery-title, .image-title")
        labels.append(safe_text(label.get_text()) if label else None)

    for index, anchor in enumerate(soup.select("#product-images figure.image-item a[href]")):
        url = urljoin(BASE_URL, safe_text(anchor.get("href")))
        if not url or url in seen:
            continue
        seen.add(url)
        label = labels[index] if index < len(labels) else None
        size = safe_text(anchor.get("data-size")) or None
        candidates.append(RelianceImageCandidate(url=url, label=label, size=size))

    return candidates


def image_candidate_score(candidate: RelianceImageCandidate, position: int) -> int:
    score = 0
    label = safe_text(candidate.label).lower()
    filename = Path(urlparse(candidate.url).path).name.lower()
    size = safe_text(candidate.size).lower()

    if "full slab" in label or "full-slab" in filename or "full slab" in filename:
        score += 25
    if "close up" in label or "close-up" in filename or "close up" in filename:
        score += 14
    if "application" in label or "application" in filename:
        score -= 12

    if "slab" in filename:
        score += 8
    if "close" in filename:
        score += 5
    if "application" in filename:
        score -= 8

    if size:
        match = re.match(r"(\d+)x(\d+)", size)
        if match:
            width = int(match.group(1))
            height = int(match.group(2))
            if width >= 1500:
                score += 4
            if width > height:
                score += 2

    if position == 0:
        score += 1

    return score


def choose_best_image_url(variation_image_url: str | None, soup: BeautifulSoup) -> str | None:
    candidates = collect_gallery_candidates(soup)
    if variation_image_url:
        variation_candidate = RelianceImageCandidate(url=variation_image_url, label=None, size=None)
        if all(candidate.url != variation_image_url for candidate in candidates):
            candidates.insert(0, variation_candidate)

    if not candidates:
        return variation_image_url

    scored = [
        (image_candidate_score(candidate, index), index, candidate.url)
        for index, candidate in enumerate(candidates)
    ]
    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[0][2]


def collect_listing_products(
    session: requests.Session,
    timeout_sec: int,
    limit: int,
) -> list[tuple[str, str]]:
    products: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    next_url: str | None = LISTING_URL
    page_index = 0

    while next_url:
        page_index += 1
        soup = get_soup(session, next_url, timeout_sec)
        logging.info("Collecting Reliance listing page %s: %s", page_index, next_url)

        for anchor in soup.select("a.woocommerce-LoopProduct-link.woocommerce-loop-product__link[href]"):
            detail_url = urljoin(BASE_URL, safe_text(anchor.get("href")))
            if not detail_url or detail_url in seen_urls:
                continue

            title = anchor.select_one(".woocommerce-loop-product__title")
            name = safe_text(title.get_text()) if title else safe_text(anchor.get_text())
            if not name:
                continue

            seen_urls.add(detail_url)
            products.append((name, detail_url))
            if limit > 0 and len(products) >= limit:
                return products

        next_link = soup.select_one("a.next.page-numbers[href]")
        next_url = urljoin(BASE_URL, safe_text(next_link.get("href"))) if next_link else None

    return products


def parse_variations_form(soup: BeautifulSoup) -> list[dict]:
    form = soup.select_one("form.variations_form[data-product_variations]")
    if not form:
        return []

    raw_value = form.get("data-product_variations")
    if not raw_value:
        return []

    try:
        payload = json.loads(html.unescape(raw_value))
    except json.JSONDecodeError:
        return []

    return payload if isinstance(payload, list) else []


def parse_selector_options(soup: BeautifulSoup) -> dict[str, list[str]]:
    options: dict[str, list[str]] = {}

    for select in soup.select("form.variations_form select[name^='attribute_pa_']"):
        name = safe_text(select.get("name")).removeprefix("attribute_pa_")
        values = []
        for option in select.select("option[value]"):
            raw_value = safe_text(option.get("value"))
            label = safe_text(option.get_text())
            if not raw_value:
                continue
            values.append(label or raw_value)
        if values:
            options[name] = values

    return options


def parse_specification_blocks(soup: BeautifulSoup) -> dict[str, str]:
    values: dict[str, str] = {}

    for block in soup.select("div[class*='attr_display_design']"):
        label_node = block.select_one("span")
        if not label_node:
            continue

        label = safe_text(label_node.get_text()).lower().rstrip(":")
        full_text = safe_text(block.get_text(" ", strip=True))
        if not full_text:
            continue

        value = full_text.replace(safe_text(label_node.get_text()), "", 1).strip(" :")
        if value:
            values[label] = value

    return values


def choose_fallback_value(options: dict[str, list[str]], key: str) -> str | None:
    values = options.get(key) or []
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return ", ".join(values)


def collect_detail_records(
    session: requests.Session,
    listing_name: str,
    detail_url: str,
    timeout_sec: int,
) -> list[RelianceSlabRecord]:
    soup = get_soup(session, detail_url, timeout_sec)
    variations = parse_variations_form(soup)
    selector_options = parse_selector_options(soup)
    spec_values = parse_specification_blocks(soup)

    page_title = soup.select_one("h1.product_title, h1.entry-title, .product_title")
    name = safe_text(page_title.get_text()) if page_title else listing_name
    fallback_size = choose_fallback_value(selector_options, "size") or spec_values.get("size")
    fallback_thickness = choose_fallback_value(selector_options, "thickness")
    fallback_finish = choose_fallback_value(selector_options, "finish")
    fallback_material = choose_fallback_value(selector_options, "material")

    records: list[RelianceSlabRecord] = []
    seen_keys: set[tuple[str, str | None, str | None, str | None, str]] = set()

    if not variations:
        material = normalize_material(fallback_material)
        records.append(
            RelianceSlabRecord(
                name=name,
                size=normalize_size(fallback_size),
                thickness=normalize_thickness(fallback_thickness),
                finish=normalize_finish(fallback_finish),
                material=material,
                detail_url=detail_url,
                image_url=None,
            )
        )
        return records

    for variation in variations:
        attrs = variation.get("attributes") or {}
        image = variation.get("image") or {}

        size = normalize_size(
            attrs.get("attribute_pa_size")
            or choose_fallback_value(selector_options, "size")
            or spec_values.get("size")
        )
        thickness = normalize_thickness(
            attrs.get("attribute_pa_thickness")
            or choose_fallback_value(selector_options, "thickness")
        )
        finish = normalize_finish(
            attrs.get("attribute_pa_finish")
            or choose_fallback_value(selector_options, "finish")
        )
        material = normalize_material(
            attrs.get("attribute_pa_material")
            or choose_fallback_value(selector_options, "material")
        )
        variation_image_url = safe_text(image.get("full_src") or image.get("url")) or None
        image_url = choose_best_image_url(variation_image_url, soup)

        dedupe_key = (name, size, thickness, finish, material)
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)

        records.append(
            RelianceSlabRecord(
                name=name,
                size=size,
                thickness=thickness,
                finish=finish,
                material=material,
                detail_url=detail_url,
                image_url=image_url,
            )
        )

    return records


def record_to_payload(record: RelianceSlabRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "size": record.size,
        "thickness": record.thickness,
        "finish": record.finish,
        "material": record.material,
        "detail_url": record.detail_url,
        "image_url": record.image_url,
    }


def export_records(records: list[RelianceSlabRecord], output_dir: Path) -> list[tuple[str, Path, Path]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    exports: list[tuple[str, Path, Path]] = []

    for material_label, slug in (("Quartz", "quartz"), ("Printed Quartz", "printed_quartz")):
        material_records = [record for record in records if record.material == material_label]
        if not material_records:
            continue

        payload = [record_to_payload(record) for record in material_records]
        json_path = output_dir / f"reliance_{slug}_{stamp}.json"
        csv_path = output_dir / f"reliance_{slug}_{stamp}.csv"
        json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "name",
                    "size",
                    "thickness",
                    "finish",
                    "material",
                    "detail_url",
                    "image_url",
                ],
            )
            writer.writeheader()
            writer.writerows(payload)

        exports.append((material_label, json_path, csv_path))

    return exports


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Reliance Surfaces quartz collections.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where the exported JSON and CSV files will be written.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Optional maximum number of detail pages to scrape. Use 0 for all.",
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
    products = collect_listing_products(session, args.timeout_sec, args.limit)
    logging.info("Collected %s Reliance products", len(products))

    records: list[RelianceSlabRecord] = []
    for index, (listing_name, detail_url) in enumerate(products, start=1):
        logging.info("Scraping Reliance detail %s/%s: %s", index, len(products), detail_url)
        records.extend(collect_detail_records(session, listing_name, detail_url, args.timeout_sec))

    exports = export_records(records, Path(args.output_dir))
    for material, json_path, csv_path in exports:
        logging.info("%s JSON: %s", material, json_path)
        logging.info("%s CSV: %s", material, csv_path)


if __name__ == "__main__":
    main()
