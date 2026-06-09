# IG DM Scraper

Locally-hosted web app that scrapes reels shared in your Instagram DMs, fetches their captions, and transcribes their audio — all running on your machine with no external services.

> **Local only.** Nothing leaves your computer. Session cookies and scraped data stay in `data/`.

---

## What it does

1. **Scrape** — opens a browser with your Instagram session, navigates to a DM thread, and collects every reel shared in that thread
2. **Captions** — fetches the caption for each reel from Instagram's page metadata
3. **Transcribe** — downloads audio via yt-dlp and transcribes with faster-whisper (local Whisper model, no API key)

Outputs: `data/reels.json` · `data/reel_links.txt` · `data/transcripts/`

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- Google Chrome (for yt-dlp cookie auth during transcript step)

---

## Quick start — single command

```bash
chmod +x start.sh
./start.sh
```

Open **http://localhost:3000** in your browser.

`start.sh` will:
- Create a Python virtual environment (`.venv/`)
- Install all Python dependencies
- Download the Playwright Chromium browser (~150 MB, one-time)
- Install Node dependencies for the frontend
- Start both the backend (port 8000) and frontend (port 3000)

---

## Quick start — Docker

> Docker cannot open a visible browser window, so you must complete the first-time login with `start.sh` before using Docker.

```bash
# Step 1 — first-time login only (creates data/session.json)
./start.sh
# Log in to Instagram in the browser that opens, then Ctrl+C

# Step 2 — all subsequent runs
docker-compose up
```

---

## First-time login

On your first scrape, no `data/session.json` exists yet. The scraper will open a visible Chromium window and navigate to `instagram.com/accounts/login/`. Log in normally (including 2FA if enabled). The session is saved automatically and reused on future runs.

If your session expires, delete `data/session.json` and scrape again.

---

## Using the UI

1. Paste your DM thread URL into the **Thread URL** field
   - Format: `https://www.instagram.com/direct/t/<thread_id>/`
   - Find it by opening a DM conversation in your browser and copying the URL
2. Click **▶ Scrape DM Thread** — watch reels appear live in the table
3. Click **Enrich Captions** — fills the Caption column for each reel
4. Click **Transcribe Audio** — downloads audio and transcribes each reel

Use **↓ reels.json** and **↓ reel_links.txt** to download the raw data.

---

## Output files

| File | Description |
|------|-------------|
| `data/reels.json` | JSON array with url, sender, timestamp, thumbnail, caption, transcript fields |
| `data/reel_links.txt` | One reel URL per line — feed directly into yt-dlp or other tools |
| `data/audio/*.mp3` | Downloaded audio files (created by Transcribe step) |
| `data/transcripts/*.txt` | One transcript file per reel, named by reel ID |

---

## GPU transcription

By default, Whisper runs on CPU (`medium` model, `int8` quantisation). For faster transcription on a CUDA GPU:

```bash
WHISPER_DEVICE=cuda ./start.sh
# or in docker-compose.yml: WHISPER_DEVICE: cuda
```

The medium model downloads ~1.5 GB on first run and is cached in `~/.cache/huggingface/`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Backend not reachable | Make sure port 8000 is free: `lsof -i :8000` |
| Session expired | Delete `data/session.json`, scrape again to re-login |
| No reels found | Scroll the DM thread manually in browser once to confirm it loads; some threads need the 5s settle time increased |
| yt-dlp fails | Update it: `pip install -U yt-dlp` |
| Whisper OOM | Switch to `small` model by editing `enricher.py` line `WhisperModel("medium", ...)` |
| Docker login needed | Run `./start.sh` once to create `data/session.json`, then use Docker |
