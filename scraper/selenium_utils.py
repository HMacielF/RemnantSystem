import os
import re
import time
import hashlib
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from supabase import create_client

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By

# ---------- Logging ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


# ---------- Helpers ----------
def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


import re

def parse_line(description: str):
    """
    Example formats:
      "#48 | 42x60 | Sold"
      "#49 | 42x60+18x24 | On Hold"
      "#50 | 42x60"
    """

    parts = [p.strip() for p in description.split("|")]

    # --- Remnant ID ---
    remnant_id = int(parts[0].strip("#").strip())

    # --- Sizes ---
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

    # --- Status ---
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
    Returns a string because your DB schema uses thickness TEXT NOT NULL.
    """
    t = (text or "").lower().replace(" ", "")

    # common cm
    m = re.search(r"(?:^|[^0-9])((?:2|3)cm)(?:$|[^a-z])", t)
    if m:
        return m.group(1)

    # inches like 1.25"
    m = re.search(r"(\d+(?:\.\d+)?)\"", t)
    if m:
        return f'{m.group(1)}"'

    return "unknown"


def get_page_material_and_name(driver):
    """
    Example title:
      "Quartz | Cambria Hailey - Job Detail - Moraware Systemize"
    Extracts:
      material="Quartz"
      name="Cambria Hailey"
    """
    title = driver.title or ""
    material = ""
    name = ""

    if "|" in title:
        left, right = title.split("|", 1)
        material = left.strip()
        name = right.split("-")[0].strip()
    elif title.split(" ")[0].strip() == "Quick":
            material = "Quick Quartz"


    return material, name


def requests_session_from_selenium(driver) -> requests.Session:
    """
    Builds a requests session using Selenium cookies so we can download
    Moraware-protected images without opening new tabs.
    """
    sess = requests.Session()
    for c in driver.get_cookies():
        sess.cookies.set(c["name"], c["value"], domain=c.get("domain"))
    return sess


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def infer_extension(url: str, content_type: str | None) -> str:
    # 1️⃣ Try from URL
    parsed = urlparse(url)
    ext = os.path.splitext(parsed.path)[1].lower().replace(".", "")

    valid = {"jpg", "jpeg", "png", "gif", "bmp"}

    if ext in valid:
        return "jpg" if ext == "jpeg" else ext

    # 2️⃣ Fallback to content-type
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

    # 3️⃣ Safe fallback
    return "jpg"


# ---------- Main ----------
def main():
    load_dotenv()

    MORAWARE_URL = os.getenv("MORAWARE_URL")
    MORAWARE_USER = os.getenv("MORAWARE_USER")
    MORAWARE_PASS = os.getenv("MORAWARE_PASS")

    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY")  # RLS is off per you, so anon/service both work
    SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "remnant-images")

    if not all([MORAWARE_URL, MORAWARE_USER, MORAWARE_PASS, SUPABASE_URL, SUPABASE_KEY]):
        raise RuntimeError("Missing required env vars. Check .env for Moraware + Supabase values.")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    options = Options()
    # Uncomment for headless environments (GitHub Actions, etc.)
    # options.add_argument("--headless=new")
    # options.add_argument("--no-sandbox")
    # options.add_argument("--disable-dev-shm-usage")

    driver = webdriver.Chrome(options=options)

    total_rows_seen = 0
    total_with_id = 0
    total_changed = 0
    total_no_change = 0
    total_photo_downloaded = 0
    total_photo_skipped_same_hash = 0
    total_photo_uploaded = 0
    total_errors = 0

    run_started_at = datetime.now(timezone.utc).isoformat()
    seen_ids = set()

    try:
        logging.info("Starting Moraware → Supabase sync")

        # ---- Login ----
        driver.get(MORAWARE_URL)
        wait = WebDriverWait(driver, 15)

        wait.until(EC.visibility_of_element_located((By.ID, "loginform")))
        driver.find_element(By.ID, "user").send_keys(MORAWARE_USER)
        driver.find_element(By.ID, "pwd").send_keys(MORAWARE_PASS)
        driver.find_element(By.ID, "LOGIN").click()

        wait.until(EC.url_contains("/sys/"))
        logging.info("Logged into Moraware successfully")

        # Go back to the job list URL (handles redirects)
        driver.get(MORAWARE_URL)

        # ---- Collect job URLs ----
        job_urls = []
        page_num = 1

        while True:
            WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "Jobs_1Body")))
            rows = driver.find_elements(By.CSS_SELECTOR, "#Jobs_1Body tr")

            added_this_page = 0
            for i, r in enumerate(rows):
                if i == 0:
                    continue
                tds = r.find_elements(By.TAG_NAME, "td")
                if not tds:
                    continue
                anchors = tds[0].find_elements(By.TAG_NAME, "a")
                if anchors:
                    href = anchors[0].get_attribute("href")
                    if href:
                        job_urls.append(href)
                        added_this_page += 1

            logging.info(f"Job list page {page_num}: collected {added_this_page} job links")

            try:
                anchors = driver.find_elements(By.CSS_SELECTOR, "#Jobs_1Body tr a")
                first_href = anchors[0].get_attribute("href") if anchors else None

                next_btn = driver.find_element(By.CSS_SELECTOR, "span.pageNavEnabled.navPadLeft a")
                driver.execute_script("arguments[0].click();", next_btn)

                WebDriverWait(driver, 10).until(
                    lambda d: (
                        d.find_elements(By.CSS_SELECTOR, "#Jobs_1Body tr a")
                        and d.find_elements(By.CSS_SELECTOR, "#Jobs_1Body tr a")[0].get_attribute("href") != first_href
                    )
                )
                page_num += 1
                time.sleep(0.5)
            except Exception:
                break

        # De-dupe while preserving order
        seen = set()
        job_urls = [u for u in job_urls if not (u in seen or seen.add(u))]

        logging.info(f"Collected {len(job_urls)} total job pages")

        # ---- Process each job page ----
        for job_i, job_url in enumerate(job_urls, start=1):
            logging.info(f"[{job_i}/{len(job_urls)}] Processing job page: {job_url}")

            driver.get(job_url)

            try:
                WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "FilesScroll1Body")))
            except Exception:
                logging.warning("No files table found (FilesScroll1Body). Skipping job page.")
                continue

            # Build requests session once per job page (uses same auth cookies)
            sess = requests_session_from_selenium(driver)

            # Material & name from page title as fallback
            material_from_title, name_from_title = get_page_material_and_name(driver)

            # Your schema has NOT NULL name/material/thickness, so never send None
            name = name_from_title or "unknown"
            material = material_from_title or "unknown"
        

            file_rows = driver.find_elements(By.CSS_SELECTOR, "#FilesScroll1Body tr")
            logging.info(f"Found {max(0, len(file_rows) - 1)} file rows on page")

            for idx, row in enumerate(file_rows):
                total_rows_seen += 1

                try:
                    tds = row.find_elements(By.TAG_NAME, "td")
                    if len(tds) < 2:
                        continue

                    # robust description pick
                    description = ""
                    for td in tds:
                        text = (td.text or "").strip()
                        if re.search(r"#\d+", text):
                            description = text
                            break
                    if not description:
                        continue

                    m_id = re.search(r"#(\d+)", description)
                    if not m_id:
                        continue

                    total_with_id += 1

                    size_parsed = parse_line(description)
                    if not size_parsed:
                        logging.warning(f"Remnant #{remnant_id}: could not parse size from '{description}'")
                        continue

                    remnant_id, width, height, l_shape, l_width, l_height, status = size_parsed
                    thickness = parse_thickness(description)

                    # Download link for the photo
                    download_links = tds[1].find_elements(By.TAG_NAME, "a")
                    if not download_links:
                        logging.warning(f"Remnant #{remnant_id}: no download link found")
                        continue

                    download_href = download_links[0].get_attribute("href")
                    if not download_href:
                        logging.warning(f"Remnant #{remnant_id}: download href was empty")
                        continue

                    full_url = (
                        "https://quickcountertop.moraware.net" + download_href
                        if download_href.startswith("/")
                        else download_href
                    )

                    logging.info(
                        f"Remnant #{remnant_id} | {material} | {name} | "
                        f"Size {width}x{height} | L-shape={bool(l_shape)}"
                    )

                    # ---- 1) DB sync via RPC (your sync_remnant function) ----
                    rpc_payload = {
                        "p_id": remnant_id,
                        "p_name": name,
                        "p_material": material,
                        "p_width": width,
                        "p_height": height,
                        "p_thickness": thickness,
                        "p_l_shape": bool(l_shape),
                        "p_l_width": l_width,
                        "p_l_height": l_height,
                        "p_source_image_url": full_url,
                    }

                    rpc_res = supabase.rpc("sync_remnant", rpc_payload).execute()
                    status = (rpc_res.data[0]["sync_status"] if rpc_res.data else "no_change")

                    if status == "changed":
                        total_changed += 1
                        logging.info(f"Remnant #{remnant_id}: metadata changed (insert/update)")
                    else:
                        total_no_change += 1
                        logging.info(f"Remnant #{remnant_id}: no metadata change, skipping photo")
                        continue

                    # ---- 2) Photo download (auth-required) ----
                    logging.info(f"Remnant #{remnant_id}: downloading image bytes")
                    img_resp = sess.get(full_url, timeout=30)
                    img_resp.raise_for_status()
                    img_bytes = img_resp.content
                    total_photo_downloaded += 1

                    new_photo_hash = sha256_bytes(img_bytes)
                    logging.info(f"Remnant #{remnant_id}: photo_hash={new_photo_hash[:12]}...")

                    # Check existing photo_hash to avoid re-upload
                    existing = (
                        supabase.table("remnants")
                        .select("photo_hash")
                        .eq("id", remnant_id)
                        .limit(1)
                        .execute()
                    )
                    existing_hash = existing.data[0].get("photo_hash") if existing.data else None

                    if existing_hash == new_photo_hash:
                        total_photo_skipped_same_hash += 1
                        logging.info(f"Remnant #{remnant_id}: photo unchanged, skipping upload")
                        continue

                    # ---- 3) Upload to Supabase Storage (flat, no folders) ----
                    content_type = img_resp.headers.get("Content-Type", "")
                    ext = infer_extension(full_url, content_type)

                    image_path = f"{remnant_id}_{new_photo_hash}.{ext}"

                    # flat filename inside the bucket (no slashes)
                    ext = "jpg"  # or derive from content_type if you want
                    image_path = f"{remnant_id}_{new_photo_hash}.{ext}"

                    logging.info(
                        f"Remnant #{remnant_id}: uploading to bucket='{SUPABASE_BUCKET}' "
                        f"as '{image_path}' content_type='{content_type}'"
                    )

                    supabase.storage.from_(SUPABASE_BUCKET).upload(
                        image_path,
                        img_bytes,
                        {"content-type": content_type, "upsert": "true"},
                    )
                    total_photo_uploaded += 1

                    public_url = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(image_path)

                    # ---- 4) Update row with photo fields ----
                    supabase.table("remnants").update(
                        {
                            "photo_hash": new_photo_hash,
                            "image_path": image_path,   # keep this, it’s useful
                            "image": public_url,
                            "photo_synced_at": now_iso_utc(),
                            "updated_at": now_iso_utc(),
                        }
                    ).eq("id", remnant_id).execute()

                    logging.info(f"Remnant #{remnant_id}: photo uploaded + DB updated")


                except Exception as e:
                    total_errors += 1
                    logging.error(f"Error processing row {idx} on job page: {e}", exc_info=True)
                    continue
                seen_ids.add(remnant_id)
                supabase.table("remnants").update({
                    "last_seen_at": run_started_at,
                    "is_active": True,
                    "deleted_at": None
                }).eq("id", remnant_id).execute()

        logging.info("Sync complete")
        logging.info(f"Total file rows seen: {total_rows_seen}")
        logging.info(f"Rows with remnant id: {total_with_id}")
        logging.info(f"Metadata changed: {total_changed}")
        logging.info(f"Metadata no_change: {total_no_change}")
        logging.info(f"Photos downloaded: {total_photo_downloaded}")
        logging.info(f"Photos skipped (same hash): {total_photo_skipped_same_hash}")
        logging.info(f"Photos uploaded: {total_photo_uploaded}")
        logging.info(f"Errors: {total_errors}")

    finally:
        driver.quit()
        logging.info("Browser closed")
    
    res = supabase.rpc("reconcile_deletions", {"p_run_started_at": run_started_at}).execute()
    print(res.data)


if __name__ == "__main__":
    main()
