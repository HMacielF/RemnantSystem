import logging
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from supabase import create_client

if __package__ is None or __package__ == "":
    # Allow running as: python scraper/sync_remnants.py
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from scraper.config import load_settings
from scraper.parsing import get_page_material_and_name, parse_line, parse_thickness
from scraper.utils import infer_extension, now_iso_utc, requests_session_from_selenium, sha256_bytes

# ---------- Logging ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


def main():
    settings = load_settings()
    supabase = create_client(settings.supabase_url, settings.supabase_key)

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
    crawl_completed_successfully = False

    try:
        logging.info("Starting Moraware -> Supabase sync")

        # ---- Login ----
        driver.get(settings.moraware_url)
        wait = WebDriverWait(driver, 15)

        wait.until(EC.visibility_of_element_located((By.ID, "loginform")))
        driver.find_element(By.ID, "user").send_keys(settings.moraware_user)
        driver.find_element(By.ID, "pwd").send_keys(settings.moraware_pass)
        driver.find_element(By.ID, "LOGIN").click()

        wait.until(EC.url_contains("/sys/"))
        logging.info("Logged into Moraware successfully")

        # Go back to the job list URL (handles redirects)
        driver.get(settings.moraware_url)

        # ---- Collect job URLs ----
        job_urls = []
        page_num = 1

        while True:
            WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "Jobs_1Body")))
            rows = driver.find_elements(By.CSS_SELECTOR, "#Jobs_1Body tr")

            added_this_page = 0
            for i, row in enumerate(rows):
                if i == 0:
                    continue
                tds = row.find_elements(By.TAG_NAME, "td")
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
                        and d.find_elements(By.CSS_SELECTOR, "#Jobs_1Body tr a")[0].get_attribute("href")
                        != first_href
                    )
                )
                page_num += 1
                time.sleep(0.5)
            except Exception:
                break

        # De-dupe while preserving order
        seen = set()
        job_urls = [url for url in job_urls if not (url in seen or seen.add(url))]

        logging.info(f"Collected {len(job_urls)} total job pages")

        # ---- Process each job page ----
        for job_i, job_url in enumerate(job_urls, start=1):
            logging.info(f"[{job_i}/{len(job_urls)}] Processing job page: {job_url}")

            driver.get(job_url)

            try:
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.ID, "FilesScroll1Body"))
                )
            except Exception:
                logging.warning("No files table found (FilesScroll1Body). Skipping job page.")
                continue

            sess = requests_session_from_selenium(driver)
            material_from_title, name_from_title = get_page_material_and_name(driver.title or "")
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
                        logging.warning(
                            f"Remnant #{m_id.group(1)}: could not parse size from '{description}'"
                        )
                        continue

                    remnant_id, width, height, l_shape, l_width, l_height, remnant_status = size_parsed
                    thickness = parse_thickness(description)

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
                        f"Size {width}x{height} | L-shape={bool(l_shape)} | Status={remnant_status}"
                    )

                    rpc_payload = {
                        "p_id": remnant_id,
                        "p_name": name,
                        "p_material": material,
                        "p_status": remnant_status,
                        "p_width": width,
                        "p_height": height,
                        "p_thickness": thickness,
                        "p_l_shape": bool(l_shape),
                        "p_l_width": l_width,
                        "p_l_height": l_height,
                        "p_source_image_url": full_url,
                    }

                    rpc_res = supabase.rpc("sync_remnant", rpc_payload).execute()
                    sync_status = (rpc_res.data[0]["sync_status"] if rpc_res.data else "no_change")

                    # Mark as seen for this run regardless of whether metadata/photo changed.
                    supabase.table("remnants").update(
                        {
                            "last_seen_at": run_started_at,
                            "is_active": True,
                            "deleted_at": None,
                            "updated_at": now_iso_utc(),
                        }
                    ).eq("id", remnant_id).execute()

                    if sync_status == "changed":
                        total_changed += 1
                        logging.info(f"Remnant #{remnant_id}: metadata changed (insert/update)")
                    else:
                        total_no_change += 1
                        logging.info(f"Remnant #{remnant_id}: no metadata change, skipping photo")
                        continue

                    logging.info(f"Remnant #{remnant_id}: downloading image bytes")
                    img_resp = sess.get(full_url, timeout=30)
                    img_resp.raise_for_status()
                    img_bytes = img_resp.content
                    total_photo_downloaded += 1

                    new_photo_hash = sha256_bytes(img_bytes)
                    logging.info(f"Remnant #{remnant_id}: photo_hash={new_photo_hash[:12]}...")

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

                    content_type = img_resp.headers.get("Content-Type", "")
                    ext = infer_extension(full_url, content_type)
                    image_path = f"{remnant_id}_{new_photo_hash}.{ext}"

                    logging.info(
                        f"Remnant #{remnant_id}: uploading to bucket='{settings.supabase_bucket}' "
                        f"as '{image_path}' content_type='{content_type}'"
                    )

                    supabase.storage.from_(settings.supabase_bucket).upload(
                        image_path,
                        img_bytes,
                        {"content-type": content_type, "upsert": "true"},
                    )
                    total_photo_uploaded += 1

                    public_url = supabase.storage.from_(settings.supabase_bucket).get_public_url(image_path)
                    supabase.table("remnants").update(
                        {
                            "photo_hash": new_photo_hash,
                            "image_path": image_path,
                            "image": public_url,
                            "photo_synced_at": now_iso_utc(),
                            "updated_at": now_iso_utc(),
                        }
                    ).eq("id", remnant_id).execute()

                    logging.info(f"Remnant #{remnant_id}: photo uploaded + DB updated")

                except Exception as exc:
                    total_errors += 1
                    logging.error(f"Error processing row {idx} on job page: {exc}", exc_info=True)
                    continue

        logging.info("Sync complete")
        logging.info(f"Total file rows seen: {total_rows_seen}")
        logging.info(f"Rows with remnant id: {total_with_id}")
        logging.info(f"Metadata changed: {total_changed}")
        logging.info(f"Metadata no_change: {total_no_change}")
        logging.info(f"Photos downloaded: {total_photo_downloaded}")
        logging.info(f"Photos skipped (same hash): {total_photo_skipped_same_hash}")
        logging.info(f"Photos uploaded: {total_photo_uploaded}")
        logging.info(f"Errors: {total_errors}")
        crawl_completed_successfully = True

    except Exception:
        total_errors += 1
        logging.exception("Fatal sync failure; skipping deletion reconciliation for safety.")

    finally:
        driver.quit()
        logging.info("Browser closed")

    if crawl_completed_successfully:
        res = supabase.rpc("reconcile_deletions", {"p_run_started_at": run_started_at}).execute()
        print(res.data)
    else:
        logging.warning("Skipped reconcile_deletions because crawl did not complete successfully.")


if __name__ == "__main__":
    main()
