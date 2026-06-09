import asyncio
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright
from backend.scraper import _extract_caption, _clean_url


async def enrich_captions(data_dir: Path, on_event) -> None:
    reels_path = data_dir / "reels.json"
    session_path = data_dir / "session.json"

    if not reels_path.exists():
        on_event({"type": "error", "msg": "reels.json not found — scrape first"})
        return

    reels: list[dict] = json.loads(reels_path.read_text())
    total = len(reels)
    pending = [r for r in reels if not r.get("caption")]

    on_event({"type": "log", "msg": f"Fetching captions for {len(pending)}/{total} reels..."})

    if not pending:
        on_event({"type": "done", "stage": "captions", "count": total})
        return

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx_kwargs = (
            {"storage_state": str(session_path)} if session_path.exists() else {}
        )
        context = await browser.new_context(**ctx_kwargs)
        page = await context.new_page()

        enriched = 0
        for i, reel in enumerate(reels):
            if reel.get("caption"):
                enriched += 1
                continue
            try:
                await page.goto(_clean_url(reel["url"]), wait_until="domcontentloaded", timeout=15_000)
                caption = _extract_caption(await page.content())
                if caption:
                    reel["caption"] = caption
                    enriched += 1
                    on_event({"type": "caption_update", "url": reel["url"], "caption": caption})
            except Exception as exc:
                on_event({"type": "log", "msg": f"  ✗ {reel['url'][:60]}… {exc}"})

            if (i + 1) % 10 == 0:
                reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
                on_event({"type": "log", "msg": f"  {i + 1}/{total} processed ({enriched} captions)"})

        await browser.close()

    reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
    on_event({"type": "log", "msg": f"✓ Captions done — {enriched}/{total} found"})
    on_event({"type": "done", "stage": "captions", "count": enriched})


async def enrich_transcripts(data_dir: Path, whisper_device: str, on_event) -> None:
    reel_links = data_dir / "reel_links.txt"
    audio_dir = data_dir / "audio"
    transcripts_dir = data_dir / "transcripts"
    audio_dir.mkdir(exist_ok=True)
    transcripts_dir.mkdir(exist_ok=True)

    if not reel_links.exists():
        on_event({"type": "error", "msg": "reel_links.txt not found — scrape first"})
        return

    on_event({"type": "log", "msg": "Stage 1/2 — downloading audio with yt-dlp..."})

    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "-a", str(reel_links),
        "--cookies-from-browser", "chrome",
        "-x", "--audio-format", "mp3",
        "-o", str(audio_dir / "%(id)s.%(ext)s"),
        "--sleep-interval", "2",
        "--ignore-errors",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    async for line in proc.stdout:
        on_event({"type": "log", "msg": line.decode().rstrip()})

    await proc.wait()
    on_event({"type": "log", "msg": "Stage 2/2 — transcribing with faster-whisper..."})

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        on_event({"type": "error", "msg": "faster-whisper not installed — run: pip install faster-whisper"})
        return

    compute_type = "float16" if whisper_device == "cuda" else "int8"
    model = WhisperModel("medium", device=whisper_device, compute_type=compute_type)

    mp3_files = sorted(audio_dir.glob("*.mp3"))
    total = len(mp3_files)

    for i, mp3 in enumerate(mp3_files):
        out_path = transcripts_dir / f"{mp3.stem}.txt"
        if out_path.exists():
            on_event({"type": "log", "msg": f"  skip {mp3.name} (already transcribed)"})
            continue

        on_event({"type": "log", "msg": f"  [{i + 1}/{total}] Transcribing {mp3.name}..."})
        segments, _ = model.transcribe(str(mp3))
        text = " ".join(seg.text.strip() for seg in segments)
        out_path.write_text(text)
        on_event({"type": "transcript_update", "id": mp3.stem, "transcript": text})

    on_event({"type": "done", "stage": "transcripts", "count": total})
