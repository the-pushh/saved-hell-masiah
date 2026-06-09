import asyncio
import html as html_lib
import json
import re
from pathlib import Path

import httpx

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _load_cookies(session_path: Path) -> dict:
    data = json.loads(session_path.read_text())
    return {
        c["name"]: c["value"]
        for c in data.get("cookies", [])
        if ".instagram.com" in c.get("domain", "")
    }


async def enrich_captions(data_dir: Path, on_event) -> None:
    reels_path = data_dir / "reels.json"
    session_path = data_dir / "session.json"

    if not reels_path.exists():
        on_event({"type": "error", "msg": "reels.json not found — scrape first"})
        return

    reels: list[dict] = json.loads(reels_path.read_text())
    cookies = _load_cookies(session_path) if session_path.exists() else {}
    total = len(reels)
    pending = [r for r in reels if not r.get("caption")]

    on_event({"type": "log", "msg": f"Fetching captions for {len(pending)} reels..."})

    async with httpx.AsyncClient(
        cookies=cookies,
        headers=_HEADERS,
        follow_redirects=True,
        timeout=15,
    ) as client:
        for i, reel in enumerate(reels):
            if reel.get("caption"):
                continue
            try:
                resp = await client.get(reel["url"])
                m = re.search(r'<meta\s+property="og:description"\s+content="([^"]*)"', resp.text)
                if m:
                    caption = html_lib.unescape(m.group(1))
                    reel["caption"] = caption
                    on_event({"type": "caption_update", "url": reel["url"], "caption": caption})
            except Exception as exc:
                on_event({"type": "log", "msg": f"  ✗ caption fetch failed: {exc}"})

            if (i + 1) % 10 == 0:
                reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
                on_event({"type": "log", "msg": f"  {i + 1}/{total} processed"})

    reels_path.write_text(json.dumps(reels, ensure_ascii=False, indent=2))
    enriched = sum(1 for r in reels if r.get("caption"))
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
