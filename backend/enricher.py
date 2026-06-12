import asyncio
import json
import random
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright
from backend.scraper import _extract_caption, _clean_url, _caption_url

_whisper_cache: dict = {}  # (model_size, device, compute_type) -> WhisperModel


def _get_whisper(model_size: str, device: str, compute_type: str):
    key = (model_size, device, compute_type)
    if key not in _whisper_cache:
        from faster_whisper import WhisperModel
        _whisper_cache[key] = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _whisper_cache[key]


def _reel_id(url: str) -> str:
    parts = [p for p in urlparse(url).path.split("/") if p]
    return parts[-1] if parts else url[-12:]


def _write_cookies_txt(session_path: Path, out_path: Path) -> bool:
    """Convert Playwright storage_state JSON → Netscape cookies.txt for yt-dlp."""
    if not session_path.exists():
        return False
    try:
        state = json.loads(session_path.read_text())
        lines = ["# Netscape HTTP Cookie File"]
        for c in state.get("cookies", []):
            domain = c.get("domain", "")
            flag = "TRUE" if domain.startswith(".") else "FALSE"
            path = c.get("path", "/")
            secure = "TRUE" if c.get("secure", False) else "FALSE"
            expires = str(int(c.get("expires", 0) if c.get("expires", -1) != -1 else time.time() + 86400 * 365))
            name = c.get("name", "")
            value = c.get("value", "")
            lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expires}\t{name}\t{value}")
        out_path.write_text("\n".join(lines))
        return True
    except Exception:
        return False


def _yt_dlp_cookies_args(data_dir: Path) -> list[str]:
    """Return --cookies <file> args if session exists, else --cookies-from-browser chrome."""
    cookies_txt = data_dir / "cookies.txt"
    if _write_cookies_txt(data_dir / "session.json", cookies_txt):
        return ["--cookies", str(cookies_txt)]
    return ["--cookies-from-browser", "chrome"]


async def enrich_captions(data_dir: Path, on_event) -> None:
    reels_path = data_dir / "reels.json"

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

    n_pending = len(pending)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        enriched = sum(1 for r in reels if r.get("caption"))
        fetched = 0
        for idx, reel in enumerate(pending):
            on_event({"type": "log", "msg": f"  [{idx + 1}/{n_pending}] fetching caption…"})
            try:
                await asyncio.sleep(random.uniform(3.0, 6.0))
                try:
                    await page.goto(_caption_url(reel["url"]), wait_until="domcontentloaded", timeout=15_000)
                except Exception as exc:
                    msg = str(exc)
                    if "429" in msg or "ERR_HTTP_RESPONSE_CODE_FAILURE" in msg:
                        on_event({"type": "log", "msg": f"  ⏳ rate limited — waiting 45s before retry"})
                        await asyncio.sleep(45)
                        try:
                            await page.goto(_caption_url(reel["url"]), wait_until="domcontentloaded", timeout=15_000)
                        except Exception:
                            on_event({"type": "log", "msg": f"  ✗ still failing after retry: {reel['url'][:60]}"})
                            continue
                    else:
                        on_event({"type": "log", "msg": f"  ✗ {reel['url'][:50]}… {msg[:80]}"})
                        continue
                caption = _extract_caption(await page.content())
                if caption:
                    reel["caption"] = caption
                    enriched += 1
                    fetched += 1
                    on_event({"type": "caption_update", "url": reel["url"], "caption": caption})
            except Exception as exc:
                on_event({"type": "log", "msg": f"  ✗ {reel['url'][:60]}… {exc}"})

            if (idx + 1) % 10 == 0:
                reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))

        await browser.close()

    reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
    on_event({"type": "log", "msg": f"✓ Captions done — {fetched} new, {enriched}/{total} total"})
    on_event({"type": "done", "stage": "captions", "count": enriched})


async def enrich_transcripts(data_dir: Path, whisper_device: str, on_event) -> None:
    reels_path = data_dir / "reels.json"
    audio_dir = data_dir / "audio"
    transcripts_dir = data_dir / "transcripts"
    audio_dir.mkdir(exist_ok=True)
    transcripts_dir.mkdir(exist_ok=True)

    if not reels_path.exists():
        on_event({"type": "error", "msg": "reels.json not found — scrape first"})
        return

    reels: list[dict] = json.loads(reels_path.read_text())
    pending_urls = [r["url"] for r in reels if not r.get("transcript")]

    if not pending_urls:
        on_event({"type": "done", "stage": "transcripts", "count": 0})
        return

    total = len(pending_urls)
    on_event({"type": "transcription_start", "total": total})
    on_event({"type": "log", "msg": f"Stage 1/2 — downloading audio for {total} reels (parallel)…"})

    # Phase 1: parallel yt-dlp downloads (max 3 concurrent)
    sem = asyncio.Semaphore(3)
    dl_errors: list[str] = []

    async def _download_one(url: str) -> None:
        reel_id = _reel_id(url)
        mp3_path = audio_dir / f"{reel_id}.mp3"
        if mp3_path.exists() or list(audio_dir.glob(f"{reel_id}*.mp3")):
            return
        async with sem:
            on_event({"type": "log_group_start", "label": f"Downloading {reel_id}…"})
            proc = await asyncio.create_subprocess_exec(
                "yt-dlp", url,
                "-x", "--audio-format", "mp3",
                "-o", str(audio_dir / "%(id)s.%(ext)s"),
                "--no-playlist", "--ignore-errors",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            lines: list[str] = []
            async for raw in proc.stdout:
                decoded = raw.decode().rstrip()
                lines.append(decoded)
                on_event({"type": "log", "msg": decoded})
            rc = await proc.wait()
            on_event({"type": "log_group_end", "success": rc == 0})
            if rc != 0:
                dl_errors.append(reel_id)

    await asyncio.gather(*[_download_one(u) for u in pending_urls])

    if dl_errors:
        on_event({"type": "log", "msg": f"  ⚠ {len(dl_errors)} download(s) failed — skipped"})

    # Phase 2: sequential Whisper inference
    try:
        from faster_whisper import WhisperModel  # noqa: F401 — presence check
    except ImportError:
        on_event({"type": "error", "msg": "faster-whisper not installed — run: pip install faster-whisper"})
        return

    compute_type = "float16" if whisper_device == "cuda" else "int8"
    on_event({"type": "log", "msg": "Stage 2/2 — transcribing with Whisper…"})
    model = _get_whisper("base", whisper_device, compute_type)

    done_count = 0
    for i, url in enumerate(pending_urls):
        reel_id = _reel_id(url)
        mp3_files = list(audio_dir.glob(f"{reel_id}*.mp3"))
        if not mp3_files:
            continue
        on_event({"type": "log", "msg": f"  [{i + 1}/{total}] {reel_id}…"})
        segments, _ = model.transcribe(str(mp3_files[0]))
        text = " ".join(seg.text.strip() for seg in segments)
        for r in reels:
            if r["url"] == url:
                r["transcript"] = text
        on_event({"type": "transcript_update", "id": reel_id, "transcript": text})
        done_count += 1
        on_event({"type": "transcription_progress", "current": done_count, "total": total})

    reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
    on_event({"type": "done", "stage": "transcripts", "count": done_count})


async def enrich_one_caption(url: str, data_dir: Path, on_event) -> None:
    reels_path = data_dir / "reels.json"

    if not reels_path.exists():
        on_event({"type": "error", "msg": "reels.json not found"})
        return

    reels: list[dict] = json.loads(reels_path.read_text())
    reel = next((r for r in reels if r["url"] == url), None)
    if not reel:
        on_event({"type": "error", "msg": f"Reel not found: {url}"})
        return

    on_event({"type": "log", "msg": f"Re-fetching caption for {url[:60]}..."})
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()
        try:
            try:
                await page.goto(_caption_url(url), wait_until="domcontentloaded", timeout=15_000)
            except Exception as exc:
                msg = str(exc)
                if "ERR_HTTP_RESPONSE_CODE_FAILURE" in msg:
                    on_event({"type": "log", "msg": f"  ✗ reel unavailable (deleted or private): {_caption_url(url)}"})
                else:
                    on_event({"type": "log", "msg": f"  ✗ navigation failed: {msg[:120]}"})
                return
            caption = _extract_caption(await page.content())
            if caption:
                reel["caption"] = caption
                reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
                on_event({"type": "caption_update", "url": url, "caption": caption})
                on_event({"type": "log", "msg": "  ✓ caption fetched"})
            else:
                on_event({"type": "log", "msg": "  ✗ page loaded but no caption found"})
        except Exception as exc:
            on_event({"type": "log", "msg": f"  ✗ {exc}"})
        finally:
            await browser.close()

    on_event({"type": "done", "stage": "captions", "count": 1})


async def enrich_one_transcript(url: str, data_dir: Path, whisper_device: str, on_event) -> None:
    reels_path = data_dir / "reels.json"

    if not reels_path.exists():
        on_event({"type": "error", "msg": "reels.json not found"})
        return

    reels: list[dict] = json.loads(reels_path.read_text())
    reel = next((r for r in reels if r["url"] == url), None)
    if not reel:
        on_event({"type": "error", "msg": f"Reel not found: {url}"})
        return

    reel_id = _reel_id(url)
    audio_dir = data_dir / "audio"
    audio_dir.mkdir(exist_ok=True)
    mp3_path = audio_dir / f"{reel_id}.mp3"

    on_event({"type": "transcription_start", "total": 1})

    if not mp3_path.exists():
        # Step 1: extract audio from local video if available
        local_video = reel.get("video_path")
        if local_video:
            video_full = data_dir / local_video
            if video_full.exists():
                on_event({"type": "log", "msg": "Extracting audio from local video..."})
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "ffmpeg", "-i", str(video_full), "-vn", "-acodec", "mp3", "-y", str(mp3_path),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await proc.wait()
                except FileNotFoundError:
                    on_event({"type": "log", "msg": "  ffmpeg not found — falling back to yt-dlp"})

    ytdlp_log: list[str] = []
    if not mp3_path.exists():
        # Step 2: download audio via yt-dlp without cookies (public reels)
        on_event({"type": "log_group_start", "label": f"Downloading audio for {reel_id} via yt-dlp…"})
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp", url,
            "-x", "--audio-format", "mp3",
            "-o", str(audio_dir / "%(id)s.%(ext)s"),
            "--no-playlist", "--ignore-errors",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            decoded = line.decode().rstrip()
            ytdlp_log.append(decoded)
            on_event({"type": "log", "msg": decoded})
        rc = await proc.wait()
        on_event({"type": "log_group_end", "success": rc == 0})

    mp3_files = list(audio_dir.glob(f"{reel_id}*.mp3"))
    if not mp3_files:
        joined = " ".join(ytdlp_log)
        if "429" in joined:
            on_event({"type": "error", "msg": "Instagram rate-limited yt-dlp (429) — wait a few minutes and retry."})
        elif "login" in joined.lower() or "private" in joined.lower():
            on_event({"type": "error", "msg": "Reel is private or requires login — audio unavailable."})
        elif ytdlp_log:
            on_event({"type": "error", "msg": f"yt-dlp failed — reel may be deleted or unsupported."})
        else:
            on_event({"type": "error", "msg": f"No audio source found for {reel_id} — no local video and yt-dlp unavailable."})
        on_event({"type": "done", "stage": "transcripts", "count": 0})
        return

    mp3 = mp3_files[0]
    on_event({"type": "log", "msg": f"Transcribing {mp3.name}…"})

    try:
        from faster_whisper import WhisperModel  # noqa: F401 — presence check
    except ImportError:
        on_event({"type": "error", "msg": "faster-whisper not installed — run: pip install faster-whisper"})
        return

    compute_type = "float16" if whisper_device == "cuda" else "int8"
    model = _get_whisper("base", whisper_device, compute_type)
    segments, _ = model.transcribe(str(mp3))
    text = " ".join(seg.text.strip() for seg in segments)

    reel["transcript"] = text
    reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
    on_event({"type": "transcript_update", "id": reel_id, "transcript": text})
    on_event({"type": "transcription_progress", "current": 1, "total": 1})
    on_event({"type": "log", "msg": f"  ✓ transcript done ({len(text)} chars)"})
    on_event({"type": "done", "stage": "transcripts", "count": 1})


async def download_video_file(url: str, data_dir: Path, on_event) -> dict | None:
    """Download video/image/carousel with yt-dlp.
    Returns {video_path?, image_paths?, post_type} or None on failure."""
    reel_id = _reel_id(url)
    media_dir = data_dir / "media" / reel_id
    media_dir.mkdir(parents=True, exist_ok=True)

    # Check already-downloaded (new media dir)
    existing = sorted(media_dir.glob("*.*"))
    if existing:
        videos = [f for f in existing if f.suffix == ".mp4"]
        images = [f for f in existing if f.suffix in (".jpg", ".jpeg", ".png", ".webp")]
        if videos:
            rel = f"media/{reel_id}/{videos[0].name}"
            on_event({"type": "log", "msg": f"  already downloaded: {rel}"})
            return {"video_path": rel, "post_type": "video"}
        if images:
            rels = [f"media/{reel_id}/{f.name}" for f in images]
            on_event({"type": "log", "msg": f"  already downloaded: {len(rels)} images"})
            return {"image_paths": rels, "post_type": "carousel_image"}

    # Check legacy videos dir
    legacy = list((data_dir / "videos").glob(f"{reel_id}.*"))
    if legacy:
        rel = f"videos/{legacy[0].name}"
        on_event({"type": "log", "msg": f"  already downloaded (legacy): {rel}"})
        return {"video_path": rel, "post_type": "video"}

    on_event({"type": "log_group_start", "label": f"Downloading media for {reel_id}…"})
    output_tmpl = str(media_dir / "%(autonumber)03d.%(ext)s")
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp", url,
        *_yt_dlp_cookies_args(data_dir),
        "-f", "best[ext=mp4]/best",
        "-o", output_tmpl,
        "--ignore-errors",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        on_event({"type": "log", "msg": line.decode().rstrip()})
    rc = await proc.wait()
    on_event({"type": "log_group_end", "success": rc == 0})

    downloaded = sorted(media_dir.glob("*.*"))
    videos = [f for f in downloaded if f.suffix == ".mp4"]
    images = [f for f in downloaded if f.suffix in (".jpg", ".jpeg", ".png", ".webp")]

    reels_path = data_dir / "reels.json"
    reels: list[dict] = json.loads(reels_path.read_text()) if reels_path.exists() else []

    if videos:
        if len(videos) == 1:
            rel = f"media/{reel_id}/{videos[0].name}"
            result: dict = {"video_path": rel, "post_type": "video"}
            on_event({"type": "log", "msg": f"  ✓ video saved: {rel}"})
        else:
            rels = [f"media/{reel_id}/{f.name}" for f in videos]
            result = {"image_paths": rels, "post_type": "carousel_video"}
            on_event({"type": "log", "msg": f"  ✓ {len(rels)} videos saved (carousel)"})
    elif images:
        rels = [f"media/{reel_id}/{f.name}" for f in images]
        result = {"image_paths": rels, "post_type": "carousel_image"}
        on_event({"type": "log", "msg": f"  ✓ {len(rels)} images saved"})
    else:
        on_event({"type": "log", "msg": f"  ✗ download failed for {reel_id}"})
        return None

    for r in reels:
        if r["url"] == url:
            r.update(result)
    if reels:
        reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))

    return result
