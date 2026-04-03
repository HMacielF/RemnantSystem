import hashlib
import os
from io import BytesIO
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from PIL import Image


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def infer_extension(url: str, content_type: str | None) -> str:
    parsed = urlparse(url)
    ext = os.path.splitext(parsed.path)[1].lower().replace(".", "")
    valid = {"jpg", "jpeg", "png", "gif", "bmp"}

    if ext in valid:
        return "jpg" if ext == "jpeg" else ext

    if content_type:
        ct = content_type.lower()
        if "jpeg" in ct or "jpg" in ct:
            return "jpg"
        if "png" in ct:
            return "png"
        if "gif" in ct:
            return "gif"
        if "bmp" in ct:
            return "bmp"

    return "jpg"


def requests_session_from_selenium(driver) -> requests.Session:
    """
    Builds a requests session using Selenium cookies so we can download
    Moraware-protected images without opening new tabs.
    """
    sess = requests.Session()
    for cookie in driver.get_cookies():
        sess.cookies.set(cookie["name"], cookie["value"], domain=cookie.get("domain"))
    return sess


def normalize_image_bytes(data: bytes, content_type: str | None) -> tuple[bytes, str, str]:
    """
    Re-encodes most downloaded images into WebP to reduce storage and transfer
    size without changing the image dimensions. Animated GIFs are left alone so
    they do not lose animation unexpectedly.
    """
    normalized_type = (content_type or "").lower()

    with Image.open(BytesIO(data)) as image:
        is_animated = bool(getattr(image, "is_animated", False))
        if is_animated and normalized_type == "image/gif":
            return data, "image/gif", "gif"

        converted = image.convert("RGB")
        output = BytesIO()
        converted.save(output, format="WEBP", quality=86, method=6)
        return output.getvalue(), "image/webp", "webp"
