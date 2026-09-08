#!/bin/bash
# Dvojklikem zapneš/vypneš „spustit Kancl po přihlášení" (macOS LaunchAgent).
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LABEL="cz.skoupy.kancl"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(dirname "$(command -v node)")"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.kancl"

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1
  rm -f "$PLIST"
  echo "Autostart VYPNUT. Kancl se po přihlášení už nespustí."
else
  [ -f dist/index.html ] || npm run build
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN/npx</string><string>tsx</string><string>$PWD/server/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.kancl/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.kancl/server.log</string>
</dict></plist>
PL
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  echo "Autostart ZAPNUT. Kancl se spustí po přihlášení a po pádu se sám restartuje."
  echo "Otevřeš ho kdykoli na http://127.0.0.1:4242 (dalším dvojklikem autostart vypneš)."
fi
sleep 3
osascript -e 'tell application "Terminal" to close (every window whose name contains "Autostart.command")' >/dev/null 2>&1 &
