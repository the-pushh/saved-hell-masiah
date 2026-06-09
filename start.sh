#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

# ── colours ──────────────────────────────────────────────────────────────────
DIM='\033[2m'
BOLD='\033[1m'
GREEN='\033[0;32m'
RESET='\033[0m'

log()  { printf "  ${DIM}%s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET}  %s\n" "$1"; }
head() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

clear
printf "${BOLD}  IG DM Scraper${RESET}  ${DIM}local · private${RESET}\n"
printf "  ${DIM}────────────────────────────${RESET}\n\n"

# ── python venv ───────────────────────────────────────────────────────────────
head "Setup"

if [ ! -d "$VENV" ]; then
  log "Creating virtual environment..."
  python3 -m venv "$VENV"
fi
source "$VENV/bin/activate"

log "Checking Python dependencies..."
pip install -q -r "$ROOT/requirements.txt" 2>/dev/null
ok "Python ready"

log "Checking Playwright browser..."
playwright install chromium 2>&1 | grep -E "^(Downloading|playwright)" | sed 's/^/     /' || true
ok "Browser ready"

# ── data dir + migration ──────────────────────────────────────────────────────
mkdir -p "$ROOT/data"
for f in session.json reels.json reel_links.txt; do
  if [ -f "$ROOT/$f" ] && [ ! -f "$ROOT/data/$f" ]; then
    mv "$ROOT/$f" "$ROOT/data/$f"
    log "Migrated $f → data/"
  fi
done

# ── node deps ─────────────────────────────────────────────────────────────────
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  log "Installing Node dependencies..."
  cd "$ROOT/frontend" && npm install --silent
  ok "Node ready"
else
  ok "Node ready"
fi

# ── launch ────────────────────────────────────────────────────────────────────
head "Starting"

cd "$ROOT"
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --log-level warning &
BACKEND_PID=$!

cd "$ROOT/frontend" && npm run dev 2>&1 | grep -v "^>" | grep -v "^$" &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; printf '\n  Stopped.\n\n'" INT TERM EXIT

# wait for Next.js ready signal
while ! curl -s http://localhost:3000 > /dev/null 2>&1; do
  sleep 0.5
done

printf "\n"
printf "  ${GREEN}●${RESET}  ${BOLD}http://localhost:3000${RESET}\n"
printf "\n"
printf "  ${DIM}Press Ctrl+C to stop${RESET}\n\n"

wait
