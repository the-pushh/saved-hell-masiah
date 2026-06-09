#!/usr/bin/env python3
"""
Loads reels.json and prints the caption from the reel page source.

Usage:
  python3 debug_media.py
"""

import asyncio
import html as html_lib
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

SESSION_FILE = Path("session.json")
REELS_FILE   = Path("reels.json")


async def main() -> None:
    if not REELS_FILE.exists():
        print("✗ reels.json not found — run scrapper.py first")
        return
    if not SESSION_FILE.exists():
        print("✗ session.json not found — run scrapper.py first to log in")
        return

    reels = json.loads(REELS_FILE.read_text())
    if not reels:
        print("✗ reels.json is empty")
        return

    first = reels[0]
    print(f"Fetching caption for: @{first['sender']}")
    print(f"Reel URL: {first['url']}\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        context = await browser.new_context(storage_state=str(SESSION_FILE))
        page    = await context.new_page()

        print("Opening reel page...")
        await page.goto(first["url"], wait_until="networkidle", timeout=30_000)
        await page.wait_for_timeout(2_000)

        html = await page.content()
        await browser.close()

    caption_match = re.search(
        r'<meta\s+property="og:description"\s+content="([^"]*)"', html
    )
    if caption_match:
        print("─── Caption (from og:description) ───")
        print(html_lib.unescape(caption_match.group(1)))
    else:
        print("✗ Caption not found in page source")


if __name__ == "__main__":
    asyncio.run(main())
