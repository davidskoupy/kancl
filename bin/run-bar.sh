#!/bin/bash
# Spouštěč a hlídač widgetu KanclBar (LaunchAgent cz.skoupy.kanclbar).
#  - ořízne log na 0,5 MB
#  - KanclBar každé 3 s zapisuje tep do ~/.kancl/bar.heartbeat
#  - když je tep starší než 3 minuty, widget zatuhl: shodit a spustit znovu
#    (KeepAlive umí restartovat jen spadlý proces, ne zamrzlý)
cd "$(dirname "$0")/.." || exit 1
LOG="$HOME/.kancl/bar.log"
BEAT="$HOME/.kancl/bar.heartbeat"
BIN="bar/build/KanclBar.app/Contents/MacOS/KanclBar"
mkdir -p "$HOME/.kancl"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 1000000 ]; then
  tail -c 500000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log() { echo "[hlídač $(date '+%H:%M:%S')] $*"; }
trap 'log "končím na signál"; [ -n "$PID" ] && kill "$PID" 2>/dev/null; exit 0' TERM INT

while true; do
  rm -f "$BEAT"
  "$BIN" &
  PID=$!
  log "KanclBar spuštěn (pid $PID)"
  while kill -0 "$PID" 2>/dev/null; do
    for _ in $(seq 60); do sleep 1; kill -0 "$PID" 2>/dev/null || break; done
    kill -0 "$PID" 2>/dev/null || break
    if [ -f "$BEAT" ]; then
      age=$(( $(date +%s) - $(stat -f%m "$BEAT") ))
      if [ "$age" -gt 180 ]; then
        log "widget nedává tep ${age}s, restartuji"
        kill -9 "$PID" 2>/dev/null
        break
      fi
    fi
  done
  wait "$PID" 2>/dev/null
  log "KanclBar skončil, startuji znovu za 3 s"
  sleep 3
done
