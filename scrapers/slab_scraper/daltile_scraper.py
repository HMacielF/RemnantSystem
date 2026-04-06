"""
Daltile slab scraper.

Current scope:
- Quartz and porcelain slab series pages provided by the team
- Color-detail extraction from server-rendered sample blocks
- Export of canonical slab rows with duplicate FC variants removed
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

import requests
from bs4 import BeautifulSoup


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


BASE_URL = "https://www.daltile.com"
DEFAULT_OUTPUT_DIR = Path("scrapers/slab_scraper/output/daltile")
DEFAULT_TIMEOUT_SEC = 30
DEFAULT_LIMIT = 0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
SERIES_SOURCES: tuple[tuple[str, str], ...] = (
    ("Quartz", "https://www.daltile.com/products/slab/one-quartz-marble-look"),
    ("Quartz", "https://www.daltile.com/products/slab/one-quartz-stone-look"),
    ("Quartz", "https://www.daltile.com/products/slab/one-quartz-monochromatic-look"),
    ("Quartz", "https://www.daltile.com/products/slab/one-quartz-concrete-look"),
    ("Porcelain", "https://www.daltile.com/products/slab/elemental-selection"),
    ("Porcelain", "https://www.daltile.com/products/slab/industrial-selection"),
    ("Porcelain", "https://www.daltile.com/products/slab/metallic-selection"),
)


@dataclass(frozen=True)
class DaltileSeriesSource:
    material: str
    series_url: str


@dataclass
class DaltileSlabRecord:
    name: str
    size: str | None
    thickness: str | None
    finish: str | None
    material: str
    series_name: str | None
    color_code: str | None
    detail_url: str
    image_url: str | None


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


def get_input_value(container, name: str) -> str | None:
    node = container.select_one(f"input[name='{name}']")
    if not node:
        return None

    value = safe_text(node.get("value"))
    return value or None


def get_property_value(container, label_text: str) -> str | None:
    for group in container.select(".sample-property-group"):
        label = group.select_one("label")
        if not label:
            continue

        key = safe_text(label.get_text())
        if key.lower() != label_text.lower():
            continue

        value_node = group.select_one("span")
        value = safe_text(value_node.get_text() if value_node else "")
        return value or None

    return None


def collect_series_pages() -> list[DaltileSeriesSource]:
    return [DaltileSeriesSource(material=material, series_url=url) for material, url in SERIES_SOURCES]


def collect_color_links(
    session: requests.Session,
    source: DaltileSeriesSource,
    timeout_sec: int,
) -> list[str]:
    soup = get_soup(session, source.series_url, timeout_sec)
    links: list[str] = []
    seen: set[str] = set()

    for anchor in soup.select("div.color-swatch-card a[href], a.color-swatch-card[href]"):
        href = safe_text(anchor.get("href"))
        detail_url = urljoin(BASE_URL, href)
        if not detail_url or detail_url.rstrip("/") == source.series_url.rstrip("/"):
            continue
        if "/products/" not in detail_url.lower():
            continue
        if detail_url in seen:
            continue

        seen.add(detail_url)
        links.append(detail_url)

    return links


def collect_series_name(soup: BeautifulSoup) -> str | None:
    for selector in ("p.series-name", "h1.page-title"):
        node = soup.select_one(selector)
        if node:
            value = safe_text(node.get_text())
            if value:
                return value
    return None


def parse_detail_records(
    session: requests.Session,
    source: DaltileSeriesSource,
    detail_url: str,
    timeout_sec: int,
) -> list[DaltileSlabRecord]:
    soup = get_soup(session, detail_url, timeout_sec)
    page_series_name = collect_series_name(soup)
    rows: list[DaltileSlabRecord] = []
    seen_keys: set[tuple[str, str | None, str | None, str | None, str]] = set()

    for container in soup.select("div.sample-details.sample-container"):
        name = get_input_value(container, "sample.Product.ColorNameEnglish")
        size = (
            get_property_value(container, "Nominal Size")
            or get_input_value(container, "sample.Product.NominalSize")
        )
        thickness = get_property_value(container, "Thickness")
        finish = (
            get_property_value(container, "Finish")
            or get_input_value(container, "sample.Product.Finish")
        )
        series_name = (
            get_input_value(container, "sample.Product.SeriesName")
            or page_series_name
        )
        color_code = get_input_value(container, "sample.Product.ColorCode")
        image_url = get_input_value(container, "sample.ImageUrl")

        if not name:
            title_node = soup.select_one("h1.page-title")
            name = safe_text(title_node.get_text() if title_node else "") or None

        if not name:
            continue

        dedupe_key = (name, size, thickness, finish, source.material)
        if dedupe_key in seen_keys:
            continue

        seen_keys.add(dedupe_key)
        rows.append(
            DaltileSlabRecord(
                name=name,
                size=size,
                thickness=thickness,
                finish=finish,
                material=source.material,
                series_name=series_name,
                color_code=color_code,
                detail_url=detail_url,
                image_url=image_url,
            )
        )

    return rows


def scrape_material_records(
    session: requests.Session,
    source: DaltileSeriesSource,
    timeout_sec: int,
    limit: int,
) -> list[DaltileSlabRecord]:
    color_links = collect_color_links(session, source, timeout_sec)
    if limit > 0:
        color_links = color_links[:limit]

    records: list[DaltileSlabRecord] = []
    for index, detail_url in enumerate(color_links, start=1):
        logging.info(
            "Scraping %s %s/%s: %s",
            source.material.lower(),
            index,
            len(color_links),
            detail_url,
        )
        records.extend(parse_detail_records(session, source, detail_url, timeout_sec))

    return records


def record_to_payload(record: DaltileSlabRecord) -> dict[str, str | None]:
    return {
        "name": record.name,
        "size": record.size,
        "thickness": record.thickness,
        "finish": record.finish,
        "material": record.material,
        "series_name": record.series_name,
        "color_code": record.color_code,
        "detail_url": record.detail_url,
        "image_url": record.image_url,
    }


def export_records(
    records: list[DaltileSlabRecord],
    output_dir: Path,
) -> list[tuple[str, Path, Path]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_timestamp_slug()
    exports: list[tuple[str, Path, Path]] = []

    for material in ("Quartz", "Porcelain"):
        material_records = [record for record in records if record.material == material]
        if not material_records:
            continue

        slug = material.lower()
        json_path = output_dir / f"daltile_{slug}_{stamp}.json"
        csv_path = output_dir / f"daltile_{slug}_{stamp}.csv"
        payload = [record_to_payload(record) for record in material_records]

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
                    "series_name",
                    "color_code",
                    "detail_url",
                    "image_url",
                ],
            )
            writer.writeheader()
            writer.writerows(payload)

        exports.append((material, json_path, csv_path))

    return exports


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Daltile slab catalogs.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where the exported JSON and CSV files will be written.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Optional maximum number of color detail pages to scrape per series. Use 0 for all.",
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
    all_records: list[DaltileSlabRecord] = []

    for source in collect_series_pages():
        logging.info("Opening Daltile series page: %s", source.series_url)
        series_records = scrape_material_records(
            session=session,
            source=source,
            timeout_sec=args.timeout_sec,
            limit=args.limit,
        )
        all_records.extend(series_records)
        logging.info(
            "Collected %s rows from %s",
            len(series_records),
            source.series_url,
        )

    exports = export_records(all_records, Path(args.output_dir))
    for material, json_path, csv_path in exports:
        logging.info("%s JSON: %s", material, json_path)
        logging.info("%s CSV: %s", material, csv_path)


if __name__ == "__main__":
    main()
