#!/bin/bash
# Dvojklikem zastavíš server Kanclu.
PORT="${KANCL_PORT:-4242}"
PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then kill $PIDS && echo "Kancl zastaven (port $PORT)."; else echo "Kancl neběží."; fi
sleep 1.5
osascript -e 'tell application "Terminal" to close (every window whose name contains "Stop.command")' >/dev/null 2>&1 &
