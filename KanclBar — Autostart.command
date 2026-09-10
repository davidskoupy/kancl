#!/bin/bash
# Dvojklikem zapneš/vypneš KanclBar (widget v menu baru) po přihlášení. Přeloží ho, když ještě není.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LABEL="cz.skoupy.kanclbar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BIN="$PWD/bar/build/KanclBar.app/Contents/MacOS/KanclBar"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.kancl"

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1
  rm -f "$PLIST"
  pkill -x KanclBar 2>/dev/null
  echo "KanclBar VYPNUT. Z menu baru zmizel a po přihlášení se nespustí."
else
  [ -x "$BIN" ] || bash bar/build.sh
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.kancl/bar.log</string>
  <key>StandardErrorPath</key><string>$HOME/.kancl/bar.log</string>
</dict></plist>
PL
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  echo "KanclBar ZAPNUT. Ikona 🕹 je v menu baru a spustí se po přihlášení (dalším dvojklikem vypneš)."
fi
sleep 3
osascript -e 'tell application "Terminal" to close (every window whose name contains "KanclBar")' >/dev/null 2>&1 &
