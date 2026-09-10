#!/bin/bash
# Spouštěč pro LaunchAgent: ořízne log na posledních ~1 MB a spustí server.
cd "$(dirname "$0")/.." || exit 1
LOG="$HOME/.kancl/server.log"
mkdir -p "$HOME/.kancl"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 1000000 ]; then tail -c 500000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
exec npx tsx server/index.ts
