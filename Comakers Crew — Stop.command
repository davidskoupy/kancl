#!/bin/bash
# Double-click to stop the Comakers Crew server.
PORT="${COMAKERS_PORT:-4242}"
PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then kill $PIDS && echo "Stopped Comakers Crew (port $PORT)."; else echo "Comakers Crew is not running."; fi
sleep 1.5
osascript -e 'tell application "Terminal" to close (every window whose name contains "Stop.command")' >/dev/null 2>&1 &
