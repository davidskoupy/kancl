#!/bin/bash
# Dvojklikem spustíš Kancl. Server se pustí na pozadí (pokud už neběží), počká se na něj
# a otevře se prohlížeč. Tohle okno Terminálu se pak může zavřít.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
PORT="${KANCL_PORT:-4242}"
LOG="$HOME/.kancl/server.log"
mkdir -p "$HOME/.kancl"

if curl -s --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "Kancl už běží na http://127.0.0.1:$PORT"
else
  if ! command -v node >/dev/null; then
    echo "Node.js nenalezen. Nainstaluj ho z https://nodejs.org a zkus to znovu."; read -r -p "Enter zavře okno"; exit 1
  fi
  [ -d node_modules ] || { echo "Instaluji závislosti…"; npm install --no-fund --no-audit; }
  [ -f dist/index.html ] || { echo "Sestavuji klienta…"; npm run build; }
  echo "Spouštím server (log: $LOG)…"
  nohup npx tsx server/index.ts >> "$LOG" 2>&1 &
  for _ in $(seq 1 40); do
    curl -s --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

open "http://127.0.0.1:$PORT"
echo "Otevřeno: http://127.0.0.1:$PORT  —  tohle okno můžeš zavřít."
sleep 2
osascript -e 'tell application "Terminal" to close (every window whose name contains "Kancl.command")' >/dev/null 2>&1 &
