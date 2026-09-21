#!/bin/bash
# Spouštěč a hlídač serveru Kanclu (LaunchAgent cz.skoupy.kancl).
#  - ořízne log na 0,5 MB
#  - uvolní port po procesu, který zůstal viset z minula
#  - každou minutu se zeptá /api/health; po třech selháních server shodí a spustí znovu
#    (LaunchAgent umí restartovat jen spadlý proces, ne zatuhlý — 10. 9. 2026 server 10 dní
#    poslouchal na portu, ale neodpovídal)
cd "$(dirname "$0")/.." || exit 1
PORT="${KANCL_PORT:-4242}"
LOG="$HOME/.kancl/server.log"
mkdir -p "$HOME/.kancl"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 1000000 ]; then
  tail -c 500000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log() { echo "[hlídač $(date '+%H:%M:%S')] $*"; }

free_port() {
  lsof -ti tcp:"$PORT" 2>/dev/null | while read -r p; do kill -9 "$p" 2>/dev/null; done
}

stop_server() {
  if [ -n "$PID" ]; then
    pkill -P "$PID" 2>/dev/null
    kill "$PID" 2>/dev/null
  fi
  sleep 1
  free_port
}

trap 'log "končím na signál"; stop_server; exit 0' TERM INT

while true; do
  free_port
  node_modules/.bin/tsx server/index.ts &
  PID=$!
  log "server spuštěn (pid $PID)"
  fails=0
  while kill -0 "$PID" 2>/dev/null; do
    # čekání po sekundách, ať se signál od launchctl zpracuje hned
    for _ in $(seq 60); do sleep 1; kill -0 "$PID" 2>/dev/null || break; done
    kill -0 "$PID" 2>/dev/null || break
    if curl -s -m 5 -o /dev/null "http://127.0.0.1:$PORT/api/health"; then
      fails=0
    else
      fails=$((fails + 1))
      log "/api/health neodpovědělo ($fails/3)"
      if [ "$fails" -ge 3 ]; then
        log "server zatuhl, restartuji"
        stop_server
        break
      fi
    fi
  done
  wait "$PID" 2>/dev/null
  log "server skončil, startuji znovu za 3 s"
  sleep 3
done
