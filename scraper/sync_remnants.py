import logging
import json
import re
import os
import shutil
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import SessionNotCreatedException
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


def update_job_desc_with_remnant_ids(driver, wait, remnant_ids: list[int]) -> bool:
    """Update Moraware job notes with one `ID #<n>` line per remnant in this job."""
    if not remnant_ids:
        return False

    try:
        unique_ids = list(dict.fromkeys(remnant_ids))
        id_lines = [f"ID #{remnant_id}" for remnant_id in unique_ids]

        edit_btn = wait.until(EC.element_to_be_clickable((By.ID, "btnEditJobHeader")))
        driver.execute_script("arguments[0].click();", edit_btn)

        job_desc = wait.until(EC.visibility_of_element_located((By.NAME, "jobDesc")))
        current_desc = job_desc.get_attribute("value") or ""

        kept_lines = []
        for line in current_desc.splitlines():
            if re.match(r"^\s*ID\s*#\d+\s*$", line):
                continue
            kept_lines.append(line)

        while kept_lines and not kept_lines[-1].strip():
            kept_lines.pop()

        if kept_lines:
            new_desc = "\n".join(kept_lines + [""] + id_lines)
        else:
            new_desc = "\n".join(id_lines)

        if new_desc == current_desc:
            logging.info("Job notes already contain current remnant ID list")
            return False

        driver.execute_script(
            """
            const el = arguments[0];
            const value = arguments[1];
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            job_desc,
            new_desc,
        )

        saved_via_function = driver.execute_script(
            """
            const saveFns = [
                'SubmitEditJobHeader',
                'submitEditJobHeader',
                'SaveEditJobHeader',
                'saveEditJobHeader',
                'SaveJobHeader',
                'saveJobHeader'
            ];
            for (const fnName of saveFns) {
                if (typeof window[fnName] === 'function') {
                    window[fnName]();
                    return true;
                }
                if (window.parent && typeof window.parent[fnName] === 'function') {
                    window.parent[fnName]();
                    return true;
                }
                if (window.top && typeof window.top[fnName] === 'function') {
                    window.top[fnName]();
                    return true;
                }
            }
            return false;
            """
        )

        saved = bool(saved_via_function)
        if not saved:
            # First fallback: submit the nearest form from the textarea.
            submitted_form = driver.execute_script(
                """
                const el = arguments[0];
                const form = el && el.closest ? el.closest('form') : null;
                if (form) {
                    if (typeof form.requestSubmit === 'function') {
                        form.requestSubmit();
                    } else {
                        form.submit();
                    }
                    return true;
                }
                return false;
                """,
                job_desc,
            )
            saved = bool(submitted_form)

        if not saved:
            # Second fallback: click visible Save/OK/Update controls.
            fallback_selectors = [
                "#btnSaveJobHeader",
                "button[onclick*='SaveEditJobHeader']",
                "button[onclick*='SaveJobHeader']",
                "input[onclick*='SaveEditJobHeader']",
                "input[onclick*='SaveJobHeader']",
                "button",
                "input[type='submit']",
                "input[type='button']",
            ]
            for selector in fallback_selectors:
                controls = driver.find_elements(By.CSS_SELECTOR, selector)
                if not controls:
                    continue
                for control in controls:
                    if not (control.is_displayed() and control.is_enabled()):
                        continue
                    label = (
                        (control.text or "").strip()
                        or (control.get_attribute("value") or "").strip()
                        or (control.get_attribute("title") or "").strip()
                        or (control.get_attribute("aria-label") or "").strip()
                    )
                    if not label:
                        onclick = (control.get_attribute("onclick") or "").lower()
                        if "save" not in onclick and "ok" not in onclick and "update" not in onclick:
                            continue
                    elif not re.search(r"(save|ok|update|done)", label, re.IGNORECASE):
                        continue
                    driver.execute_script("arguments[0].click();", control)
                    saved = True
                    break
                if saved:
                    break

        if not saved:
            logging.warning("Updated jobDesc in dialog, but could not confirm save action.")

        time.sleep(0.5)
        logging.info(f"Updated job notes with remnant IDs: {', '.join(map(str, unique_ids))}")
        return True

    except Exception as exc:
        logging.warning(f"Could not update job notes with remnant IDs: {exc}")
        return False


def main():
    settings = load_settings()
    supabase = create_client(settings.supabase_url, settings.supabase_key)

    headless_enabled = os.getenv("MORAWARE_HEADLESS", "true").lower() in {"1", "true", "yes"}
    running_in_ci = os.getenv("CI", "").lower() == "true" or os.getenv("GITHUB_ACTIONS") == "true"

    def build_options(headless_arg: str | None) -> Options:
        opts = Options()
        if headless_arg:
            opts.add_argument(headless_arg)
        if running_in_ci:
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
            opts.add_argument("--disable-gpu")
            opts.add_argument("--disable-software-rasterizer")
            opts.add_argument("--remote-debugging-port=9222")
            opts.add_argument("--window-size=1920,1080")
            opts.add_argument("--user-data-dir=/tmp/chrome-user-data")

            chrome_path = (
                os.getenv("CHROME_PATH")
                or os.getenv("CHROME_BIN")
                or shutil.which("google-chrome")
                or shutil.which("chrome")
                or shutil.which("chromium-browser")
            )
            if chrome_path:
                opts.binary_location = chrome_path
        return opts

    if headless_enabled:
        try:
            driver = webdriver.Chrome(options=build_options("--headless=new"))
        except SessionNotCreatedException:
            logging.warning("Chrome failed with --headless=new. Retrying with --headless fallback.")
            driver = webdriver.Chrome(options=build_options("--headless"))
    else:
        driver = webdriver.Chrome(options=build_options(None))

    total_rows_seen = 0
    total_with_id = 0
    total_changed = 0
    total_no_change = 0
    total_photo_downloaded = 0
    total_photo_skipped_same_hash = 0
    total_photo_uploaded = 0
    total_errors = 0
    issues = []

    run_started_at = datetime.now(timezone.utc).isoformat()
    crawl_completed_successfully = False

    def record_issue(kind: str, job_url: str | None = None, remnant_id: int | None = None, details: str = ""):
        issues.append(
            {
                "kind": kind,
                "job_url": job_url,
                "remnant_id": remnant_id,
                "details": details,
            }
        )

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
        collect_started = time.monotonic()

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
                if settings.page_delay_sec > 0:
                    time.sleep(settings.page_delay_sec)
            except Exception:
                break

        # De-dupe while preserving order
        seen = set()
        job_urls = [url for url in job_urls if not (url in seen or seen.add(url))]

        logging.info(f"Collected {len(job_urls)} total job pages")
        logging.info(f"Job URL collection took {time.monotonic() - collect_started:.1f}s")

        # ---- Process each job page ----
        for job_i, job_url in enumerate(job_urls, start=1):
            logging.info(f"[{job_i}/{len(job_urls)}] Processing job page: {job_url}")

            driver.get(job_url)
            remnant_ids_for_job = []

            try:
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.ID, "FilesScroll1Body"))
                )
            except Exception:
                logging.warning("No files table found (FilesScroll1Body). Skipping job page.")
                record_issue("missing_files_table", job_url=job_url)
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

                    remnant_id_from_desc = int(m_id.group(1))
                    remnant_ids_for_job.append(remnant_id_from_desc)
                    total_with_id += 1

                    size_parsed = parse_line(description)
                    if not size_parsed:
                        logging.warning(
                            f"Remnant #{m_id.group(1)}: could not parse size from '{description}'"
                        )
                        record_issue(
                            "parse_size_failed",
                            job_url=job_url,
                            remnant_id=remnant_id_from_desc,
                            details=description,
                        )
                        continue

                    remnant_id, width, height, l_shape, l_width, l_height, remnant_status = size_parsed
                    thickness = parse_thickness(description)

                    download_links = tds[1].find_elements(By.TAG_NAME, "a")
                    if not download_links:
                        logging.warning(f"Remnant #{remnant_id}: no download link found")
                        record_issue("missing_download_link", job_url=job_url, remnant_id=remnant_id)
                        continue

                    download_href = download_links[0].get_attribute("href")
                    if not download_href:
                        logging.warning(f"Remnant #{remnant_id}: download href was empty")
                        record_issue("empty_download_href", job_url=job_url, remnant_id=remnant_id)
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
                    record_issue(
                        "row_exception",
                        job_url=job_url,
                        details=f"row={idx} error={exc}",
                    )
                    continue

            update_job_desc_with_remnant_ids(driver, wait, remnant_ids_for_job)

        logging.info("Sync complete")
        logging.info(f"Total file rows seen: {total_rows_seen}")
        logging.info(f"Rows with remnant id: {total_with_id}")
        logging.info(f"Metadata changed: {total_changed}")
        logging.info(f"Metadata no_change: {total_no_change}")
        logging.info(f"Photos downloaded: {total_photo_downloaded}")
        logging.info(f"Photos skipped (same hash): {total_photo_skipped_same_hash}")
        logging.info(f"Photos uploaded: {total_photo_uploaded}")
        logging.info(f"Errors: {total_errors}")
        if issues:
            kind_counts = Counter(i["kind"] for i in issues)
            logging.info("Issue summary by type:")
            for kind, count in kind_counts.most_common():
                logging.info(f"  - {kind}: {count}")
        else:
            logging.info("Issue summary: no issues recorded.")
        crawl_completed_successfully = True

    except Exception:
        total_errors += 1
        logging.exception("Fatal sync failure; skipping deletion reconciliation for safety.")

    finally:
        driver.quit()
        logging.info("Browser closed")

    report_path = Path(__file__).resolve().parent / "last_sync_issues.json"
    try:
        report_path.write_text(
            json.dumps(
                {
                    "run_started_at": run_started_at,
                    "crawl_completed_successfully": crawl_completed_successfully,
                    "total_errors": total_errors,
                    "issue_count": len(issues),
                    "issues": issues,
                },
                indent=2,
            )
        )
        logging.info(f"Wrote issue report: {report_path}")
    except Exception as exc:
        logging.warning(f"Could not write issue report: {exc}")

    if crawl_completed_successfully:
        res = supabase.rpc("reconcile_deletions", {"p_run_started_at": run_started_at}).execute()
        print(res.data)
    else:
        logging.warning("Skipped reconcile_deletions because crawl did not complete successfully.")


if __name__ == "__main__":
    main()
