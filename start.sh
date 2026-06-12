#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

# ── colours ($'...' syntax = actual escape chars, not literal \033) ───────────
RESET=$'\e[0m'
BOLD=$'\e[1m'
DIM=$'\e[2m'
WHITE=$'\e[97m'
MUTED=$'\e[38;5;245m'
YELLOW=$'\e[38;5;221m'
CYAN=$'\e[38;5;117m'
GREEN=$'\e[38;5;114m'
LIME=$'\e[38;5;150m'
SAGE=$'\e[38;5;108m'
BROWN=$'\e[38;5;137m'
RED=$'\e[31m'
BG_DARK=$'\e[48;5;235m'

log()  { printf "  ${MUTED}·${RESET}  ${DIM}%s${RESET}\n" "$1"; }
ok()   { printf "  ${LIME}✓${RESET}  ${WHITE}%s${RESET}\n" "$1"; }
sec()  { printf "\n  ${BOLD}${SAGE}── %s ${DIM}──────────────────────${RESET}\n" "$1"; }
warn() { printf "  ${YELLOW}⚠${RESET}  ${DIM}%s${RESET}\n" "$1"; }

clear

# ══════════════════════════════════════════════════════════════════════════════
#  B A N N E R
# ══════════════════════════════════════════════════════════════════════════════

printf "\n"

# Sky — stars and clouds
printf "  ${MUTED}  *    .    *    .    *    .    *    .    *    .    *${RESET}\n"
printf "  ${WHITE}       .  (  ~~ )  .      ( ~~~~~ )    .  ( ~~~ )  .${RESET}\n"
printf "  ${WHITE}  .   (   ~~~~~  )    .  (  ~~~~~  )  (   ~~~~~  )  ${RESET}\n"
printf "  ${WHITE}      (          )       (          )  (          )  ${RESET}\n"
printf "  ${WHITE}       \`--------'    .    \`----------'  \`----------' ${RESET}\n"

# Sun (upper left, overlapping sky)
printf "\n"
printf "  ${YELLOW}  \\.  |  ./         ${MUTED}take your world offline${RESET}\n"
printf "  ${YELLOW}  --(  ☀  )--       ${MUTED}keep what matters${RESET}\n"
printf "  ${YELLOW}  ./  |  \\.${RESET}\n"

printf "\n"

# LifeOffline big ASCII title  (printf '%s' avoids backslash interpretation)
printf '%s' "  ${BOLD}${GREEN}"; printf '%s\n' ' _     _  __       ___  __  __ _  _          '
printf '%s' "  ${RESET}${BOLD}${GREEN}"; printf '%s\n' '| |   (_)/ _|___  / _ \/ _|/ _| || |_ _ ___ '
printf '%s' "  ${RESET}${BOLD}${GREEN}"; printf '%s\n' "| |__ | |  _/ -_)| (_) |  _|  _| || | '_\\  -_)"
printf '%s' "  ${RESET}${BOLD}${GREEN}"; printf '%s\n' '|____|_|_|_|\___| \___/|_| |_|  \_,_|_||_|\___|'
printf '%s\n' "${RESET}"

# Tagline
printf "  ${MUTED}save what inspires you · step outside · live offline${RESET}\n"
printf "\n"

# Hills / grass
printf "  ${GREEN}/\\/\\  /\\/\\/\\  /\\/\\  /\\/\\  /\\/\\/\\  /\\/\\  /\\/\\/\\ ${RESET}\n"
printf "  ${SAGE}||||  ||||||  ||||  ||||  ||||||  ||||  ||||||||${RESET}\n"

# River
printf "  ${CYAN}≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈${RESET}\n"
printf "  ${CYAN} ≈≈≈≈  ≈≈≈≈  ≈≈≈≈≈  ≈≈≈≈  ≈≈≈≈≈  ≈≈≈≈  ≈≈≈≈≈  ≈≈${RESET}\n"

printf "\n"

# Dogs + tree
printf "  ${GREEN}  |  ${RESET}${WHITE}  /\\_/\\   /\\_/\\  ${RESET}${GREEN}  |${RESET}\n"
printf "  ${GREEN} /|\\ ${RESET}${WHITE} ( o . ) ( ^ . ) ${RESET}${GREEN} /|\\ ${RESET}${MUTED}  two good dogs, living offline${RESET}\n"
printf "  ${GREEN}/||\\ ${RESET}${WHITE} (> _ <) (> - <) ${RESET}${GREEN}/||\\${RESET}\n"
printf "  ${GREEN} ||  ${RESET}${WHITE}  '-'-'   '-'-'  ${RESET}${GREEN} || ${RESET}\n"

printf "\n"

# ══════════════════════════════════════════════════════════════════════════════
#  S E T U P
# ══════════════════════════════════════════════════════════════════════════════

sec "Setup"

if [ ! -d "$VENV" ]; then
  log "Creating virtual environment..."
  python3 -m venv "$VENV"
fi
source "$VENV/bin/activate"

log "Checking Python dependencies..."
pip install -q -r "$ROOT/requirements.txt" 2>/dev/null
ok "Python    ${DIM}deps ok${RESET}"

log "Checking Playwright browser..."
playwright install chromium 2>&1 | grep -E "^Downloading" | sed "s/^/     ${DIM}/" | sed "s/$/${RESET}/" || true
ok "Browser   ${DIM}Chromium ready${RESET}"

_OS="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
_ARCH="$(uname -m 2>/dev/null)"
_BIN="$ROOT/.bin"
mkdir -p "$_BIN"

# ── yt-dlp ────────────────────────────────────────────────────────────────────
log "Checking yt-dlp..."
if ! command -v yt-dlp &>/dev/null; then
  if pip install -q yt-dlp 2>/dev/null; then
    true
  else
    _YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    [[ "$_OS" == *mingw* || "$_OS" == *msys* || "$_OS" == *cygwin* ]] && _YTDLP_URL="${_YTDLP_URL}.exe"
    curl -sL "$_YTDLP_URL" -o "$_BIN/yt-dlp" && chmod +x "$_BIN/yt-dlp"
    export PATH="$_BIN:$PATH"
  fi
fi
command -v yt-dlp &>/dev/null && ok "yt-dlp    ${DIM}ready${RESET}" || warn "yt-dlp unavailable — remote transcripts will fail"

# ── ffmpeg ────────────────────────────────────────────────────────────────────
log "Checking ffmpeg..."
if ! command -v ffmpeg &>/dev/null; then
  _INSTALLED=0

  # Package managers (try silently, no sudo required on some systems)
  if   command -v apt-get &>/dev/null; then
    (sudo apt-get install -y -qq ffmpeg 2>/dev/null && _INSTALLED=1) || true
  elif command -v dnf     &>/dev/null; then
    (sudo dnf install -y -q  ffmpeg 2>/dev/null && _INSTALLED=1) || true
  elif command -v yum     &>/dev/null; then
    (sudo yum install -y -q  ffmpeg 2>/dev/null && _INSTALLED=1) || true
  elif command -v pacman  &>/dev/null; then
    (sudo pacman -Sy --noconfirm ffmpeg 2>/dev/null && _INSTALLED=1) || true
  elif command -v brew    &>/dev/null; then
    (brew install ffmpeg --quiet 2>/dev/null && _INSTALLED=1) || true
  elif command -v scoop   &>/dev/null; then
    (scoop install ffmpeg 2>/dev/null && _INSTALLED=1) || true
  elif command -v winget  &>/dev/null; then
    (winget install -e --id Gyan.FFmpeg --silent 2>/dev/null && _INSTALLED=1) || true
  fi

  # Fallback: download static binary to .bin/
  if [[ $_INSTALLED -eq 0 ]] && ! command -v ffmpeg &>/dev/null; then
    if [[ "$_OS" == "darwin" ]]; then
      log "Downloading ffmpeg static binary for macOS..."
      _FFMPEG_ZIP="$_BIN/ffmpeg.zip"
      curl -sL "https://evermeet.cx/ffmpeg/getrelease/zip" -o "$_FFMPEG_ZIP" && \
        unzip -qo "$_FFMPEG_ZIP" -d "$_BIN" && rm -f "$_FFMPEG_ZIP" && \
        chmod +x "$_BIN/ffmpeg" && export PATH="$_BIN:$PATH" || true
    elif [[ "$_OS" == "linux" ]]; then
      log "Downloading ffmpeg static binary for Linux..."
      [[ "$_ARCH" == "aarch64" || "$_ARCH" == "arm64" ]] && _FA="arm64" || _FA="amd64"
      curl -sL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${_FA}-static.tar.xz" | \
        tar -xJ --wildcards '*/ffmpeg' --strip-components=1 -C "$_BIN" 2>/dev/null && \
        chmod +x "$_BIN/ffmpeg" && export PATH="$_BIN:$PATH" || true
    fi
  fi
fi
command -v ffmpeg &>/dev/null && ok "ffmpeg    ${DIM}ready${RESET}" || warn "ffmpeg unavailable — audio extraction will fall back to yt-dlp"

mkdir -p "$ROOT/data/videos" "$ROOT/data/audio" "$ROOT/data/transcripts"
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
ok "Node      ${DIM}deps ok${RESET}"

# ══════════════════════════════════════════════════════════════════════════════
#  L A U N C H
# ══════════════════════════════════════════════════════════════════════════════

sec "Launching"

cd "$ROOT"
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --log-level warning &
BACKEND_PID=$!

cd "$ROOT/frontend" && npm run dev 2>&1 | grep -v "^>" | grep -v "^$" &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; printf \"\n  ${DIM}Stopped. Go touch some grass.${RESET}\n\n\"" INT TERM EXIT

log "Waiting for app to wake up..."
while ! curl -s http://localhost:3000 > /dev/null 2>&1; do
  sleep 0.5
done

# ══════════════════════════════════════════════════════════════════════════════
#  R E A D Y
# ══════════════════════════════════════════════════════════════════════════════

printf "\n"
printf "  ${BG_DARK}${BOLD}${LIME}  ◈  ready  ${RESET}  ${BOLD}${WHITE}http://localhost:3000${RESET}\n"
printf "\n"
printf "  ${MUTED}ctrl+c to stop · go outside after${RESET}\n\n"

wait
