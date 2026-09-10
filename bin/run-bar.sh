#!/bin/bash
# Spouštěč pro LaunchAgent KanclBaru: ořízne log a spustí aplikaci.
cd "$(dirname "$0")/.." || exit 1
LOG="$HOME/.kancl/bar.log"
mkdir -p "$HOME/.kancl"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 1000000 ]; then tail -c 500000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
exec bar/build/KanclBar.app/Contents/MacOS/KanclBar
