"""
Convenience entrypoint.

This module forwards to scrapers/remnant_scraper/sync_remnants.py so direct
script execution still works during local debugging.
"""

import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    # Allow running as: python scrapers/remnant_scraper/selenium_utils.py
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scrapers.remnant_scraper.sync_remnants import main


if __name__ == "__main__":
    main()
