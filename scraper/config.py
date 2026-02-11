import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    moraware_url: str
    moraware_user: str
    moraware_pass: str
    supabase_url: str
    supabase_key: str
    supabase_bucket: str
    page_delay_sec: float


def load_settings() -> Settings:
    load_dotenv()

    settings = Settings(
        moraware_url=os.getenv("MORAWARE_URL", ""),
        moraware_user=os.getenv("MORAWARE_USER", ""),
        moraware_pass=os.getenv("MORAWARE_PASS", ""),
        supabase_url=os.getenv("SUPABASE_URL", ""),
        supabase_key=os.getenv("SUPABASE_KEY", ""),
        supabase_bucket=os.getenv("SUPABASE_BUCKET", "remnant-images"),
        page_delay_sec=float(os.getenv("MORAWARE_PAGE_DELAY_SEC", "0.15")),
    )

    if not all(
        [
            settings.moraware_url,
            settings.moraware_user,
            settings.moraware_pass,
            settings.supabase_url,
            settings.supabase_key,
        ]
    ):
        raise RuntimeError(
            "Missing required env vars. Check .env for Moraware + Supabase values."
        )

    return settings
