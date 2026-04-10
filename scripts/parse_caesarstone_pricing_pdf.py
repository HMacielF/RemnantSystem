from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


PRICE_LINE_RE = re.compile(
    r"^Price/\s*Sq\.\s*Ft\.\s+\$?([0-9]+(?:\.[0-9]+)?)\s+\$?([0-9]+(?:\.[0-9]+)?)\s+\$?([0-9]+(?:\.[0-9]+)?)\s+\$?([0-9]+(?:\.[0-9]+)?)$",
    re.IGNORECASE,
)
PRODUCT_RE = re.compile(r"^(\d{4})\s+(.+?)\s+([PNHRC](?:\s+[PNHRC])*)$")


def clean_name(value: str) -> str:
    return (
        value.replace("™", "")
        .replace("®", "")
        .replace("  ", " ")
        .strip()
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: parse_caesarstone_pricing_pdf.py <pdf-path>")

    path = Path(sys.argv[1])
    text = "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)
    lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]

    current_prices: dict[str, float] | None = None
    rows: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()

    for line in lines:
        price_match = PRICE_LINE_RE.match(line)
        if price_match:
            current_prices = {
                "standard_2cm": float(price_match.group(1)),
                "standard_3cm": float(price_match.group(2)),
                "jumbo_2cm": float(price_match.group(3)),
                "jumbo_3cm": float(price_match.group(4)),
            }
            continue

        if current_prices is None:
            continue

        product_match = PRODUCT_RE.match(line)
        if not product_match:
            continue

        code = product_match.group(1)
        name = clean_name(product_match.group(2))
        key = (code, name)
        if key in seen:
            continue
        seen.add(key)

        rows.append(
            {
                "product_code": code,
                "name": name,
                "jumbo_2cm_price": current_prices["jumbo_2cm"],
                "jumbo_3cm_price": current_prices["jumbo_3cm"],
                "standard_2cm_price": current_prices["standard_2cm"],
                "standard_3cm_price": current_prices["standard_3cm"],
            }
        )

    print(json.dumps(rows, ensure_ascii=True))


if __name__ == "__main__":
    main()
