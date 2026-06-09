import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.scraper import scrape_reels
from backend.enricher import enrich_captions, enrich_transcripts
from playwright.async_api import async_playwright

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DATA_DIR.mkdir(exist_ok=True)

WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
THREAD_URL_DEFAULT = os.getenv("THREAD_URL", "")

app = FastAPI(title="IG DM Scraper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, asyncio.Queue] = {}
_current_job: str | None = None


class ScrapeRequest(BaseModel):
    thread_url: str


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

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()

    async def run(q: asyncio.Queue):
        async with async_playwright() as pw:
            await scrape_reels(pw, req.thread_url, DATA_DIR, q.put_nowait)

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
    """Delete session.json to force re-login on next scrape."""
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
            event = await queue.get()
            if event is None:
                break
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
        _jobs.pop(job_id, None)
