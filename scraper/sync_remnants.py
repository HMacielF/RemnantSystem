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


VALID_STATUSES = {"available", "hold", "sold"}


def normalize_status(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized == "on hold":
        return "hold"
    if normalized in VALID_STATUSES:
        return normalized
    return "available"


def get_first_row(data):
    if isinstance(data, list):
        return data[0] if data else None
    if isinstance(data, dict):
        return data
    return None


def get_or_create_lookup_id(supabase, table_name: str, name: str) -> int:
    cleaned_name = (name or "").strip() or "Other"
    existing = (
        supabase.table(table_name)
        .select("id,name")
        .ilike("name", cleaned_name)
        .limit(1)
        .execute()
    )
    existing_row = get_first_row(existing.data)
    if existing_row:
        return existing_row["id"]

    inserted = (
        supabase.table(table_name)
        .insert({"name": cleaned_name, "active": True})
        .execute()
    )
    inserted_row = get_first_row(inserted.data)
    if not inserted_row:
        raise RuntimeError(f"Failed to create {table_name} row for '{cleaned_name}'")
    return inserted_row["id"]


def build_storage_path(kind: str, identifier: int, ext: str) -> str:
    safe_ext = (ext or "jpg").strip().lower().lstrip(".") or "jpg"
    return f"remnant_{identifier}.{safe_ext}"


def resolve_company_id(supabase, settings) -> int:
    company_id_raw = os.getenv("MORAWARE_COMPANY_ID", "").strip()
    if company_id_raw:
        return int(company_id_raw)

    company_name = os.getenv("MORAWARE_COMPANY_NAME", "").strip() or "Quick Countertop"
    return get_or_create_lookup_id(supabase, "companies", company_name)


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
    company_id = resolve_company_id(supabase, settings)
    material_ids: dict[str, int] = {}
    thickness_ids: dict[str, int] = {}

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
    reconciliation_safe = False
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
            material = material_from_title or "Other"

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
                    normalized_status = normalize_status(remnant_status)
                    thickness = parse_thickness(description)
                    material_key = material.strip() or "Other"
                    thickness_key = thickness.strip() or "Other"
                    material_id = material_ids.get(material_key)
                    if material_id is None:
                        material_id = get_or_create_lookup_id(supabase, "materials", material_key)
                        material_ids[material_key] = material_id
                    thickness_id = thickness_ids.get(thickness_key)
                    if thickness_id is None:
                        thickness_id = get_or_create_lookup_id(supabase, "thicknesses", thickness_key)
                        thickness_ids[thickness_key] = thickness_id

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
                        f"Size {width}x{height} | L-shape={bool(l_shape)} | Status={normalized_status}"
                    )

                    existing = (
                        supabase.table("remnants")
                        .select(
                            "id,company_id,material_id,thickness_id,name,width,height,l_shape,l_width,l_height,status,"
                            "source_image_url,deleted_at,last_seen_at,photo_hash,image,image_path"
                        )
                        .eq("moraware_remnant_id", remnant_id)
                        .limit(1)
                        .execute()
                    )
                    existing_row = get_first_row(existing.data)

                    base_payload = {
                        "moraware_remnant_id": remnant_id,
                        "company_id": company_id,
                        "material_id": material_id,
                        "thickness_id": thickness_id,
                        "name": name,
                        "width": width,
                        "height": height,
                        "l_shape": bool(l_shape),
                        "l_width": l_width,
                        "l_height": l_height,
                        "status": normalized_status,
                        "hash": sha256_bytes(
                            "|".join(
                                [
                                    str(remnant_id),
                                    str(company_id),
                                    str(material_id),
                                    str(thickness_id),
                                    name,
                                    str(width),
                                    str(height),
                                    str(bool(l_shape)),
                                    str(l_width),
                                    str(l_height),
                                    normalized_status,
                                    full_url,
                                ]
                            ).encode("utf-8")
                        ),
                        "source_image_url": full_url,
                        "last_seen_at": run_started_at,
                        "deleted_at": None,
                    }

                    if not existing_row:
                        inserted = supabase.table("remnants").insert(base_payload).execute()
                        if not get_first_row(inserted.data):
                            raise RuntimeError(f"Insert failed for Moraware remnant #{remnant_id}")
                        total_changed += 1
                        logging.info(f"Remnant #{remnant_id}: inserted")
                        existing_row = (
                            supabase.table("remnants")
                            .select("id,photo_hash,image,image_path")
                            .eq("moraware_remnant_id", remnant_id)
                            .limit(1)
                            .execute()
                        )
                        existing_row = get_first_row(existing_row.data) or {}
                    else:
                        metadata_changed = any(
                            [
                                existing_row.get("company_id") != company_id,
                                existing_row.get("material_id") != material_id,
                                existing_row.get("thickness_id") != thickness_id,
                                existing_row.get("name") != name,
                                existing_row.get("width") != width,
                                existing_row.get("height") != height,
                                bool(existing_row.get("l_shape")) != bool(l_shape),
                                existing_row.get("l_width") != l_width,
                                existing_row.get("l_height") != l_height,
                                normalize_status(existing_row.get("status")) != normalized_status,
                                existing_row.get("source_image_url") != full_url,
                                existing_row.get("deleted_at") is not None,
                            ]
                        )
                        supabase.table("remnants").update(base_payload).eq(
                            "moraware_remnant_id", remnant_id
                        ).execute()
                        if metadata_changed:
                            total_changed += 1
                            logging.info(f"Remnant #{remnant_id}: metadata updated")
                        else:
                            total_no_change += 1
                            logging.info(
                                f"Remnant #{remnant_id}: metadata unchanged, checking photo hash anyway"
                            )

                    logging.info(f"Remnant #{remnant_id}: downloading image bytes")
                    img_resp = sess.get(full_url, timeout=30)
                    img_resp.raise_for_status()
                    img_bytes = img_resp.content
                    total_photo_downloaded += 1

                    new_photo_hash = sha256_bytes(img_bytes)
                    logging.info(f"Remnant #{remnant_id}: photo_hash={new_photo_hash[:12]}...")

                    existing_hash = existing_row.get("photo_hash")
                    existing_image = existing_row.get("image")
                    existing_image_path = existing_row.get("image_path")

                    if existing_hash == new_photo_hash and existing_image:
                        total_photo_skipped_same_hash += 1
                        logging.info(f"Remnant #{remnant_id}: photo unchanged, skipping upload")
                        continue

                    content_type = (img_resp.headers.get("Content-Type") or "").split(";")[0].strip()
                    ext = infer_extension(full_url, content_type)
                    image_path = build_storage_path("remnant", remnant_id, ext)

                    logging.info(
                        f"Remnant #{remnant_id}: uploading to bucket='{settings.supabase_bucket}' "
                        f"as '{image_path}' content_type='{content_type or 'image/jpeg'}'"
                    )

                    supabase.storage.from_(settings.supabase_bucket).upload(
                        image_path,
                        img_bytes,
                        {"content-type": content_type or "image/jpeg", "upsert": "true"},
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
                    ).eq("moraware_remnant_id", remnant_id).execute()

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
        reconciliation_safe = total_errors == 0 and len(issues) == 0

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

    if crawl_completed_successfully and reconciliation_safe:
        reconciliation = (
            supabase.table("remnants")
            .update({"deleted_at": now_iso_utc()})
            .eq("company_id", company_id)
            .filter("moraware_remnant_id", "not.is", "null")
            .lt("last_seen_at", run_started_at)
            .filter("deleted_at", "is", "null")
            .execute()
        )
        logging.info(
            "Soft-deleted stale Moraware remnants: %s",
            len(reconciliation.data or []) if isinstance(reconciliation.data, list) else 0,
        )
    elif crawl_completed_successfully:
        logging.warning(
            "Skipped deletion reconciliation because the crawl had row-level issues or errors."
        )
    else:
        logging.warning("Skipped reconcile_deletions because crawl did not complete successfully.")


if __name__ == "__main__":
    main()
