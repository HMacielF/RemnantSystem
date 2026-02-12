import re


def parse_line(description: str):
    """
    Example formats:
      "#48 | 42x60 | Sold"
      "#49 | 42x60+18x24 | On Hold"
      "#50 | 42x60"
    """
    # Moraware descriptions may use "|" or "/" as separators.
    parts = [p.strip() for p in re.split(r"\s*[|/]\s*", description) if p.strip()]

    remnant_id = int(parts[0].strip("#").strip())
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
        name = right.split("-")[0].strip()
    elif title.strip().lower().startswith("quick "):
        material = "Quick Quartz"
        print("Title: ", title)
        name = title.split(" - ")[0]
        print("name: ", name)

    return material, name
