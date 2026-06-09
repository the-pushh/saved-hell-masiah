import json
from datetime import datetime
from pathlib import Path

from playwright.async_api import Playwright


def extract_reels_from_response(data: dict) -> list[dict]:
    reels = []
    d = data.get("data", {})

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

    for edge in messages_node.get("edges", []):
        node = edge.get("node", {})
        xma = node.get("xma") or (node.get("content") or {}).get("xma") or {}
        target_url = xma.get("target_url") or xma.get("url") or ""
        if not target_url:
            continue

        preview = xma.get("preview_image") or xma.get("xmaPreviewImage") or {}
        thumb_url = (preview.get("url") or "") if isinstance(preview, dict) else ""
        sender = xma.get("header_title_text") or xma.get("xmaHeaderTitle") or "unknown"

        ts_ms = int(node.get("timestamp_ms") or node.get("timestamp") or 0)
        ts = (
            datetime.fromtimestamp(ts_ms / (1000 if ts_ms > 1e10 else 1)).strftime("%b %d, %Y %H:%M")
            if ts_ms
            else ""
        )

        reels.append({
            "url": target_url,
            "thumbnail": thumb_url,
            "caption": "",
            "sender": sender,
            "timestamp": ts,
        })

    return reels


async def login_and_save_session(playwright: Playwright, data_dir: Path, on_event) -> None:
    on_event({"type": "log", "msg": "No session found — opening browser for login..."})
    browser = await playwright.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    await page.goto("https://www.instagram.com/accounts/login/")
    on_event({"type": "log", "msg": "Please log in to Instagram. You have 3 minutes."})

    await page.wait_for_url("https://www.instagram.com/**", timeout=180_000)

    for _ in range(60):
        if "login" not in page.url and "challenge" not in page.url and "two_factor" not in page.url:
            break
        await page.wait_for_timeout(2_000)

    await context.storage_state(path=str(data_dir / "session.json"))
    on_event({"type": "log", "msg": "✓ Session saved. Starting scrape..."})
    await browser.close()


async def scrape_reels(playwright: Playwright, thread_url: str, data_dir: Path, on_event) -> list[dict]:
    session_file = data_dir / "session.json"
    if not session_file.exists():
        await login_and_save_session(playwright, data_dir, on_event)

    all_reels: list[dict] = []
    seen_urls: set[str] = set()

    browser = await playwright.chromium.launch(headless=False)
    context = await browser.new_context(
        storage_state=str(session_file),
        viewport={"width": 1280, "height": 900},
    )
    page = await context.new_page()

    on_event({"type": "log", "msg": "Navigating to thread..."})
    await page.goto(thread_url, wait_until="domcontentloaded", timeout=30_000)

    if "login" in page.url or "accounts" in page.url:
        await browser.close()
        session_file.unlink(missing_ok=True)
        on_event({"type": "error", "msg": "Session expired — re-run to log in again."})
        return []

    on_event({"type": "log", "msg": "Waiting for page to settle..."})
    await page.wait_for_timeout(5_000)

    async def on_response(response) -> None:
        if "api/graphql" not in response.url:
            return
        try:
            body = await response.text()
            if body.startswith("for (;;);"):
                body = body[len("for (;;);"):]
            data = json.loads(body)
            reels = extract_reels_from_response(data)
            for r in reels:
                if r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    all_reels.append(r)
                    on_event({"type": "reel", "data": r})
        except Exception:
            pass

    page.on("response", on_response)

    on_event({"type": "log", "msg": "Scrolling through thread to load all messages..."})
    vp = page.viewport_size or {"width": 1280, "height": 900}
    cx, cy = vp["width"] // 2, vp["height"] // 2
    await page.mouse.click(cx, cy)
    await page.wait_for_timeout(500)

    no_change = 0
    prev_count = 0

    while no_change < 4:
        for _ in range(6):
            await page.mouse.wheel(0, -800)
            await page.wait_for_timeout(200)
        await page.wait_for_timeout(2_500)

        if len(all_reels) == prev_count:
            no_change += 1
        else:
            no_change = 0
            prev_count = len(all_reels)

        on_event({"type": "log", "msg": f"{len(all_reels)} reels collected..."})

    await browser.close()

    (data_dir / "reels.json").write_text(json.dumps(all_reels, ensure_ascii=False, indent=2))
    (data_dir / "reel_links.txt").write_text("\n".join(r["url"] for r in all_reels))
    on_event({"type": "log", "msg": "✓ Saved reels.json and reel_links.txt"})
    on_event({"type": "done", "stage": "scrape", "count": len(all_reels)})

    return all_reels
