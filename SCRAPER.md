# Instagram DM Reel Scraper

Scrapes all shared reels/stories from an Instagram DM thread and outputs a self-contained HTML feed.

Uses **Playwright** (real browser automation) instead of raw HTTP requests — no manual token extraction, no auth headers to maintain.

---

## Why Playwright instead of raw HTTP

Instagram's private API requires a stack of short-lived tokens (`fb_dtsg`, `lsd`, `doc_id`) that expire or rotate with each deploy. Managing them manually means:
- Recapturing tokens from DevTools every few hours
- Breaking whenever Instagram ships new frontend code
- Manually matching headers, checksums (`jazoest`), and body params

Playwright sidesteps all of this. It runs a real Chromium browser. Instagram's own frontend runs inside it, fires its own API calls, and we intercept the responses. From Instagram's perspective, it looks exactly like a normal browser session. No tokens to manage — ever.

---

## How it works

### Core concept: response interception

```
You scroll up in the DM thread
    → Instagram's frontend fires a GraphQL API request for the next 20 messages
        → Playwright's on_response handler catches that response
            → We parse the JSON and extract any reels
```

The scraper registers `page.on("response", handler)` before navigating to the thread. This callback fires for every HTTP response the browser receives. We filter for `api/graphql` calls, parse the JSON, and pull out reel data.

### Playwright object hierarchy

```
async_playwright()          ← starts the Playwright server process
  └── Browser               ← a Chromium instance (launch())
        └── BrowserContext  ← isolated profile: own cookies, localStorage, cache
              └── Page      ← a single browser tab (new_page())
```

`BrowserContext` is the key unit. It's like an incognito profile — separate from your real browser and from other contexts. We inject saved auth into a context via `storage_state=`.

### Session persistence

On first run, we open a visible browser and let you log in manually. After login, `context.storage_state(path="session.json")` serialises every cookie and localStorage entry into a JSON file. On subsequent runs, `browser.new_context(storage_state="session.json")` injects all of that back — the browser wakes up fully logged in, no login flow needed.

`session.json` is your auth token. Keep it secret, don't commit it.

### Pagination via scroll

Instagram virtualises the DM thread — older messages aren't in the DOM, they load dynamically as you scroll up. Each upward scroll triggers the frontend to call the GraphQL API for the next page (~20 messages). The scraper uses `page.evaluate()` to run JavaScript inside the page, finds the scrollable messages container, and sets `scrollTop = 0` repeatedly. Each call triggers a new API batch. The response interceptor catches each batch automatically.

The loop stops when 4 consecutive scrolls yield no new reels — either the thread top has been reached or there are no more shared reels.

### The `for (;;);` prefix

Instagram prepends `for (;;);` to some API responses. This is an XSS guard — if a browser somehow executes the response body as JavaScript, the infinite loop prevents data exfiltration. We strip this prefix before calling `json.loads()`.

### Response shape fallbacks

Instagram has changed the GraphQL response structure multiple times. `extract_reels_from_response()` tries these paths in order:

1. `data.xdt_message_thread.messages` — current (2024–2025)
2. `data.message_thread.messages` — alternate
3. `data.thread.messages` — older
4. `data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages` — legacy

First path that doesn't throw `KeyError` wins.

### Message filtering

Each message in the GraphQL response has an `item_type` field. We only keep:
- `xma` — cross-media attachment (modern shared reel)
- `MONTAGE_SHARE_XMA` — legacy reel share name
- `clip` / `reel_share` — other known reel types

Everything else (text, images, reactions, polls) is skipped.

---

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install playwright python-dotenv
playwright install chromium    # downloads Chromium binary (~150 MB), one-time
```

`.env`:
```
THREAD_URL=https://www.instagram.com/direct/t/<thread_id>/
```

Run:
```bash
python3 scrapper.py
open reel_feed.html
```

---

## First run vs subsequent runs

**First run** (no `session.json`):
1. Chromium opens visibly
2. Navigate to Instagram login
3. You log in manually (supports 2FA, challenge pages)
4. Once home page loads, session is saved to `session.json`
5. Browser closes, scraping begins immediately

**Subsequent runs** (`session.json` exists):
1. Browser opens with saved session (no login page)
2. Navigates directly to the thread
3. Scrolls and collects reels
4. Browser closes, HTML written

---

## Output

`reel_feed.html` — self-contained dark-mode page with:
- Responsive card grid, 9:16 thumbnails
- Table view toggle
- Live filter by caption or sender
- Direct links to each reel on Instagram

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Browser opens to login page despite session.json existing | Session expired | Delete `session.json`, re-run to log in again. Script detects this and deletes it automatically. |
| 0 reels found, no errors | Thread has no shared reels, or scroll didn't trigger API calls | Watch the browser window — check if messages are loading as it scrolls |
| `ModuleNotFoundError: playwright` | Not installed | `pip install playwright && playwright install chromium` |
| Browser opens but crashes | Chromium not installed | `playwright install chromium` |
| Reels found but thumbnails broken | CDN URLs expire after ~24h | Normal — links still work, thumbnails just won't load |
| Fewer reels than expected | `no_change < 4` threshold too low | Increase to `< 8` in `scrape_reels()` if thread is very long |

---

## Files

| File | Purpose |
|---|---|
| `scrapper.py` | Main script |
| `.env` | Config — only `THREAD_URL` needed |
| `session.json` | Saved browser auth state — **do not commit** |
| `reel_feed.html` | Output — regenerated on each run |
| `venv/` | Python virtual environment |
