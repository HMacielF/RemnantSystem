from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import Client, create_client


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class SupplierRef:
    id: int
    name: str


def create_supabase_client() -> Client:
    load_dotenv()
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.getenv("SUPABASE_KEY", "").strip()
    )
    if not supabase_url:
        raise RuntimeError("SUPABASE_URL is required for scraper run tracking")
    if not supabase_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for scraper run tracking")
    return create_client(supabase_url, supabase_key)


def get_or_create_supplier(
    supabase: Client,
    supplier_name: str,
    website_url: str | None = None,
) -> SupplierRef:
    response = (
        supabase.table("suppliers")
        .upsert(
            {
                "name": supplier_name,
                "website_url": website_url,
                "active": True,
            },
            on_conflict="name",
        )
        .execute()
    )
    if response.data:
        row = response.data[0]
        return SupplierRef(id=int(row["id"]), name=row["name"])

    lookup = (
        supabase.table("suppliers")
        .select("id,name")
        .eq("name", supplier_name)
        .limit(1)
        .execute()
    )
    if not lookup.data:
        raise RuntimeError(f"Unable to resolve supplier id for {supplier_name}")

    row = lookup.data[0]
    return SupplierRef(id=int(row["id"]), name=row["name"])


def start_scrape_run(
    supabase: Client,
    supplier_id: int,
    importer_key: str,
    source_path: str | None = None,
    notes: dict | None = None,
) -> tuple[int, str]:
    started_at = now_iso_utc()
    response = (
        supabase.table("slab_scrape_runs")
        .insert(
            {
                "supplier_id": supplier_id,
                "importer_key": importer_key,
                "source_path": source_path,
                "status": "running",
                "started_at": started_at,
                "notes": notes or {},
            }
        )
        .execute()
    )
    if not response.data:
        raise RuntimeError("Unable to create slab scrape run")

    row = response.data[0]
    return int(row["id"]), row.get("started_at") or started_at


def finalize_scrape_run(
    supabase: Client,
    run_id: int,
    *,
    status: str = "completed",
    seen_count: int = 0,
    inserted_count: int = 0,
    updated_count: int = 0,
    deactivated_count: int = 0,
    notes: dict | None = None,
) -> None:
    (
        supabase.table("slab_scrape_runs")
        .update(
            {
                "status": status,
                "completed_at": now_iso_utc(),
                "seen_count": seen_count,
                "inserted_count": inserted_count,
                "updated_count": updated_count,
                "deactivated_count": deactivated_count,
                "notes": notes or {},
            }
        )
        .eq("id", run_id)
        .execute()
    )
