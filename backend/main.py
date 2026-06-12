import asyncio
import json
import os
import shutil
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.scraper import scrape_reels
from backend.saved_posts import scrape_saved_posts
from backend.enricher import (
    enrich_captions,
    enrich_transcripts,
    enrich_one_caption,
    enrich_one_transcript,
    download_video_file,
)
from playwright.async_api import async_playwright

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DATA_DIR.mkdir(exist_ok=True)
(DATA_DIR / "videos").mkdir(exist_ok=True)
(DATA_DIR / "media").mkdir(exist_ok=True)

WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
THREAD_URL_DEFAULT = os.getenv("THREAD_URL", "")

app = FastAPI(title="LifeOffline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, asyncio.Queue] = {}
_current_job: str | None = None
_download_lock = asyncio.Lock()


class ScrapeRequest(BaseModel):
    thread_url: str | None = None        # legacy single-DM format
    sources: list[dict] | None = None    # new multi-source format
    download_media: bool = False


class SingleReelRequest(BaseModel):
    url: str


class DownloadAllRequest(BaseModel):
    source_label: str | None = None


def _reel_id_from_url(url: str) -> str:
    parts = [p for p in urlparse(url).path.split("/") if p]
    return parts[-1] if parts else url[-12:]


def _purge_reel_files(reels: list[dict], data_dir: Path) -> None:
    videos_dir = data_dir / "videos"
    audio_dir = data_dir / "audio"
    transcripts_dir = data_dir / "transcripts"
    for reel in reels:
        reel_id = _reel_id_from_url(reel["url"])
        media_dir = data_dir / "media" / reel_id
        if media_dir.exists():
            shutil.rmtree(media_dir, ignore_errors=True)
        if videos_dir.exists():
            for f in videos_dir.glob(f"{reel_id}.*"):
                f.unlink(missing_ok=True)
        if audio_dir.exists():
            for f in audio_dir.glob(f"{reel_id}*.mp3"):
                f.unlink(missing_ok=True)
        if transcripts_dir.exists():
            for f in transcripts_dir.glob(f"{reel_id}*.txt"):
                f.unlink(missing_ok=True)


async def scrape_sources(
    playwright,
    sources: list[dict],
    data_dir: Path,
    on_event,
    download_media: bool = False,
) -> None:
    reels_path = data_dir / "reels.json"
    existing: list[dict] = json.loads(reels_path.read_text()) if reels_path.exists() else []
    seen_urls: set[str] = {r["url"] for r in existing}
    all_new: list[dict] = []

    # Count each source type so we can produce distinct labels
    dm_sources = [s for s in sources if s.get("type", "dm") == "dm"]
    n_dm = len(dm_sources)
    dm_idx = 0

    for source in sources:
        stype = source.get("type", "dm")
        fresh = bool(source.get("fresh", False))

        if stype == "dm":
            url = source.get("url", "").strip()
            if not url:
                continue
            default_label = "DM" if n_dm == 1 else f"DM {dm_idx + 1}"
            label = source.get("name", "").strip() or default_label
            dm_idx += 1
        elif stype == "saved":
            username = source.get("username", "").strip().lstrip("@")
            if not username:
                continue
            label = source.get("name", "").strip() or "Saved"
        else:
            continue

        # Fresh re-scrape: purge existing reels for this source so they re-emit
        if fresh:
            to_purge = [r for r in existing if r.get("source_label") == label]
            existing = [r for r in existing if r.get("source_label") != label]
            seen_urls = {r["url"] for r in existing}
            on_event({"type": "log", "msg": f"── {label}: clearing {len(to_purge)} old reels + media"})
            _purge_reel_files(to_purge, data_dir)

        if stype == "dm":
            on_event({"type": "log", "msg": f"── {label}: {url[:60]}"})
            new_reels = await scrape_reels(playwright, url, data_dir, on_event, source_label=label)
        else:
            on_event({"type": "log", "msg": f"── Saved Posts: @{username}"})
            new_reels = await scrape_saved_posts(
                playwright, username, data_dir, on_event, source_label=label
            )

        for r in new_reels:
            if r["url"] not in seen_urls:
                seen_urls.add(r["url"])
                all_new.append(r)

    # Backfill source_label for any legacy reels missing the field
    for r in existing:
        if not r.get("source_label"):
            r["source_label"] = "DM" if r.get("source") != "saved" else "Saved"

    merged = existing + all_new
    reels_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2))
    (data_dir / "reel_links.txt").write_text("\n".join(r["url"] for r in merged))

    # Optional: download media for all newly scraped reels
    if download_media and all_new:
        on_event({"type": "log", "msg": f"Downloading media for {len(all_new)} reels..."})
        for i, reel in enumerate(all_new):
            on_event({"type": "log", "msg": f"  [{i + 1}/{len(all_new)}] {reel['url'][-40:]}"})
            result = await download_video_file(reel["url"], data_dir, on_event)
            if result:
                reel.update(result)
                on_event({"type": "reel_update", "url": reel["url"], "media": result})
        reels_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2))

    enriched = sum(1 for r in merged if r.get("caption"))
    on_event({"type": "log", "msg": f"✓ All done — {len(all_new)} new reels ({len(merged)} total), {enriched} captions"})
    on_event({"type": "done", "stage": "scrape", "count": len(all_new)})


async def _run_job(job_id: str, coro) -> None:
    global _current_job
    queue = _jobs[job_id]
    _current_job = job_id
    try:
        await coro(queue)
    except Exception as exc:
        queue.put_nowait({"type": "error", "msg": str(exc)})
    finally:
        queue.put_nowait(None)
        _current_job = None


@app.post("/api/scrape")
async def start_scrape(req: ScrapeRequest):
    if _current_job:
        return JSONResponse({"error": "A job is already running"}, status_code=409)

    if req.sources:
        sources = req.sources
    elif req.thread_url:
        sources = [{"type": "dm", "url": req.thread_url}]
    else:
        return JSONResponse({"error": "Provide thread_url or sources"}, status_code=400)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        async with async_playwright() as pw:
            await scrape_sources(pw, sources, DATA_DIR, q.put_nowait, download_media=req.download_media)

    asyncio.create_task(_run_job(job_id, run))
    return {"job_id": job_id}


@app.post("/api/enrich/captions")
async def start_captions():
    if _current_job:
        return JSONResponse({"error": "A job is already running"}, status_code=409)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        await enrich_captions(DATA_DIR, q.put_nowait)

    asyncio.create_task(_run_job(job_id, run))
    return {"job_id": job_id}


@app.post("/api/enrich/transcripts")
async def start_transcripts():
    if _current_job:
        return JSONResponse({"error": "A job is already running"}, status_code=409)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        await enrich_transcripts(DATA_DIR, WHISPER_DEVICE, q.put_nowait)

    asyncio.create_task(_run_job(job_id, run))
    return {"job_id": job_id}


@app.post("/api/enrich/download-all")
async def start_download_all(req: DownloadAllRequest):
    if _current_job:
        return JSONResponse({"error": "A job is already running"}, status_code=409)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        reels_path = DATA_DIR / "reels.json"
        if not reels_path.exists():
            q.put_nowait({"type": "done", "count": 0})
            return
        reels = json.loads(reels_path.read_text())
        targets = [
            r for r in reels
            if (not req.source_label or r.get("source_label") == req.source_label)
            and not r.get("video_path") and not r.get("image_paths")
        ]
        count = 0
        for reel in targets:
            result = await download_video_file(reel["url"], DATA_DIR, q.put_nowait)
            if result:
                q.put_nowait({"type": "reel_update", "url": reel["url"], "media": result})
                count += 1
        q.put_nowait({"type": "done", "count": count})

    asyncio.create_task(_run_job(job_id, run))
    return {"job_id": job_id}


@app.post("/api/reel/caption")
async def reel_caption(req: SingleReelRequest):
    if _current_job:
        return JSONResponse({"error": "A job is already running"}, status_code=409)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        await enrich_one_caption(req.url, DATA_DIR, q.put_nowait)

    asyncio.create_task(_run_job(job_id, run))
    return {"job_id": job_id}


@app.post("/api/reel/transcript")
async def reel_transcript(req: SingleReelRequest):
    if _current_job:
        return JSONResponse({"error": "A job is already running"}, status_code=409)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        await enrich_one_transcript(req.url, DATA_DIR, WHISPER_DEVICE, q.put_nowait)

    asyncio.create_task(_run_job(job_id, run))
    return {"job_id": job_id}


@app.post("/api/reel/download")
async def reel_download(req: SingleReelRequest):
    """Download reel media with yt-dlp. Returns {video_path?, image_paths?, post_type} or error."""
    async with _download_lock:
        events: list[dict] = []
        def collect(e):
            events.append(e)

        result = await download_video_file(req.url, DATA_DIR, collect)
        log = [e.get("msg", "") for e in events]
        if result:
            return {**result, "log": log}
        return JSONResponse({"error": "Download failed", "log": log}, status_code=500)


@app.get("/api/videos/{reel_id}")
async def serve_video(reel_id: str):
    # Check legacy videos dir
    candidates = list((DATA_DIR / "videos").glob(f"{reel_id}.*"))
    if candidates:
        return FileResponse(candidates[0], media_type="video/mp4")
    # Check new media dir
    media_dir = DATA_DIR / "media" / reel_id
    if media_dir.exists():
        vids = sorted(media_dir.glob("*.mp4"))
        if vids:
            return FileResponse(vids[0], media_type="video/mp4")
    return JSONResponse({"error": "Video not found"}, status_code=404)


_MIME = {".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".png": "image/png", ".webp": "image/webp"}


@app.get("/api/media/{reel_id}/{filename}")
async def serve_media_file(reel_id: str, filename: str):
    filepath = DATA_DIR / "media" / reel_id / filename
    if not filepath.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(filepath, media_type=_MIME.get(filepath.suffix.lower(), "application/octet-stream"))


@app.get("/api/reels")
async def get_reels():
    reels_path = DATA_DIR / "reels.json"
    if not reels_path.exists():
        return []
    return json.loads(reels_path.read_text())


@app.get("/api/status")
async def get_status():
    reels_path = DATA_DIR / "reels.json"
    count = 0
    if reels_path.exists():
        try:
            count = len(json.loads(reels_path.read_text()))
        except Exception:
            pass
    return {
        "session_exists": (DATA_DIR / "session.json").exists(),
        "reels_count": count,
        "current_job": _current_job,
        "default_thread_url": THREAD_URL_DEFAULT,
    }


@app.delete("/api/session")
async def clear_session():
    session = DATA_DIR / "session.json"
    if session.exists():
        session.unlink()
    return {"cleared": True}


@app.get("/api/export/links")
async def export_links():
    p = DATA_DIR / "reel_links.txt"
    if not p.exists():
        return JSONResponse({"error": "No links yet — scrape first"}, status_code=404)
    return FileResponse(p, filename="reel_links.txt", media_type="text/plain")


@app.get("/api/export/json")
async def export_json():
    p = DATA_DIR / "reels.json"
    if not p.exists():
        return JSONResponse({"error": "No reels yet — scrape first"}, status_code=404)
    return FileResponse(p, filename="reels.json", media_type="application/json")


@app.websocket("/ws/{job_id}")
async def ws_endpoint(ws: WebSocket, job_id: str):
    await ws.accept()
    queue = _jobs.get(job_id)
    if not queue:
        await ws.close(code=1008)
        return

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
                continue
            if event is None:
                break
            await ws.send_json(event)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
        _jobs.pop(job_id, None)
