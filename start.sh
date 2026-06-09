#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

# ── colours ───────────────────────────────────────────────────────────────────
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
BLACK='\033[0;30m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[0;37m'
BG_BLACK='\033[40m'
INDIGO='\033[38;5;99m'
PURPLE='\033[38;5;141m'
LIME='\033[38;5;154m'

log()   { printf "  ${DIM}${WHITE}·${RESET}  ${DIM}%s${RESET}\n" "$1"; }
ok()    { printf "  ${LIME}✓${RESET}  ${WHITE}%s${RESET}\n" "$1"; }
head()  { printf "\n  ${BOLD}${INDIGO}%s${RESET}\n  ${DIM}$(printf '%.0s─' {1..28})${RESET}\n" "$1"; }
warn()  { printf "  ${YELLOW}⚠${RESET}  ${DIM}%s${RESET}\n" "$1"; }

clear

# ── banner ────────────────────────────────────────────────────────────────────
printf "\n"
printf "  ${BOLD}${PURPLE}◈  IG DM Scraper${RESET}\n"
printf "  ${DIM}local · private · no cloud${RESET}\n"

# ── setup ─────────────────────────────────────────────────────────────────────
head "Setup"

if [ ! -d "$VENV" ]; then
  log "Creating virtual environment..."
  python3 -m venv "$VENV"
fi
source "$VENV/bin/activate"

log "Checking Python dependencies..."
pip install -q -r "$ROOT/requirements.txt" 2>/dev/null
ok "Python  ${DIM}deps ok${RESET}"

log "Checking Playwright browser..."
playwright install chromium 2>&1 | grep -E "^Downloading" | sed "s/^/     ${DIM}/" | sed "s/$/${RESET}/" || true
ok "Browser  ${DIM}Chromium ready${RESET}"

mkdir -p "$ROOT/data"
for f in session.json reels.json reel_links.txt; do
  if [ -f "$ROOT/$f" ] && [ ! -f "$ROOT/data/$f" ]; then
    mv "$ROOT/$f" "$ROOT/data/$f"
    warn "Migrated $f → data/"
  fi
done

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  log "Installing Node dependencies..."
  cd "$ROOT/frontend" && npm install --silent
fi
ok "Node     ${DIM}deps ok${RESET}"

# ── launch ────────────────────────────────────────────────────────────────────
head "Launching"

cd "$ROOT"
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --log-level warning &
BACKEND_PID=$!

cd "$ROOT/frontend" && npm run dev 2>&1 | grep -v "^>" | grep -v "^$" &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; printf \"\n  ${DIM}Stopped.${RESET}\n\n\"" INT TERM EXIT

log "Waiting for app..."
while ! curl -s http://localhost:3000 > /dev/null 2>&1; do
  sleep 0.5
done

# ── ready ─────────────────────────────────────────────────────────────────────
printf "\n"
printf "  ${BG_BLACK}${BOLD}${LIME}  ● ready  ${RESET}  ${BOLD}${WHITE}http://localhost:3000${RESET}\n"
printf "\n"
printf "  ${DIM}ctrl+c to stop${RESET}\n\n"

wait
