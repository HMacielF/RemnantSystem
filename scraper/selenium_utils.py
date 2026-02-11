"""
Backward-compatible entrypoint.

The implementation now lives in scraper/sync_remnants.py.
"""

import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    # Allow running as: python scraper/selenium_utils.py
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from scraper.sync_remnants import main


if __name__ == "__main__":
    main()
