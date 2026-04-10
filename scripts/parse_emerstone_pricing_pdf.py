#!/usr/bin/env python3
import json
import re
import sys
from pypdf import PdfReader


ENTRY_RE = re.compile(
    r"([A-Za-z0-9'’* .\-/]+?)\s*(?:\(([^)]*)\)\s*)?(\d+(?:\.\d+)?)\s+\$(\d+(?:\.\d+)?)\s+\$([\d,]+)"
)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def clean_name(value: str) -> str:
    cleaned = normalize_space(value)
    cleaned = re.sub(r"^[0-9]+", "", cleaned).strip()
    cleaned = re.sub(r"^(?:nish\.\s*)", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned


def main() -> None:
    if len(sys.argv) < 2:
      raise SystemExit("Usage: parse_emerstone_pricing_pdf.py <pdf_path>")

    pdf_path = sys.argv[1]
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)

    rows = []
    seen = set()
    for match in ENTRY_RE.finditer(text):
        name, size_label, sqft, psf, slab_price = match.groups()
        name = clean_name(name)
        if not name:
            continue

        record = {
            "supplier_product_name": name,
            "size_label": normalize_space(size_label or ""),
            "sqft": float(sqft),
            "list_price_per_sqft": float(psf),
            "slab_price": int(str(slab_price).replace(",", "")),
        }

        dedupe_key = (
            record["supplier_product_name"].lower(),
            record["size_label"].lower(),
            round(record["list_price_per_sqft"], 4),
            record["slab_price"],
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        rows.append(record)

    json.dump(rows, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
