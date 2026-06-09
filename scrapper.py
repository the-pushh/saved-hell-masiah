#!/usr/bin/env python3
"""
Instagram DM Reel Scraper — Playwright edition

PLAYWRIGHT IN ONE PARAGRAPH:
  Playwright is a browser automation library. It launches a real Chromium
  browser process and gives you a Python API to control it: navigate to URLs,
  click buttons, scroll, fill forms, run JavaScript, and intercept every
  network request/response the browser makes. We use that last capability —
  instead of reverse-engineering Instagram's private API and managing auth
  tokens manually, we let Instagram's own frontend run in the browser and
  fire its own API calls. We just listen to the responses.

WHY THIS IS BETTER THAN RAW HTTP REQUESTS:
  - No manual token extraction (fb_dtsg, lsd, doc_id, etc.)
  - No token expiry problems — the browser session handles renewals
  - No header mismatches — the real browser sends exactly what Instagram expects
  - No doc_id rot — we intercept whatever query the frontend fires
  - Session persists across runs via session.json

FLOW:
  First run  → browser opens visibly → you log in manually → session.json saved
  Later runs → session.json loaded → browser opens headlessly* → thread scraped
               (*headless = no visible window, runs in background)

SETUP:
  pip install playwright python-dotenv
  playwright install chromium   # downloads Chromium binary (~150 MB), one-time only

.env needs only ONE value:
  THREAD_URL=https://www.instagram.com/direct/t/<thread_id>/
"""

import asyncio
import json
import os
import html
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# async_playwright is the entry point for the Playwright async API.
# All Playwright operations are async because browser I/O is inherently
# non-blocking — "await" lets Python do other work while waiting for
# the browser to respond.
from playwright.async_api import async_playwright

load_dotenv()

THREAD_URL   = os.environ.get("THREAD_URL", "")
SESSION_FILE = Path("session.json")  # persisted browser auth state
OUTPUT_FILE  = "reel_feed.html"


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — RESPONSE PARSING
#
# Instagram's GraphQL responses contain a list of message edges. Each edge is
# one message. We filter for edges that represent shared reels/stories by
# checking item_type, then pull out the URL, thumbnail, caption, sender, and
# timestamp from the XMA (cross-media attachment) payload.
#
# Instagram has changed this response shape several times, so we try multiple
# known paths before giving up.
# ─────────────────────────────────────────────────────────────────────────────

def extract_reels_from_response(data: dict) -> list[dict]:
    reels = []
    d = data.get("data", {})

    # Try known paths to the messages edge list in order.
    # fetch__SlideThread is the current (2025) shape.
    messages_node = None
    for getter in [
        lambda: d["fetch__SlideThread"]["as_ig_direct_thread"]["slide_messages"],
        lambda: d["fetch__SlideThread"]["as_ig_direct_thread"]["messages"],
        lambda: d["xdt_message_thread"]["messages"],
        lambda: d["message_thread"]["messages"],
        lambda: d["thread"]["messages"],
        lambda: d["get_slide_thread_nullable"]["as_ig_direct_thread"]["slide_messages"],
    ]:
        try:
            messages_node = getter()
            break
        except (KeyError, TypeError):
            continue

    if not messages_node:
        return reels

    # GraphQL paginates as edges[].node — each node is one message.
    for edge in messages_node.get("edges", []):
        node = edge.get("node", {})

        # XMA (cross-media attachment) is the payload for shared reels/stories.
        # It lives under node.content.xma in the current fetch__SlideThread shape.
        xma = node.get("xma") or (node.get("content") or {}).get("xma") or {}

        # target_url is the instagram.com/reel/... link — the only field we truly need.
        # If it's missing this is a text message, image, reaction, etc. — skip it.
        target_url = xma.get("target_url") or xma.get("url") or ""
        if not target_url:
            continue

        # preview_image.url is the CDN thumbnail. Nice to have, not critical.
        preview   = xma.get("preview_image") or xma.get("xmaPreviewImage") or {}
        thumb_url = (preview.get("url") or "") if isinstance(preview, dict) else ""

        # header_title_text = username of whoever posted the reel (the reel author,
        # not necessarily who sent it in the DM). Most useful label for display.
        sender = xma.get("header_title_text") or xma.get("xmaHeaderTitle") or "unknown"

        # timestamp_ms is a string in this response shape ("1780941948017")
        ts_ms = int(node.get("timestamp_ms") or node.get("timestamp") or 0)
        ts    = datetime.fromtimestamp(ts_ms / (1000 if ts_ms > 1e10 else 1)).strftime("%b %d, %Y %H:%M") if ts_ms else ""

        reels.append({
            "url":       target_url,
            "thumbnail": thumb_url,
            "caption":   "",
            "sender":    sender,
            "timestamp": ts,
        })

    return reels


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — LOGIN (first run only)
#
# Playwright can't log in to Instagram automatically because Instagram uses
# CAPTCHA and 2FA. Instead we open a visible browser window and let you do it
# manually. Once logged in, we call storage_state() which serialises all
# cookies and localStorage into session.json. That file is everything the
# browser needs to prove it's you — loading it on the next run means no login.
# ─────────────────────────────────────────────────────────────────────────────

async def login_and_save_session(playwright) -> None:
    print("No saved session found. Opening browser for manual login...")

    # headless=False means a real visible window opens.
    # headless=True (default) runs the browser invisibly in the background.
    browser = await playwright.chromium.launch(headless=False)

    # BrowserContext is like an isolated browser profile — its own cookies,
    # localStorage, and cache, separate from other contexts or your real browser.
    # Think of it as an incognito window that we control programmatically.
    context = await browser.new_context()

    # A Page is a single browser tab.
    page = await context.new_page()

    await page.goto("https://www.instagram.com/accounts/login/")
    print("Please log in. You have 3 minutes.")

    # wait_for_url blocks (suspends this coroutine) until the current URL
    # matches the glob pattern. The ** wildcard matches any path.
    # This unblocks as soon as login redirects away from /accounts/login/.
    await page.wait_for_url("https://www.instagram.com/**", timeout=180_000)

    # Instagram sometimes routes through /challenge/ (suspicious login warning)
    # or /two_factor/ (2FA). Poll until we're past all of those.
    for _ in range(60):
        if "login" not in page.url and "challenge" not in page.url and "two_factor" not in page.url:
            break
        await page.wait_for_timeout(2_000)

    # Serialise the full browser auth state — cookies + localStorage — to disk.
    # This is the key operation: everything Instagram's frontend stores to
    # remember who you are gets saved here. Loading this file later = logged in.
    await context.storage_state(path=str(SESSION_FILE))
    print(f"✓ Session saved to {SESSION_FILE}. Future runs will skip login.")
    await browser.close()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — SCRAPE
#
# We load the saved session, navigate to the DM thread, and intercept every
# GraphQL response the browser fires as we scroll. Instagram paginates messages
# in batches of ~20. Each time we scroll to the top of the messages list,
# the frontend detects it and fires another GraphQL request for the next batch.
# Our interceptor catches those responses and extracts reels from each one.
# We stop when 4 consecutive scrolls produce no new reels.
# ─────────────────────────────────────────────────────────────────────────────

async def scrape_reels(playwright) -> list[dict]:
    all_reels : list[dict] = []
    seen_urls : set[str]   = set()  # deduplication — same reel can appear in multiple responses

    browser = await playwright.chromium.launch(headless=False)  # visible for easier debugging

    # storage_state= injects the saved cookies/localStorage into this context,
    # making the browser appear already logged in from Instagram's perspective.
    context = await browser.new_context(
        storage_state=str(SESSION_FILE),
        viewport={"width": 1280, "height": 900},
    )
    page = await context.new_page()

    print("Navigating to thread...")
    await page.goto(THREAD_URL, wait_until="domcontentloaded", timeout=30_000)

    # If session.json is expired, Instagram redirects to the login page.
    if "login" in page.url or "accounts" in page.url:
        await browser.close()
        SESSION_FILE.unlink(missing_ok=True)
        print("Session expired. Deleted session.json — re-run to log in again.")
        return []

    # Wait for the full page to settle — sidebar threads, inbox previews, etc.
    # all fire their own GraphQL requests on load. We wait here so those are
    # all done BEFORE we register our interceptor. That way we only catch
    # responses triggered by our own scrolling actions, not sidebar noise.
    print("Waiting for page to settle...")
    await page.wait_for_timeout(5_000)

    # ── RESPONSE INTERCEPTOR ─────────────────────────────────────────────────
    #
    # Registered AFTER the 5s page-settle wait, so sidebar/inbox requests that
    # fire on initial load are already done. Any response we catch from here on
    # is triggered by our own scroll actions on this specific thread.
    #
    # We only filter by URL (api/graphql). The query name filter was removed —
    # Instagram changes query names across deploys, and the page-settle timing
    # already handles sidebar noise. extract_reels_from_response() returns []
    # for any response that isn't a thread message list, so non-reel GraphQL
    # calls (profile fetches, story loads, etc.) are silently skipped.
    #
    # response.request gives us the outgoing request that produced this response,
    # so we can check metadata without making a second network call.
    # ─────────────────────────────────────────────────────────────────────────
    async def on_response(response) -> None:
        if "api/graphql" not in response.url:
            return

        try:
            body = await response.text()

            if body.startswith("for (;;);"):
                body = body[len("for (;;);"):]

            data = json.loads(body)
            d    = data.get("data", {})


            reels = extract_reels_from_response(data)
            for r in reels:
                if r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    all_reels.append(r)
                    print(f"    + {r['sender']}  {r['timestamp']}")
        except Exception:
            pass

    # IMPORTANT: this handler runs concurrently with the scroll loop below.
    # While the loop is suspended at each `await wait_for_timeout`, the browser
    # is still receiving responses and this handler fires. Async means both
    # make progress without blocking each other.
    page.on("response", on_response)

    # ── SCROLL LOOP ───────────────────────────────────────────────────────────
    #
    # Instagram's DM thread is a virtualised scrollable list. Older messages
    # aren't in the DOM yet — they load dynamically as you scroll up.
    # Each upward scroll triggers the frontend to call the GraphQL API for the
    # next page, which our interceptor catches.
    #
    # We use page.mouse.wheel() to simulate the user physically scrolling up.
    # This is more reliable than manipulating scrollTop in JS because:
    #   - It doesn't require finding a specific DOM element
    #   - It targets whatever is under the cursor (the messages list)
    #   - Instagram's virtualised list responds to real wheel events
    #
    # We first click the centre of the page to ensure the messages area has
    # keyboard/scroll focus, then wheel upward in large increments.
    #
    # We stop when 4 consecutive scroll rounds yield no new reels.
    # ─────────────────────────────────────────────────────────────────────────
    print("Scrolling through thread to load all messages...")

    # Click centre of viewport to give the messages list focus
    vp = page.viewport_size or {"width": 1280, "height": 900}
    cx, cy = vp["width"] // 2, vp["height"] // 2
    await page.mouse.click(cx, cy)
    await page.wait_for_timeout(500)

    no_change  = 0
    prev_count = 0

    while no_change < 4:
        # Wheel upward — negative deltaY = scroll up.
        # We do several small wheel events rather than one huge one so
        # Instagram's scroll listener fires incrementally, matching real user behaviour.
        for _ in range(6):
            await page.mouse.wheel(0, -800)
            await page.wait_for_timeout(200)

        # Give Instagram time to detect the scroll position, fire the GraphQL
        # request, and for our on_response handler to process the response.
        await page.wait_for_timeout(2_500)

        if len(all_reels) == prev_count:
            no_change += 1   # this round produced nothing new
        else:
            no_change  = 0   # found something — reset and keep scrolling
            prev_count = len(all_reels)

        print(f"  {len(all_reels)} reels collected so far...")

    await browser.close()
    return all_reels


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — HTML OUTPUT
#
# Generates a self-contained dark-mode HTML file with:
#   - Responsive card grid with thumbnails (9:16 aspect ratio)
#   - Table view toggle
#   - Live search/filter by caption or sender
#   - Direct links to each reel on Instagram
# All CSS and JS is inline — no external dependencies at view time.
# ─────────────────────────────────────────────────────────────────────────────

def build_html(reels: list[dict]) -> str:
    count = len(reels)
    now   = datetime.now().strftime("%b %d, %Y at %H:%M")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reel Feed</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  body {{
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    background: #fff;
    color: #37352f;
    min-height: 100vh;
  }}

  /* ── PAGE LAYOUT ── */
  .page {{
    max-width: 900px;
    margin: 0 auto;
    padding: 60px 96px 120px;
  }}

  /* ── PAGE TITLE ── */
  .page-icon {{ font-size: 56px; line-height: 1; margin-bottom: 12px; }}
  .page-title {{
    font-size: 40px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #37352f;
    margin-bottom: 4px;
    line-height: 1.2;
  }}
  .page-meta {{
    font-size: 13px;
    color: #9b9a97;
    margin-bottom: 32px;
  }}

  /* ── TOOLBAR ── */
  .toolbar {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    padding: 2px 0;
  }}
  .search-wrap {{
    position: relative;
    flex: 1;
    max-width: 280px;
  }}
  .search-wrap svg {{
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: #9b9a97;
    pointer-events: none;
  }}
  .search-wrap input {{
    width: 100%;
    padding: 5px 10px 5px 30px;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
    color: #37352f;
    background: transparent;
    outline: none;
    transition: background 0.15s, border-color 0.15s;
  }}
  .search-wrap input:hover {{ background: #f1f0ee; }}
  .search-wrap input:focus {{ background: #fff; border-color: #d3d1cb; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
  .search-wrap input::placeholder {{ color: #9b9a97; }}

  .view-btns {{ display: flex; gap: 2px; margin-left: auto; }}
  .view-btn {{
    display: flex; align-items: center; gap: 5px;
    padding: 4px 8px;
    border: none; border-radius: 4px;
    font-size: 13px; font-family: inherit;
    color: #9b9a97; background: transparent;
    cursor: pointer; transition: background 0.1s, color 0.1s;
  }}
  .view-btn:hover {{ background: #f1f0ee; color: #37352f; }}
  .view-btn.active {{ background: #f1f0ee; color: #37352f; font-weight: 500; }}

  .count-badge {{
    font-size: 12px;
    color: #9b9a97;
    padding: 0 8px;
  }}

  /* ── DATABASE HEADER ── */
  .db-header {{
    display: grid;
    grid-template-columns: 1fr 160px 140px;
    padding: 0 8px;
    border-bottom: 1px solid #e9e9e7;
    margin-bottom: 0;
  }}
  .db-header-cell {{
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 500;
    color: #9b9a97;
    user-select: none;
  }}

  /* ── LIST VIEW (default) ── */
  #list-view {{ display: block; }}
  #grid-view  {{ display: none; }}

  .db-row {{
    display: grid;
    grid-template-columns: 1fr 160px 140px;
    align-items: center;
    padding: 0 8px;
    border-radius: 4px;
    transition: background 0.08s;
    cursor: pointer;
  }}
  .db-row:hover {{ background: #f7f6f3; }}
  .db-row.hidden {{ display: none; }}

  .db-cell {{
    padding: 7px 8px;
    font-size: 14px;
    color: #37352f;
    min-width: 0;
    overflow: hidden;
  }}

  /* Name cell — thumbnail icon + username */
  .name-cell {{
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .row-thumb {{
    width: 28px; height: 28px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    background: #e9e9e7;
  }}
  .row-icon {{
    width: 28px; height: 28px;
    border-radius: 4px;
    background: #f1f0ee;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; flex-shrink: 0; color: #9b9a97;
  }}
  .row-title {{
    font-size: 14px;
    font-weight: 500;
    color: #37352f;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .row-title:hover {{ text-decoration: underline; }}

  /* Author tag */
  .tag {{
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    background: #f1f0ee;
    color: #37352f;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }}

  /* Date */
  .db-cell.date {{
    font-size: 13px;
    color: #9b9a97;
    white-space: nowrap;
  }}

  /* ── GRID VIEW ── */
  .grid-container {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    padding-top: 8px;
  }}
  .grid-card {{
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #e9e9e7;
    transition: box-shadow 0.15s;
    text-decoration: none;
    display: flex; flex-direction: column;
  }}
  .grid-card:hover {{ box-shadow: 0 2px 12px rgba(0,0,0,.1); }}
  .grid-card.hidden {{ display: none; }}
  .grid-thumb-wrap {{
    aspect-ratio: 9/16;
    overflow: hidden;
    background: #f1f0ee;
    position: relative;
  }}
  .grid-thumb {{
    width: 100%; height: 100%; object-fit: cover; display: block;
  }}
  .grid-no-thumb {{
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; color: #9b9a97;
  }}
  .grid-meta {{
    padding: 8px 10px;
    background: #fff;
  }}
  .grid-author {{
    font-size: 12px; font-weight: 500; color: #37352f;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }}
  .grid-date {{
    font-size: 11px; color: #9b9a97; margin-top: 2px;
  }}

  @media (max-width: 768px) {{
    .page {{ padding: 40px 24px 80px; }}
    .db-header, .db-row {{ grid-template-columns: 1fr 120px; }}
    .db-header-cell:last-child, .db-cell:last-child {{ display: none; }}
    .page-title {{ font-size: 28px; }}
  }}
</style>
</head>
<body>
<div class="page">

  <div class="page-icon">📲</div>
  <h1 class="page-title">Reel Feed</h1>
  <p class="page-meta">scraped {now}</p>

  <div class="toolbar">
    <div class="search-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input id="search" type="text" placeholder="Filter by author..." oninput="filterRows()">
    </div>
    <span class="count-badge" id="count-badge">{count} reels</span>
    <div class="view-btns">
      <button class="view-btn active" onclick="setView('list', this)" title="List view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        List
      </button>
      <button class="view-btn" onclick="setView('grid', this)" title="Grid view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Gallery
      </button>
    </div>
  </div>

  <!-- LIST VIEW -->
  <div id="list-view">
    <div class="db-header">
      <div class="db-header-cell">Name</div>
      <div class="db-header-cell">Author</div>
      <div class="db-header-cell">Date</div>
    </div>
    <div id="list-rows"></div>
  </div>

  <!-- GRID VIEW -->
  <div id="grid-view">
    <div class="grid-container" id="grid-cards"></div>
  </div>

</div>

<script>
const reels = {json.dumps(reels, ensure_ascii=False)};

// ── BUILD LIST ROWS ──────────────────────────────────────────────
const listRows = document.getElementById('list-rows');
reels.forEach((r, i) => {{
  const row = document.createElement('div');
  row.className = 'db-row';
  row.dataset.author = r.sender.toLowerCase();

  const thumb = r.thumbnail
    ? `<img class="row-thumb" src="${{r.thumbnail}}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{{className:'row-icon',textContent:'▶'}}))">`
    : `<div class="row-icon">▶</div>`;

  row.innerHTML = `
    <div class="db-cell">
      <div class="name-cell">
        ${{thumb}}
        <a class="row-title" href="${{r.url}}" target="_blank" rel="noopener">@${{r.sender}}</a>
      </div>
    </div>
    <div class="db-cell"><span class="tag">${{r.sender}}</span></div>
    <div class="db-cell date">${{r.timestamp}}</div>
  `;

  // clicking the row (not the link) also opens the reel
  row.addEventListener('click', e => {{
    if (e.target.tagName !== 'A') window.open(r.url, '_blank', 'noopener');
  }});

  listRows.appendChild(row);
}});

// ── BUILD GRID CARDS ─────────────────────────────────────────────
const gridCards = document.getElementById('grid-cards');
reels.forEach((r, i) => {{
  const card = document.createElement('a');
  card.className = 'grid-card';
  card.href = r.url;
  card.target = '_blank';
  card.rel = 'noopener';
  card.dataset.author = r.sender.toLowerCase();

  const thumbHtml = r.thumbnail
    ? `<img class="grid-thumb" src="${{r.thumbnail}}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=grid-no-thumb>▶</div>'">`
    : `<div class="grid-no-thumb">▶</div>`;

  card.innerHTML = `
    <div class="grid-thumb-wrap">${{thumbHtml}}</div>
    <div class="grid-meta">
      <div class="grid-author">@${{r.sender}}</div>
      <div class="grid-date">${{r.timestamp}}</div>
    </div>
  `;
  gridCards.appendChild(card);
}});

// ── FILTER ───────────────────────────────────────────────────────
function filterRows() {{
  const q = document.getElementById('search').value.toLowerCase();
  let visible = 0;

  document.querySelectorAll('.db-row').forEach(row => {{
    const match = !q || row.dataset.author.includes(q);
    row.classList.toggle('hidden', !match);
    if (match) visible++;
  }});
  document.querySelectorAll('.grid-card').forEach(card => {{
    const match = !q || card.dataset.author.includes(q);
    card.classList.toggle('hidden', !match);
  }});

  document.getElementById('count-badge').textContent =
    q ? `${{visible}} of ${{reels.length}} reels` : `${{reels.length}} reels`;
}}

// ── VIEW TOGGLE ──────────────────────────────────────────────────
function setView(view, btn) {{
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('list-view').style.display = view === 'list' ? 'block' : 'none';
  document.getElementById('grid-view').style.display  = view === 'grid' ? 'block' : 'none';
}}
</script>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

async def main() -> None:
    if not THREAD_URL:
        print("✗ THREAD_URL not set in .env")
        print("  Example: THREAD_URL=https://www.instagram.com/direct/t/101778554557290/")
        return

    # async with = async context manager. Starts the Playwright server process,
    # yields it as `pw`, and guarantees cleanup (browser processes killed) on exit.
    async with async_playwright() as pw:

        # First run: session.json doesn't exist yet — need manual login
        if not SESSION_FILE.exists():
            await login_and_save_session(pw)

        reels = await scrape_reels(pw)

    if not reels:
        print("No reels found.")
        return

    # Save raw data so enrichment scripts can load it without re-scraping
    with open("reels.json", "w", encoding="utf-8") as f:
        json.dump(reels, f, ensure_ascii=False, indent=2)
    print(f"✓ Saved → reels.json ({len(reels)} reels)")

    with open("reel_links.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(r["url"] for r in reels))
    print(f"✓ Saved → reel_links.txt")

    print(f"Building HTML feed...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(build_html(reels))
    print(f"✓ Saved → {OUTPUT_FILE}")
    print(f"  open {OUTPUT_FILE}")


if __name__ == "__main__":
    # asyncio.run() starts the async event loop, runs main() to completion,
    # then shuts the loop down. This is the standard entry point for async programs.
    asyncio.run(main())
