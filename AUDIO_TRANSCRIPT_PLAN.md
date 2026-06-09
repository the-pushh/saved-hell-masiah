# Reels Audio Fetcher + Transcriber

## Project context

Build two scripts that form a pipeline:
1. Fetch audio from Instagram reel URLs using yt-dlp
2. Transcribe all fetched audio using faster-whisper

No API keys, no external services, fully local and free.

## Folder structure to create

```
reels-transcriber/
├── .venv/
├── reel_urls.txt
├── 01_fetch_audio.sh
├── 02_transcribe.py
├── audio/               # created at runtime by step 1
└── transcripts/         # created at runtime by step 2
```

## Script 1 — 01_fetch_audio.sh

A bash script that:
- Reads URLs from reel_urls.txt (one URL per line)
- Downloads audio only (no video) using yt-dlp
- Saves as mp3 into audio/ directory
- Names files by reel ID: audio/%(id)s.mp3
- Uses --cookies-from-browser chrome for private/session-gated content
- Adds --sleep-interval 2 to avoid rate limiting
- Uses --ignore-errors to skip failed URLs without stopping
- Prints progress

```bash
#!/bin/bash
mkdir -p audio
yt-dlp -a reel_urls.txt \
  --cookies-from-browser chrome \
  -x --audio-format mp3 \
  -o "audio/%(id)s.%(ext)s" \
  --sleep-interval 2 \
  --ignore-errors
```

## Script 2 — 02_transcribe.py

A Python script that:
- Loads WhisperModel once at startup (not inside the loop)
- Globs all *.mp3 files from audio/
- Skips files that already have a corresponding .txt in transcripts/ (resumable)
- Transcribes each file using faster-whisper
- Joins all segments into clean text
- Writes one .txt per audio file into transcripts/
- Prints progress as [current/total] Transcribing filename...
- Prints ✓ on success, skips with a note on already-done files

### Model config

Two modes depending on hardware — accept a CLI flag or env var to switch:

CPU mode (default, Mac or no GPU):
```python
WhisperModel("medium", device="cpu", compute_type="int8")
```

GPU mode (RTX 3050, Windows/WSL2):
```python
WhisperModel("medium", device="cuda", compute_type="float16")
```

Switch via env var in .env or CLI arg --gpu

### Output format

Two modes — accept a CLI flag to switch:

**Individual** (default): one .txt per reel in transcripts/
```
transcripts/
├── ABC123.txt
├── DEF456.txt
```

**Combined** (--combined flag): single file transcripts/all.txt with each reel separated by a header:
```
=== ABC123 ===
URL: https://www.instagram.com/reel/ABC123/
---
transcript text here...


=== DEF456 ===
URL: https://www.instagram.com/reel/DEF456/
---
transcript text here...
```

To map reel ID back to URL for the combined output, read reel_urls.txt and extract the ID from each URL (last path segment before trailing slash).

## Dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install faster-whisper yt-dlp
```

yt-dlp is a CLI tool installed into the venv, callable from the shell script only if the venv is active. Note this in the README.

## README.md to generate

Include:
- Folder structure
- Setup instructions (venv, pip install)
- How to populate reel_urls.txt
- How to run both scripts in order
- The --gpu and --combined flags
- Note that fb_dtsg / session cookies are not needed here — yt-dlp handles auth via --cookies-from-browser
- Note that faster-whisper downloads the model on first run (~1.5GB for medium), subsequent runs use cache

## Constraints

- No paid APIs
- No hardcoded paths — use pathlib.Path throughout
- Script 2 must be resumable — never re-transcribe an already done file
- Both scripts must work on Mac (CPU) and Windows WSL2 (GPU)
- Keep dependencies minimal — only faster-whisper and yt-dlp
