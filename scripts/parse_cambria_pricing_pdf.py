from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


ROW_RE = re.compile(
    r"^(?P<name>.+?)\s+"
    r"(?P<series>Luxury|Signature|Classic|Grandeur|Coordinates)\s+"
    r"(?P<size>47|60)\s+"
    r"(?P<price_3cm>N/A|CFA|[0-9]+\.[0-9]+\$)\s+"
    r"(?P<slab_3cm>N/A|CFA|[0-9,]+\.[0-9]+\$)\s+"
    r"(?P<price_2cm>N/A|CFA|[0-9]+\.[0-9]+\$)\s+"
    r"(?P<slab_2cm>N/A|CFA|[0-9,]+\.[0-9]+\$)\s+"
    r"(?P<price_1cm>N/A|CFA|[0-9]+\.[0-9]+\$)\s+"
    r"(?P<slab_1cm>N/A|CFA|[0-9,]+\.[0-9]+\$)"
)


def parse_price(token: str) -> float | None:
    token = token.strip()
    if token in {"N/A", "CFA"}:
        return None
    return float(token.replace("$", ""))


def clean_name(value: str) -> str:
    return (
        value.replace("™", "")
        .replace("®", "")
        .replace("*", "")
        .replace("  ", " ")
        .strip()
    )


def size_label_from_sqft(size_sqft: int) -> str:
    return "132 x 65.5" if size_sqft == 60 else "122 x 55.5"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: parse_cambria_pricing_pdf.py <pdf-path>")

    path = Path(sys.argv[1])
    text = "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)
    lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]

    rows: list[dict[str, object]] = []
    seen: set[tuple[str, int]] = set()

    for line in lines:
        match = ROW_RE.match(line)
        if not match:
            continue

        name = clean_name(match.group("name"))
        size_sqft = int(match.group("size"))
        key = (name, size_sqft)
        if key in seen:
            continue
        seen.add(key)

        rows.append(
            {
                "name": name,
                "series": match.group("series"),
                "size_sqft": size_sqft,
                "size_label": size_label_from_sqft(size_sqft),
                "price_3cm": parse_price(match.group("price_3cm")),
                "price_2cm": parse_price(match.group("price_2cm")),
                "price_1cm": parse_price(match.group("price_1cm")),
            }
        )

    print(json.dumps(rows, ensure_ascii=True))


if __name__ == "__main__":
    main()
