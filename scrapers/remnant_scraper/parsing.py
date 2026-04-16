import re


BRAND_PREFIX_RULES = [
    {
        "pattern": re.compile(r"^(quick)\s+(.+)$", re.IGNORECASE),
        "brand_name": "Quick Color",
        "supplier_name": "Quick Countertop",
    },
    {
        "pattern": re.compile(r"^(one\s*quartz)\s+by\s+(daltile)\s+(.+)$", re.IGNORECASE),
        "brand_name": "One Quartz",
        "supplier_name": "Daltile",
    },
    {
        "pattern": re.compile(r"^(msi)\s+(.+)$", re.IGNORECASE),
        "brand_name": "MSI",
        "supplier_name": "MSI Surfaces",
    },
    {
        "pattern": re.compile(r"^(cambria)\s+(.+)$", re.IGNORECASE),
        "brand_name": "Cambria",
        "supplier_name": "Cambria",
    },
    {
        "pattern": re.compile(r"^(caesar\s*stone|caesarstone)\s+(.+)$", re.IGNORECASE),
        "brand_name": "Caesarstone",
        "supplier_name": "Caesarstone",
    },
    {
        "pattern": re.compile(r"^(x[\s-]?tone|xtone)\s+(.+)$", re.IGNORECASE),
        "brand_name": "X-Tone",
        "supplier_name": "X-Tone",
    },
    {
        "pattern": re.compile(r"^(laminam)\s+(.+)$", re.IGNORECASE),
        "brand_name": "Laminam",
        "supplier_name": "Laminam",
    },
    {
        "pattern": re.compile(r"^(cosmos)\s+(.+)$", re.IGNORECASE),
        "brand_name": "Cosmos",
        "supplier_name": "Cosmos",
    },
]

FINISH_KEYWORDS = {
    "polished": "Polished",
    "honed": "Honed",
    "matte": "Matte",
    "concrete": "Concrete",
    "brushed": "Brushed",
}


def parse_line(description: str):
    """
    Example formats:
      "#48 | 42x60 | Sold"
      "#49 | 42x60+18x24 | On Hold"
      "#50 | 42x60"
    """
    # Moraware descriptions may use "|" or "/" as separators.
    parts = [p.strip() for p in re.split(r"\s*[|/]\s*", description) if p.strip()]
    if len(parts) < 2:
        return None

    remnant_match = re.search(r"#?\s*(\d+)", parts[0])
    if not remnant_match:
        return None

    remnant_id = int(remnant_match.group(1))
    sizes = parts[1].replace(" ", "").lower().split("+")

    m = re.search(r"(\d+)x(\d+)", sizes[0])
    if not m:
        return None

    width = int(m.group(1))
    height = int(m.group(2))

    l_shape = False
    l_width = None
    l_height = None

    if len(sizes) > 1:
        m2 = re.search(r"(\d+)x(\d+)", sizes[1])
        if m2:
            l_shape = True
            l_width = int(m2.group(1))
            l_height = int(m2.group(2))

    status = "Available"
    if len(parts) > 2:
        status_text = parts[2].lower()
        if "sold" in status_text:
            status = "Sold"
        elif "hold" in status_text:
            status = "Hold"

    return remnant_id, width, height, l_shape, l_width, l_height, status


def parse_thickness(text: str) -> str:
    """
    Best-effort thickness parsing from description or other text.
    Returns a string because DB schema uses thickness TEXT NOT NULL.
    """
    t = (text or "").lower().replace(" ", "")

    m = re.search(r"(?:^|[^0-9])((?:2|3)cm)(?:$|[^a-z])", t)
    if m:
        return m.group(1)

    m = re.search(r"(\d+(?:\.\d+)?)\"", t)
    if m:
        return f'{m.group(1)}"'

    return "unknown"


def parse_finish(text: str) -> str | None:
    cleaned = re.sub(r"\s+", " ", (text or "").strip()).lower()
    if not cleaned:
        return None

    for keyword, finish_name in FINISH_KEYWORDS.items():
        if f"{keyword} finish" in cleaned or re.search(rf"\\b{re.escape(keyword)}\\b", cleaned):
            return finish_name

    return None


def get_page_material_and_name(title: str):
    """
    Example title:
      "Quartz | Cambria Hailey - Job Detail - Moraware Systemize"
    Extracts material="Quartz", name="Cambria Hailey"
    """
    material = ""
    name = ""

    if "|" in title:
        left, right = title.split("|", 1)
        material = left.strip()
        name = right.removesuffix("- Job Detail - Moraware Systemize")
    elif title.strip().lower().startswith("quick "):
        material = "Quartz"
        name = title.split(" - ")[0]

    return material, name


def parse_brand_and_stone_name(raw_name: str):
    cleaned = re.sub(r"\s+", " ", (raw_name or "").strip())
    if not cleaned:
        return {
            "display_name": "",
            "brand_name": None,
            "supplier_name": None,
            "stone_name": "",
        }

    for rule in BRAND_PREFIX_RULES:
        match = rule["pattern"].match(cleaned)
        if not match:
            continue
        groups = [group.strip() for group in match.groups() if group and group.strip()]
        stone_name = groups[-1] if groups else cleaned
        return {
            "display_name": cleaned,
            "brand_name": rule["brand_name"],
            "supplier_name": rule["supplier_name"],
            "stone_name": stone_name,
        }

    return {
        "display_name": cleaned,
        "brand_name": None,
        "supplier_name": None,
        "stone_name": cleaned,
    }
