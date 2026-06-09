#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

echo "▶ IG DM Scraper — local launcher"
echo ""

# --- Python venv & backend deps ---
if [ ! -d "$VENV" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"

echo "Installing Python dependencies..."
pip install -q -r "$ROOT/requirements.txt"

echo "Installing Playwright browser..."
playwright install chromium

# --- Migrate legacy data files to data/ ---
mkdir -p "$ROOT/data"
for f in session.json reels.json reel_links.txt; do
  if [ -f "$ROOT/$f" ] && [ ! -f "$ROOT/data/$f" ]; then
    echo "Migrating $f → data/$f"
    mv "$ROOT/$f" "$ROOT/data/$f"
  fi
done

# --- Frontend deps ---
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Installing Node dependencies..."
  cd "$ROOT/frontend" && npm install --silent
fi

# --- Launch both services ---
echo ""
echo "Starting backend on http://localhost:8000"
echo "Starting frontend on http://localhost:3000"
echo ""
echo "Open http://localhost:3000 in your browser."
echo "Press Ctrl+C to stop."
echo ""

cd "$ROOT"

uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo ''; echo 'Stopped.'" INT TERM EXIT

wait
