#!/bin/bash
# Double-click to start Comakers Crew. Starts the server in the background (if it is not
# already running), waits for it, opens the browser. This Terminal window can be closed.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
PORT="${COMAKERS_PORT:-4242}"
LOG="$HOME/.comakers/server.log"
mkdir -p "$HOME/.comakers"

if curl -s --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "Comakers Crew is already running on http://127.0.0.1:$PORT"
else
  if ! command -v node >/dev/null; then
    echo "Node.js not found. Install it from https://nodejs.org and try again."; read -r -p "Press Enter to close"; exit 1
  fi
  [ -d node_modules ] || { echo "Installing dependencies…"; npm install --no-fund --no-audit; }
  [ -f dist/index.html ] || { echo "Building the client…"; npm run build; }
  echo "Starting server (log: $LOG)…"
  nohup npx tsx server/index.ts >> "$LOG" 2>&1 &
  for _ in $(seq 1 40); do
    curl -s --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

open "http://127.0.0.1:$PORT"
echo "Open: http://127.0.0.1:$PORT  —  you can close this window."
sleep 2
osascript -e 'tell application "Terminal" to close (every window whose name contains "Comakers Crew.command")' >/dev/null 2>&1 &
